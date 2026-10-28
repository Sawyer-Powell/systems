/**
 * Model-facing tools. Registration is the gate: an agent that must not have a
 * tool never sees it. Results are short strings; message bodies from other agents
 * arrive as messages (see runtime), not as tool output.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { AgentsHost } from "../host.ts";
import { selfId } from "../host.ts";
import { type AgentRecord, type MessageKind, normalizeNote, SPAWN_ENTRY, spawnClaim } from "../store/index.ts";
import type { Supervisor } from "../supervisor/index.ts";

import { agentLabel, agentName } from "../names.ts";

type Result = { content: { type: "text"; text: string }[]; details: undefined };
const text = (value: string): Result => ({ content: [{ type: "text", text: value }], details: undefined });

const SUMMARY_WIDTH = 60;

export function describeRecord(record: AgentRecord, now = Date.now(), name = agentName(record.input)): string {
	const state = record.state;
	const bits = [`${name} (id: ${record.input.id})`, record.input.role, record.status];
	if (state && (record.status === "working" || record.status === "idle")) {
		const quiet = Math.round((now - state.activity.lastEventAt) / 1000);
		const step = state.activity.inFlight;
		// A step in flight: how long it has run and how long since the last event, so a long but live request reads differently from a silent one.
		bits.push(step ? `running ${step.summary} ${Math.round((now - step.startedAt) / 1000)}s (quiet ${quiet}s)` : `quiet ${quiet}s`);
	}
	if (state?.note) bits.push(state.note);
	if (state?.reason) bits.push(state.reason.replace(/\s+/g, " ").slice(0, SUMMARY_WIDTH));
	if (state?.summary) bits.push(state.summary.replace(/\s+/g, " ").slice(0, SUMMARY_WIDTH));
	return bits.join(" · ");
}

export function registerTools(host: AgentsHost, supervisor: Supervisor): void {
	const { pi } = host;

	// Which tools exist depends on who we are (child or root, spawn rights), known only once
	// the session exists, so these are registered on session_start, once per runtime.
	let registered = false;
	pi.on("session_start", () => {
		if (registered || !host.identity) return;
		registered = true;
		registerMessaging(pi, host); // not for sessions that are not agents (print/rpc one-offs)
		if (host.identity.parent) registerReporting(pi, host);
		if (host.canSpawn) registerControl(pi, host, supervisor);
	});
}

function registerMessaging(pi: ExtensionAPI, host: AgentsHost) {
	const { store } = host;
	pi.registerTool({
		name: "send_message",
		label: "Send Message",
		description:
			"Send a message to your parent (`to: \"parent\"`) or to one of your descendants. Siblings cannot be messaged. " +
			"Use kind `answer` with `in_reply_to` to answer a question; `instruction` to direct a child; `info` for requested signals or material scope/safety surprises. " +
			"Parent messages wake an idle model or steer a busy one, including info. Default: quiet; no routine progress/phase updates. Use set_status or a notes artifact instead.",
		parameters: Type.Object({
			to: Type.String({ description: 'Agent id, or "parent".' }),
			body: Type.String({ description: "Message text." }),
			kind: Type.Optional(
				Type.Union([Type.Literal("instruction"), Type.Literal("answer"), Type.Literal("info")], { description: "Defaults to instruction for descendants, info for the parent." }),
			),
			in_reply_to: Type.Optional(Type.String({ description: "Id of the question being answered." })),
		}),
		async execute(_id, params) {
			const me = selfId(host);
			const to = params.to === "parent" ? host.identity?.parent : params.to;
			if (!to) throw new Error("You have no parent.");
			const toParent = to === host.identity?.parent;
			const kind: MessageKind = params.kind ?? (toParent ? "info" : "instruction");
			const partial = {
				from: me,
				to,
				kind,
				body: params.body,
				inReplyTo: params.in_reply_to,
				deliver: "context" as const,
			};
			await host.connection?.flush();
			const message = host.connection ? await host.connection.request("send", { message: partial }) : store.send(partial);
			return text(`Sent ${kind} ${message.id} to ${agentLabel(store, to)} (id: ${to}).${message.deferred ? ` Delivery deferred (${message.deferred}); explicit restore/recovery/reconnect is required.` : ""}`);
		},
	});
}

function registerReporting(pi: ExtensionAPI, host: AgentsHost) {
	const { store } = host;

	pi.registerTool({
		name: "ask_parent",
		label: "Ask Parent",
		description:
			"Ask your parent agent a question that only it can answer. Non-blocking: after calling this, end your turn. The answer arrives later as a message. Do NOT use this for progress or status updates; use set_status for that.",
		parameters: Type.Object({ question: Type.String({ description: "The question." }) }),
		async execute(_id, params) {
			const me = selfId(host);
			const parent = host.identity?.parent;
			if (!parent) throw new Error("You have no parent to ask.");
			const message = store.send({ from: me, to: parent, kind: "question", body: params.question, deliver: "context" });
			store.writeState(me, { status: "waiting-on-parent", waitingOn: { messageId: message.id } });
			await host.connection?.flush();
			return text("Question sent. End your turn now; the answer will arrive as a message.");
		},
	});

	pi.registerTool({
		name: "yield", label: "Yield",
		description: "Hand work back, then stop autonomous work at the tool-batch boundary. Call this ALONE as your final tool. " +
			"to parent means work completed: a special durable handoff wakes your parent's MODEL, including a human root. " +
			"to user flags human attention for review, a decision or conversation, without waking your parent's model. " +
			"Use parent yield once work is complete, never for progress or phase changes; follow the parent's reporting format/length. " +
			"Non-interactable profiles yield to parent unless a human explicitly requested a handoff. This never archives you.",
		parameters: Type.Object({ to: Type.Union([Type.Literal("parent"), Type.Literal("user")]), message: Type.String() }),
		executionMode: "sequential",
		async execute(toolCallId, params, signal) {
			if (host.soleYieldCallId !== toolCallId) throw new Error("Finish other tools, then call yield by itself");
			if (!host.connection) throw new Error("Durable yield requires the central runtime");
			if (host.pendingYield) throw new Error("A yield is already requested; call it alone as your final tool");
			if (params.to === "user" && !host.identity?.interactable && !store.readState(selfId(host))?.yieldRequested) throw new Error("This profile yields to parent unless the human requested a handoff");
			await host.connection.flush();
			if (signal?.aborted) throw new Error("Yield interrupted before handoff acceptance");
			host.pendingYield = { ...params, messageId: `yield:${selfId(host)}:${toolCallId}` };
			return { ...text(`Yield to ${params.to} requested. The runtime commits the durable handoff after this tool batch finishes.`), terminate: true };
		},
	});

	pi.registerTool({
		name: "set_status",
		label: "Set Status",
		description:
			"Set a one-line status (max 60 chars) shown in the agent list and parent snapshots without waking the parent. Use sparingly for meaningful activity changes (e.g. 'running tests', 'waiting on CI'). " +
			"Never put data values, patient or customer information in it. Use yield(to: user) when the human should review, decide or converse, never for progress.",
		parameters: Type.Object({ note: Type.String({ description: "One short line." }) }),
		async execute(_id, params) {
			// Only the note changes: never the status, never a message.
			store.writeState(selfId(host), { note: normalizeNote(params.note) || undefined });
			await host.connection?.flush();
			return text("Status set.");
		},
	});

}

function registerControl(pi: ExtensionAPI, host: AgentsHost, supervisor: Supervisor) {
	const { store } = host;

	/** Control tools may only touch the caller's own descendants. */
	function owned(id: string): void {
		const me = selfId(host);
		if (!store.descendants(me).some((record) => record.input.id === id)) {
			throw new Error(`${id} is not one of your descendants.`);
		}
	}

	pi.registerTool({
		name: "spawn_agent",
		label: "Spawn Agent",
		description:
			"Start a background agent from a profile. Returns immediately; do not wait. Interactable profiles (e.g. worker) can be attached to by the user; others run headless with a whole-run timeout. " +
			"Results arrive as messages; status is shown in the user's widget. Specify reporting triggers and final-handoff format/length when needed; omitted means quiet (final + blocking questions, with material scope/safety exceptions). Do not request routine updates unless you need to act on them.",
		parameters: Type.Object({
			profile: Type.String({ description: "Profile name (see list_agents output or the profiles directory)." }),
			objective: Type.String({ description: "A concrete objective, including acceptance criteria." }),
			reporting: Type.Optional(Type.String({ description: "Parent signaling policy: when to notify (blocking only, named milestones, specific findings/conditions), and final-handoff sections/length cap. Default: quiet; final <=200 words with result, paths, verification, risks/questions. Overrides may also be written in the objective; keep them consistent." })),
			name: Type.Optional(Type.String({ description: "Short slug for the agent id." })),
			step_timeout_seconds: Type.Optional(Type.Number({ description: "Max time one step may take without activity. Default 180." })),
			run_timeout_seconds: Type.Optional(Type.Number({ description: "Whole-run limit; non-interactable profiles only. Default 300." })),
		}),
		async execute(_id, params) {
			const input = await supervisor.spawn({
				profile: params.profile,
				objective: params.objective,
				reporting: params.reporting,
				name: params.name,
				stepTimeoutMs: params.step_timeout_seconds ? params.step_timeout_seconds * 1000 : undefined,
				runTimeoutMs: params.run_timeout_seconds ? params.run_timeout_seconds * 1000 : undefined,
			});
			pi.appendEntry(SPAWN_ENTRY, { ...spawnClaim(input, Date.now()), name: agentLabel(store, input.id) }); // this branch's claim; the store stays the authority
			const how = input.interactable ? "Attach with /agents." : "It runs headless and reports back.";
			const tools = input.profile.tools;
			const toolNote = tools ? ` Tools: ${tools.join(", ")}${tools.includes("bash") ? "" : " (no shell: it cannot run commands such as jj/git/pytest)"}.` : "";
			return text(`Started ${agentLabel(store, input.id)} (id: ${input.id}; ${input.role}). ${how}${toolNote} Do not wait for it.`);
		},
	});

	pi.registerTool({
		name: "resume_agent",
		label: "Resume Agent",
		description: "Relaunch a stopped or lost descendant from its saved session, with an instruction.",
		parameters: Type.Object({ id: Type.String(), instruction: Type.Optional(Type.String()) }),
		async execute(_id, params) {
			owned(params.id);
			await supervisor.resume(params.id, params.instruction);
			return text(`Resumed ${agentLabel(store, params.id)} (id: ${params.id}).`);
		},
	});

	pi.registerTool({
		name: "interrupt_agent",
		label: "Interrupt Agent",
		description: "Ask a descendant to abort its current run (it stays alive). Use when it is mid-run and off track.",
		parameters: Type.Object({ id: Type.String() }),
		async execute(_id, params) {
			owned(params.id);
			await supervisor.signal(params.id, "interrupt");
			return text(`Interrupt sent to ${agentLabel(store, params.id)} (id: ${params.id}).`);
		},
	});

	pi.registerTool({
		name: "kill_agent",
		label: "Kill Agent",
		description: "Terminate a descendant's process group. Last resort; use interrupt_agent first.",
		parameters: Type.Object({ id: Type.String() }),
		async execute(_id, params) {
			owned(params.id);
			await supervisor.signal(params.id, "kill");
			return text(`Killed ${agentLabel(store, params.id)} (id: ${params.id}).`);
		},
	});

	pi.registerTool({
		name: "redrive_agent",
		label: "Redrive Agent",
		description: "Kill a stalled descendant, then resume it with a note about why (for example which step to avoid).",
		parameters: Type.Object({ id: Type.String(), note: Type.String() }),
		async execute(_id, params) {
			owned(params.id);
			await supervisor.redrive(params.id, params.note);
			return text(`Redriven ${agentLabel(store, params.id)} (id: ${params.id}).`);
		},
	});

	for (const operation of ["archive", "restore"] as const) {
		pi.registerTool({
			name: `${operation}_agent`, label: operation === "archive" ? "Archive Agent" : "Restore Agent",
			description: operation === "archive"
				? "Explicitly retire your direct child, retaining its conversation. Requires detached settled parking; never interrupts work, affects attachments or cascades to children. Archived messages are deferred."
				: "Explicitly restore your archived direct child and make queued work eligible for delivery. Never restores from an ordinary message.",
			parameters: Type.Object({ id: Type.String() }),
			async execute(_id, params) {
				const actor = selfId(host);
				if (store.readInput(params.id)?.parent !== actor) throw new Error("Only the direct owning parent may archive/restore this agent");
				if (!host.connection) throw new Error("Archive/restore requires the central runtime");
				await host.connection.flush();
				await host.connection.request(operation, { id: params.id, actor });
				return text(`${operation === "archive" ? "Archived" : "Restored"} ${agentLabel(store, params.id)} (id: ${params.id}).`);
			},
		});
	}

	pi.registerTool({
		name: "list_agents",
		label: "List Agents",
		description: "List your descendants (id, role, state, activity) and profiles. Archived agents are hidden unless include_archived is true.",
		parameters: Type.Object({ include_archived: Type.Optional(Type.Boolean()) }),
		async execute(_id, params) {
			const me = selfId(host);
			const lines = store.descendants(me).filter(record => params.include_archived || record.status !== "archived").map(record => describeRecord(record, Date.now(), agentLabel(store, record.input.id)));
			const profiles = supervisor
				.profiles()
				.map((p) => `${p.name}${p.interactable ? " (interactable)" : ""}: ${p.description}`);
			return text([lines.length ? lines.join("\n") : "No agents.", "", "Profiles:", ...profiles].join("\n"));
		},
	});
}
