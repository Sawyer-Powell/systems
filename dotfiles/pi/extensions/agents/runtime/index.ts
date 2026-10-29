/**
 * In-agent plumbing, loaded in every agent process: lock, state, heartbeat,
 * activity tracking, inbox delivery, control messages, step-timeout guard, and
 * terminal-state handling. See SPEC.md.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentsHost } from "../host.ts";
import {
	AGENT_MESSAGE,
	type AgentMessage,
	type AgentMessageDetails,
	agentMessageText,
	claimsFromBranch,
	type AgentStatus,
	deliveryForParent,
	ERROR_MAX_CHARS,
	isTerminal,
	orientation,
	RESULT_ENTRY,
	resultClaim,
	settleDone,
	SUMMARY_MAX_CHARS,
	wrapUpText,
} from "../store/index.ts";
import { ActivityTracker } from "./activity.ts";
import { createRootInput } from "./identity.ts";
import { insertAtRunPosition } from "./orientation-position.ts";

interface AssistantLike {
	role?: string;
	stopReason?: string;
	errorMessage?: string;
	content?: unknown;
}

function textOf(message: AssistantLike | undefined): string {
	const content = message?.content;
	if (Array.isArray(content)) {
		return content
			.filter((part): part is { type: "text"; text: string } => (part as { type?: string }).type === "text")
			.map((part) => part.text)
			.join("");
	}
	return typeof content === "string" ? content : "";
}

/** Tools that flag a wait; any other tool starting means the agent has resumed work. */
const ASK_TOOLS: readonly string[] = ["ask_user", "ask_parent"];

/** True when a tool starting proves an agent shown as waiting is in fact working again. */
export function resumedFromWaiting(toolName: string, status: AgentStatus | undefined): boolean {
	return (status === "waiting-on-user" || status === "waiting-on-parent") && !ASK_TOOLS.includes(toolName);
}

/** State patch applied at agent_start: a new run clears the previous summary and status note. */
export function agentStartPatch(): { summary: undefined; note: undefined } {
	return { summary: undefined, note: undefined };
}

const log = (message: string) => process.stderr.write(`[agents] ${message}\n`);

/** Run a handler body; never let an exception escape into pi. */
function safe<A extends unknown[]>(fn: (...args: A) => unknown): (...args: A) => Promise<void> {
	return async (...args: A) => {
		try { await fn(...args); } catch (error) { log(String(error)); }
	};
}

