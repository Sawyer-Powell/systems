/**
 * Model-facing tools. Registration is the gate: an agent that must not have a
 * tool never sees it. Results are short strings; message bodies from other agents
 * arrive as messages (see runtime), not as tool output.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { AgentsHost } from "../host.ts";
import { selfId } from "../host.ts";
import { type AgentRecord, deliveryForParent, ERROR_MAX_CHARS, type MessageKind, normalizeNote, SUMMARY_MAX_CHARS } from "../store/index.ts";
import type { Supervisor } from "../supervisor/index.ts";

type Result = { content: { type: "text"; text: string }[]; details: undefined };
const text = (value: string): Result => ({ content: [{ type: "text", text: value }], details: undefined });

const SUMMARY_WIDTH = 60;

export function describeRecord(record: AgentRecord, now = Date.now()): string {
	const state = record.state;
	const bits = [record.input.id, record.input.role, record.status];
	if (state && (record.status === "working" || record.status === "idle")) {
		const quiet = Math.round((now - state.activity.lastEventAt) / 1000);
		bits.push(state.activity.inFlight ? `running ${state.activity.inFlight.summary}` : `quiet ${quiet}s`);
	}
	if (state?.note) bits.push(state.note);
	if (state?.summary) bits.push(state.summary.replace(/\s+/g, " ").slice(0, SUMMARY_WIDTH));
	return bits.join(" · ");
}

export function registerTools(host: AgentsHost, supervisor: Supervisor): void {
	const { pi } = host;
	const isChild = host.launched !== undefined && host.launched.parent !== null;

	registerMessaging(pi, host);
	if (isChild) registerReporting(pi, host);

	// Spawn rights depend on settings (maxDepth), readable only once the session
	// exists, so these tools are registered on session_start, once per runtime.
	let controlRegistered = false;
	pi.on("session_start", () => {
		if (controlRegistered || !host.canSpawn) return;
		controlRegistered = true;
		registerControl(pi, host, supervisor);
	});
}

function registerMessaging(pi: ExtensionAPI, host: AgentsHost) {
	const { store } = host;
	pi.registerTool({
		name: "send_message",
		label: "Send Message",
		description:
			"Send a message to your parent (`to: \"parent\"`) or to one of your descendants. Siblings cannot be messaged. " +
			"Use kind `answer` with `in_reply_to` to answer a question; `instruction` to direct a child; `info` otherwise.",
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
			const message = store.send({
				from: me,
				to,
				kind,
				body: params.body,
				inReplyTo: params.in_reply_to,
				deliver: "context",
			});
			return text(`Sent ${kind} ${message.id} to ${to}.`);
		},
	});
}

function registerReporting(pi: ExtensionAPI, host: AgentsHost) {
	const { store } = host;

	pi.registerTool({
		name: "ask_parent",
		label: "Ask Parent",
		description:
			"Ask your parent agent a question. Non-blocking: after calling this, end your turn. The answer arrives later as a message.",
		parameters: Type.Object({ question: Type.String({ description: "The question." }) }),
		async execute(_id, params) {
			const me = selfId(host);
			const parent = host.identity?.parent;
			if (!parent) throw new Error("You have no parent to ask.");
			const message = store.send({ from: me, to: parent, kind: "question", body: params.question, deliver: "context" });
			store.writeState(me, { status: "waiting-on-parent", waitingOn: { messageId: message.id } });
			return text("Question sent. End your turn now; the answer will arrive as a message.");
		},
	});

	if (host.interactable) {
		pi.registerTool({
			name: "ask_user",
			label: "Ask User",
			description:
				"Flag the human that you cannot proceed without their decision. Non-blocking: after calling this, end your turn. Do NOT use this for progress or status updates; use set_status for that.",
			parameters: Type.Object({ question: Type.String({ description: "What you need from the human." }) }),
			async execute(_id, params) {
				const me = selfId(host);
				store.writeState(me, { status: "waiting-on-user", summary: params.question.slice(0, ERROR_MAX_CHARS) });
				return text("The user has been flagged. End your turn now.");
			},
		});
	}

	pi.registerTool({
		name: "set_status",
		label: "Set Status",
		description:
			"Set a one-line status (max 60 chars) shown in the user's agent list. Use for progress updates (e.g. 'running tests', 'waiting on CI'). " +
			"Never put data values, patient or customer information in it. Use ask_user only when you cannot proceed without a human decision, never for status.",
		parameters: Type.Object({ note: Type.String({ description: "One short line." }) }),
		async execute(_id, params) {
			// Only the note changes: never the status, never a message.
			store.writeState(selfId(host), { note: normalizeNote(params.note) || undefined });
			return text("Status set.");
		},
	});

	pi.registerTool({
		name: "report_done",
		label: "Report Done",
		description: "Report that your objective is complete, with a short factual summary of what you changed and ran.",
		parameters: Type.Object({ summary: Type.String({ description: "What you did and what you ran." }) }),
		async execute(_id, params) {
			const me = selfId(host);
			const parent = host.identity?.parent;
			store.writeState(me, { status: "done", summary: params.summary.slice(0, SUMMARY_MAX_CHARS), waitingOn: undefined, note: undefined });
			if (parent) {
				store.send({ from: me, to: parent, kind: "result", body: params.summary, deliver: deliveryForParent(store, parent) });
			}
			return text("Reported. You may stop.");
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
			"Results arrive as messages; status is shown in the user's widget.",
		parameters: Type.Object({
			profile: Type.String({ description: "Profile name (see list_agents output or the profiles directory)." }),
			objective: Type.String({ description: "A concrete objective, including acceptance criteria." }),
			name: Type.Optional(Type.String({ description: "Short slug for the agent id." })),
			step_timeout_seconds: Type.Optional(Type.Number({ description: "Max time one step may take without activity. Default 180." })),
			run_timeout_seconds: Type.Optional(Type.Number({ description: "Whole-run limit; non-interactable profiles only. Default 300." })),
		}),
		async execute(_id, params) {
			const input = await supervisor.spawn({
				profile: params.profile,
				objective: params.objective,
				name: params.name,
				stepTimeoutMs: params.step_timeout_seconds ? params.step_timeout_seconds * 1000 : undefined,
				runTimeoutMs: params.run_timeout_seconds ? params.run_timeout_seconds * 1000 : undefined,
			});
			const how = input.interactable ? "Attach with /agents." : "It runs headless and reports back.";
			return text(`Started ${input.id} (${input.role}). ${how} Do not wait for it.`);
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
			return text(`Resumed ${params.id}.`);
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
			return text(`Interrupt sent to ${params.id}.`);
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
			return text(`Killed ${params.id}.`);
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
			return text(`Redriven ${params.id}.`);
		},
	});

	pi.registerTool({
		name: "list_agents",
		label: "List Agents",
		description: "List your descendants (one line each: id, role, status, activity), plus the available profiles.",
		parameters: Type.Object({}),
		async execute() {
			const me = selfId(host);
			const lines = store.descendants(me).map((record) => describeRecord(record));
			const profiles = supervisor
				.profiles()
				.map((p) => `${p.name}${p.interactable ? " (interactable)" : ""}: ${p.description}`);
			return text([lines.length ? lines.join("\n") : "No agents.", "", "Profiles:", ...profiles].join("\n"));
		},
	});
}
