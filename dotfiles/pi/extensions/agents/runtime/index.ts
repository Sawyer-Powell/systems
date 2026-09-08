/**
 * In-agent plumbing, loaded in every agent process: lock, state, heartbeat,
 * activity tracking, inbox delivery, control messages, step-timeout guard, and
 * terminal-state handling. See SPEC.md.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type AgentsHost, rememberAgentId } from "../host.ts";
import {
	type AgentMessage,
	type AgentStatus,
	deliveryForParent,
	ERROR_MAX_CHARS,
	HEARTBEAT_MS,
	isTerminal,
	SUMMARY_MAX_CHARS,
} from "../store/index.ts";
import { ActivityTracker } from "./activity.ts";
import { chooseRoot, createRootInput, ROOT_ENTRY, savedRootId } from "./identity.ts";
import { InboxPump } from "./inbox.ts";

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
function safe<A extends unknown[]>(fn: (...args: A) => unknown): (...args: A) => void {
	return (...args: A) => {
		try {
			const result = fn(...args);
			if (result instanceof Promise) result.catch((error) => log(String(error)));
		} catch (error) {
			log(String(error));
		}
	};
}

export function registerRuntime(host: AgentsHost): void {
	const { pi, store } = host;

	let id: string | undefined;
	let ctx: ExtensionContext | undefined;
	let tracker: ActivityTracker | undefined;
	let pump: InboxPump | undefined;
	let heartbeat: ReturnType<typeof setInterval> | undefined;
	let runTimer: ReturnType<typeof setTimeout> | undefined;
	let lastRun: AssistantLike | undefined;
	let sessionStartedAt = 0;

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
			if (message.ts < sessionStartedAt) return;
			if (message.control === "interrupt") ctx.abort();
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
		if (message.deliver === "ui") {
			if (ctx.hasUI) ctx.ui.notify(`[${message.from}] ${message.kind}: ${message.body.slice(0, 200)}`, "info");
			return;
		}
		const text = `[from ${message.from} · ${message.kind} · ${message.id}]\n${message.body}`;
		await pi.sendUserMessage(text, ctx.isIdle() ? undefined : { deliverAs: "steer" });
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
		ctx?.shutdown();
		// Backstop: pi may linger on open handles after shutdown.
		setTimeout(() => process.exit(0), 10_000).unref();
	}

	pi.on(
		"session_start",
		safe((_event, context: ExtensionContext) => {
			ctx = context;
			host.ctx = context;

			// A launched child keeps its identity. A root follows its pi session: the root
			// recorded in the session (resume/fork), else the process's previous one (/new).
			let input = host.launched?.parent ? host.launched : undefined;
			if (!input) {
				if (context.mode !== "tui") return; // headless one-offs are not agents
				const saved = savedRootId(context.sessionManager.getBranch());
				input = chooseRoot(store, saved, host.launched, () => createRootInput(store, context));
				rememberAgentId(input.id); // survives /reload: the next factory reads it
				if (saved !== input.id) pi.appendEntry(ROOT_ENTRY, { id: input.id });
			}
			try {
				store.acquireLock(input.id);
			} catch (error) {
				log(`runtime disabled: ${String(error)}`);
				return;
			}
			id = input.id;
			host.identity = input;
			sessionStartedAt = Date.now();

			store.writeState(id, {
				status: "idle",
				sessionFile: context.sessionManager.getSessionFile(),
				summary: undefined,
			});
			tracker = new ActivityTracker({ store, id });
			tracker.heartbeat();
			heartbeat = setInterval(() => tracker?.heartbeat(), HEARTBEAT_MS);
			heartbeat.unref?.();

			pump = new InboxPump({ store, id, deliver });
			pump.start();

			if (!input.interactable && input.runTimeoutMs !== undefined) {
				const runStart = store.readState(input.id)?.runStartedAt ?? sessionStartedAt;
				const remaining = Math.max(1000, runStart + input.runTimeoutMs - Date.now());
				runTimer = setTimeout(
					safe(() => {
						setStatus("timed-out", { summary: `whole-run limit of ${Math.round(input.runTimeoutMs! / 1000)}s exceeded` });
						notifyParent(`TIMED OUT after ${Math.round(input.runTimeoutMs! / 1000)}s`);
						context.abort();
						context.shutdown();
					}),
					remaining,
				);
				runTimer.unref?.();
			}
		}),
	);

	pi.on(
		"session_shutdown",
		safe((event: { reason?: string }) => {
			pump?.stop();
			pump = undefined;
			if (heartbeat) clearInterval(heartbeat);
			heartbeat = undefined;
			if (runTimer) clearTimeout(runTimer);
			runTimer = undefined;
			tracker?.reset();
			if (id) {
				// Only /reload and /new continue as this same agent; quit, resume and fork leave it.
				if (event.reason !== "reload" && event.reason !== "new") {
					const status = currentStatus();
					if (status && !isTerminal(status)) setStatus("stopped");
				}
				store.releaseLock(id);
			}
			id = undefined;
			ctx = undefined;
			host.identity = undefined;
		}),
	);

	const touch = safe(() => tracker?.touch());
	pi.on("turn_end", touch);
	pi.on("message_start", touch);
	let lastUpdate = 0;
	pi.on(
		"message_update",
		safe(() => {
			const now = Date.now();
			if (now - lastUpdate > 1000) {
				lastUpdate = now;
				tracker?.touch();
			}
		}),
	);

	pi.on(
		"agent_start",
		safe(() => {
			lastRun = undefined;
			const status = currentStatus();
			// `done` can be left again: a live interactable agent may be given more work.
			if (status && !["stopped", "timed-out"].includes(status)) setStatus("working", agentStartPatch());
			tracker?.touch();
		}),
	);
	pi.on(
		"turn_start",
		safe(() => tracker?.modelStart()),
	);
	pi.on(
		"message_end",
		safe((event: { message?: AssistantLike }) => {
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
		safe((event: { aborted?: boolean }) => {
			if (!id) return;
			tracker?.reset();
			const status = currentStatus();
			if (host.identity && !host.identity.interactable) {
				if (status && !isTerminal(status)) finishNonInteractable(Boolean(event.aborted));
				return;
			}
			if (lastRun?.stopReason === "error" && status && !isTerminal(status)) {
				setStatus("error", { summary: (lastRun.errorMessage ?? "model call failed").slice(0, ERROR_MAX_CHARS) });
				return;
			}
			if (status === "working" || status === "error") setStatus("idle");
		}),
	);
}