export function registerRuntime(host: AgentsHost): void {
	const { pi, store } = host;

	let id: string | undefined;
	let ctx: ExtensionContext | undefined;
	let tracker: ActivityTracker | undefined;
	const connection = host.connection;
	let parking = false;
	let shuttingDown = false;
	const flush = async () => { await connection?.flush(); };
	const receipt = async () => { if (id) { await flush(); await connection?.request("receipt", { id }); } };
	let lastRun: AssistantLike | undefined;
	/** A `/agent-done` request is outstanding: the next settled run ends it (see `settleDone`). */
	let pendingDone = false;

	const setStatus = (status: AgentStatus, extra: Record<string, unknown> = {}) => {
		if (id) store.writeState(id, { status, ...extra });
	};
	const currentStatus = (): AgentStatus | undefined => (id ? store.readState(id)?.status : undefined);

	function notifyParent(body: string): void {
		const input = host.identity;
		if (!input?.parent || !id) return;
		try {
			store.send({ from: id, to: input.parent, kind: "result", body, deliver: deliveryForParent(store, input.parent) });
		} catch (error) {
			log(`could not notify parent: ${String(error)}`);
		}
	}

	async function deliver(message: AgentMessage): Promise<void> {
		if (!ctx || !id) return;
		if (message.kind === "control") {
			// A control message sent while this agent was dead must not fire on resume.
			pi.appendEntry("agents.receipt", { id: message.id });
			if (message.control === "interrupt") ctx.abort();
			else if (message.control === "done") requestDone(message);
			else if (message.control === "stop") {
				setStatus("stopped");
				ctx.shutdown();
			}
			return;
		}
		const state = store.readState(id);
		if (message.kind === "answer" && state?.waitingOn && message.inReplyTo === state.waitingOn.messageId) {
			store.writeState(id, { waitingOn: undefined });
		}
		// A child's result is a claim of this branch, whether or not it enters the model's context.
		if (message.kind === "result" && store.readInput(message.from)?.parent === id) {
			const status = store.readState(message.from)?.status ?? "unknown";
			pi.appendEntry(RESULT_ENTRY, resultClaim(message.from, status, message.body, Date.now()));
		}
		if (message.deliver === "ui") {
			pi.appendEntry("agents.receipt", { id: message.id });
			if (ctx.hasUI) ctx.ui.notify(`[${message.from}] ${message.kind}: ${message.body.slice(0, 200)}`, "info");
			await receipt();
			return;
		}
		// A custom message reaches the model like user input and wakes an idle agent, but the
		// transcript shows who sent it instead of pretending the user typed it.
		const details: AgentMessageDetails = { from: message.from, kind: message.kind, id: message.id, inReplyTo: message.inReplyTo };
		pi.sendMessage(
			{ customType: AGENT_MESSAGE, content: agentMessageText(message), display: true, details },
			{ triggerTurn: true, deliverAs: ctx.isIdle() ? undefined : "steer" },
		);
	}

	/**
	 * `/agent-done`: ask this agent to wrap up. The agent runs a normal turn (steered into a run in
	 * progress, never aborting it) and calls `report_done` itself; `agent_settled` finishes the job
	 * if it did not. Roots, and agents that are not live work, ignore it.
	 */
	function requestDone(message: AgentMessage): void {
		if (!ctx || !host.identity?.parent) return;
		const status = currentStatus();
		if (status === "done" || status === "stopped" || status === "timed-out") return;
		pendingDone = true;
		const details: AgentMessageDetails = { from: message.from, kind: "control", id: message.id };
		pi.sendMessage(
			{ customType: AGENT_MESSAGE, content: agentMessageText({ from: message.from, kind: "control", id: message.id, body: wrapUpText() }), display: true, details },
			{ triggerTurn: true, deliverAs: ctx.isIdle() ? undefined : "steer" },
		);
	}

	function finishNonInteractable(aborted: boolean): void {
		if (!id) return;
		let status: AgentStatus = "done";
		let summary = textOf(lastRun).slice(0, SUMMARY_MAX_CHARS);
		if (aborted) {
			status = "stopped";
		} else if (lastRun?.stopReason === "error") {
			status = "error";
			summary = (lastRun.errorMessage ?? "model call failed").slice(0, ERROR_MAX_CHARS);
		}
		setStatus(status, { summary: summary || undefined });
		const prefix = status === "error" ? "FAILED: " : status === "stopped" ? "STOPPED: " : "";
		notifyParent(`${prefix}${summary || "(no output)"}`);
		// The daemon parks this settled runner; no child-owned exit timer or supervisor.
	}

	pi.on(
		"session_start",
		safe(async (_event, context: ExtensionContext) => {
			await connection?.start();
			shuttingDown = false;
			parking = false;
			ctx = context;
			host.ctx = context;

			// Agent id === pi session id: a child was launched with `--session-id <agent id>`; a
			// root is created for the first session that has no record. Resuming a session finds
			// its agent again.
			const sessionId = context.sessionManager.getSessionId();
			if (process.env.PI_AGENTS_ID && process.env.PI_AGENTS_ID !== sessionId) {
				context.shutdown(); throw new Error("Managed session identity mismatch; refusing to register a root or write another session");
			}
			let input = store.readInput(sessionId);
			if (!input || !input.parent) {
				if (context.mode !== "tui") return; // headless one-offs are not agents
				input ??= createRootInput(store, context);
			}
			await flush();
			id = input.id;
			host.identity = input;

			tracker = new ActivityTracker({ store, id });
			connection?.removeAllListeners("mail");
			connection?.removeAllListeners("park");
			connection?.removeAllListeners("stop");
			connection?.removeAllListeners("disconnect");
			connection?.on("mail", (message: AgentMessage) => { void deliver(message).then(receipt).catch(error => log(String(error))); });
			connection?.on("park", () => { void (async () => {
				if (shuttingDown) return;
				if (!ctx?.isIdle()) { await connection.request("park-declined"); return; }
				await receipt();
				if (await connection.request("park-ready")) { parking = true; ctx.shutdown(); }
			})().catch(error => log(String(error))); });
			connection?.on("stop", () => { ctx?.abort(); ctx?.shutdown(); });
			connection?.on("disconnect", () => {
				if (shuttingDown) return;
				if (!host.identity?.parent) {
					host.canSpawn = false;
					ctx?.ui.notify("Agents runtime disconnected; this human session remains open. Reload to reconnect agent controls.", "warning");
					return;
				}
				// Managed writers fail closed, including attached ones. This is interrupted work,
				// NOT safe parking: the daemon fences it and requires explicit recovery.
				ctx?.ui.notify("Agents runtime disconnected. Interrupting this runner; explicit recovery is required.", "error");
				ctx?.abort(); ctx?.shutdown();
			});
			await connection?.request("hello", { id, token: process.env.PI_AGENTS_OWNER, pid: process.pid,
				sessionFile: context.sessionManager.getSessionFile() }).catch(error => {
					host.identity = undefined; context.shutdown(); throw error;
				});
		}),
	);

	pi.on("session_before_compact", safe(async () => { if (id) await connection?.request("activity", { busy: true }); }));
	const compactionFinished = () => { setImmediate(() => {
		if (id && ctx?.isIdle()) void connection?.request("activity", { busy: false }).catch(error => log(String(error)));
	}); };
	pi.on("session_compact", compactionFinished);
	pi.on("session_compact_failed", compactionFinished);
	pi.on("cache_warming_decision", () => host.identity?.parent ? { action: "stop" as const } : undefined);

	// Model-facing orientation: what this agent has going. Computed once per run and appended as
	// the last message of each LLM call (not persisted, not in the system prompt): the cached
	// prompt prefix stays stable, and text other agents wrote is not given system authority.
	let orientationText: string | undefined;
	/** Position of the orientation block for the current run; fixed so the prompt cache prefix keeps growing (see orientation-position.ts). */
	let orientationAt: number | undefined;
	pi.on("before_agent_start", (_event, context) => {
		orientationAt = undefined;
		try {
			orientationText = id ? orientation(store, id, Date.now(), claimsFromBranch(context.sessionManager.getBranch())) : undefined;
		} catch (error) {
			orientationText = undefined;
			log(`orientation failed: ${String(error)}`);
		}
		return undefined;
	});
	pi.on("context", (event) => {
		if (!orientationText) return undefined;
		const block = { role: "custom" as const, customType: "agents_orientation", content: orientationText, display: false, timestamp: Date.now() };
		const placed = insertAtRunPosition(event.messages, block as (typeof event.messages)[number], orientationAt);
		orientationAt = placed.at;
		return { messages: placed.messages };
	});

	// An agent's session is its identity: a child's pi cannot be switched to another session
	// (/new, /resume, /fork, /clone), which would orphan the child and turn its process into a root.
	const refuseSwitch = (_event: unknown, context: ExtensionContext) => {
		if (!host.identity?.parent) return undefined;
		if (context.hasUI) context.ui.notify("An agent's session cannot be replaced. Quit and start pi normally.", "warning");
		return { cancel: true };
	};
	pi.on("session_before_switch", refuseSwitch);
	pi.on("session_before_fork", refuseSwitch);

	pi.on(
		"session_shutdown",
		safe(async (event: { reason?: string }) => {
			shuttingDown = true;
			tracker?.reset();
			orientationText = undefined;
			pendingDone = false;
			if (id) {
				// Only /reload continues as this same agent. Any other shutdown unloads the session:
				// a root is then dormant (resuming the session wakes it), a child is stopped.
				if (event.reason !== "reload") {
					const status = currentStatus();
					if (host.identity?.parent === null) setStatus("dormant");
					else if (!parking && status && !isTerminal(status)) setStatus("stopped");
				}
				await flush();
			}
			id = undefined;
			ctx = undefined;
			host.identity = undefined;
			host.ctx = undefined;
			host.canSpawn = false;
			await connection?.stop();
		}),
	);

	const touch = safe(() => tracker?.touch());
	pi.on("turn_end", touch);
	pi.on(
		"message_start",
		safe(() => tracker?.touch()), // assistant message_start is only the response headers, not output
	);
	// Raw provider events (where the provider reports them): chunky thinking still shows life.
	pi.on("provider_stream_event", safe(() => tracker?.touch()));
	let lastUpdate = 0;
	pi.on(
		"message_update",
		safe((event: { assistantMessageEvent?: { type?: string } }) => {
			// Real output (text or a tool call), not thinking: only then is silence a hang.
			const kind = event.assistantMessageEvent?.type;
			if (kind === "text_start" || kind === "toolcall_start") tracker?.streamStart();
			const now = Date.now();
			if (now - lastUpdate > 1000) {
				lastUpdate = now;
				tracker?.touch();
			}
		}),
	);

	pi.on(
		"agent_start",
		safe(async () => {
			await connection?.request("activity", { busy: true });
			lastRun = undefined;
			const status = currentStatus();
			// `done` can be left again: a live interactable agent may be given more work.
			if (status && !["stopped", "timed-out"].includes(status)) setStatus("working", agentStartPatch());
			tracker?.touch();
		}),
	);
	pi.on(
		"turn_start",
		safe(() => tracker?.modelStart(pi.getThinkingLevel())),
	);
	pi.on(
		"message_end",
		safe((event: { message?: AssistantLike }) => {
			// Pi appends message_end AFTER extension handlers return. Check disk on the next event-loop turn,
			// never acknowledge sendMessage's volatile queue as persisted delivery.
			setImmediate(() => { void receipt().catch(error => log(String(error))); });
			if (event.message?.role === "assistant") {
				tracker?.modelEnd();
				lastRun = event.message;
			} else tracker?.touch();
		}),
	);
	pi.on(
		"tool_execution_start",
		safe((event: { toolCallId: string; toolName: string; args: unknown }) => {
			// A model that kept working after ask_* must not keep a "needs you" badge.
			if (resumedFromWaiting(event.toolName, currentStatus())) setStatus("working", { waitingOn: undefined });
			tracker?.toolStart(event.toolCallId, event.toolName, event.args);
		}),
	);
	pi.on(
		"tool_execution_end",
		safe((event: { toolCallId: string }) => tracker?.toolEnd(event.toolCallId)),
	);

	// Step-timeout guard: every bash call carries a deadline.
	pi.on(
		"tool_call",
		safe((event: { toolName: string; toolCallId: string; input: Record<string, unknown> }) => {
			if (event.toolName !== "bash" || !host.identity) return;
			const declared = typeof event.input.timeout === "number" && event.input.timeout > 0 ? event.input.timeout : undefined;
			// The user's own root session is never limited; only children get the default.
			const limited = host.identity.parent !== null;
			const seconds = declared ?? (limited ? Math.ceil(host.identity.stepTimeoutMs / 1000) : undefined);
			if (seconds === undefined) return;
			if (declared === undefined) event.input.timeout = seconds;
			tracker?.declareDeadline(event.toolCallId, Date.now() + seconds * 1000);
		}),
	);

	pi.on(
		"agent_settled",
		safe(async (event: { aborted?: boolean }) => {
			if (!id) return;
			try {
			tracker?.reset();
			const status = currentStatus();
			const outcome = settleDone({ pending: pendingDone, aborted: Boolean(event.aborted), status, failed: lastRun?.stopReason === "error" });
			pendingDone = false;
			if (host.identity && !host.identity.interactable) {
				if (status && !isTerminal(status)) finishNonInteractable(Boolean(event.aborted));
				return;
			}
			if (outcome === "finish") {
				// Wrap-up turn ended without report_done: finish on the agent's behalf, with its own last words.
				const summary = textOf(lastRun).slice(0, SUMMARY_MAX_CHARS);
				setStatus("done", { summary: summary || undefined, waitingOn: undefined, note: undefined });
				notifyParent(summary || "(no output)");
				return;
			}
			if ((outcome === "cancelled" || outcome === "asked") && ctx?.hasUI) {
				ctx.ui.notify(outcome === "cancelled" ? "Done request cancelled: the run was interrupted." : "Done request dropped: the agent asked a question instead. Answer it, then /agent-done again.", "warning");
			}
			if (lastRun?.stopReason === "error" && status && !isTerminal(status)) {
				setStatus("error", { summary: (lastRun.errorMessage ?? "model call failed").slice(0, ERROR_MAX_CHARS) });
				return;
			}
			if (status === "working" || status === "error") setStatus("idle");
			} finally {
				await receipt();
				await connection?.request("activity", { busy: false });
			}
		}),
	);
}
