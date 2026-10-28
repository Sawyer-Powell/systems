/**
 * `/agent-done`: the user tells an agent to wrap up and mark itself done. Pure helpers shared by the
 * UI (who may be told, what happens) and the runtime (what the agent is told, how a wrap-up run ends).
 * The mechanism is a `control: "done"` mailbox message; the agent's own runtime turns it into a
 * wrap-up turn and writes its own `done` state (a parent never writes a live child's state).
 */
import type { AgentRecord, AgentStatus } from "./types.ts";

export type DonePlan =
	/** Alive: deliver `control: "done"`; the agent wraps up and marks itself done. */
	| { action: "send" }
	/** No process (lost): there is nobody to ask, the state of a dead agent is written directly. */
	| { action: "mark" }
	| { action: "noop"; reason: string }
	| { action: "refuse"; reason: string };

/** What `/agent-done` does to an agent in this state (see SPEC.md, "agent-done"). */
export function planDone(record: AgentRecord): DonePlan {
	const name = record.input.name;
	if (record.input.parent === null || record.input.role === "main") return { action: "refuse", reason: `${name} is a user session, not a child agent.` };
	switch (record.status) {
		case "done":
			return { action: "noop", reason: `${name} is already done.` };
		case "starting":
			return { action: "refuse", reason: `${name} is still starting; try again in a moment.` };
		case "lost":
			return { action: "mark" };
		case "stopped":
		case "timed-out":
		case "error":
		case "dormant":
			if (record.alive && record.status === "error") return { action: "send" }; // interactable, stays attachable
			return { action: "refuse", reason: `${name} is ${record.status} with no running process. Resume it first (/agents), then mark it done.` };
		default:
			return record.alive ? { action: "send" } : { action: "refuse", reason: `${name} has no running process.` };
	}
}

export type Resolved = { record: AgentRecord } | { error: string };

/** Find one agent among `candidates` by exact id, exact name, then unique id prefix or unique name prefix. */
export function resolveAgent(candidates: AgentRecord[], query: string): Resolved {
	const q = query.trim();
	if (!q) return { error: "Name an agent: /agent-done <id|name>." };
	const tiers: Array<(r: AgentRecord) => boolean> = [
		(r) => r.input.id === q,
		(r) => r.input.name === q,
		(r) => r.input.id.startsWith(q),
		(r) => r.input.name.startsWith(q),
	];
	for (const match of tiers) {
		const hits = candidates.filter(match);
		if (hits.length === 1) return { record: hits[0]! };
		if (hits.length > 1) return { error: `"${q}" is ambiguous: ${hits.map((r) => r.input.id).join(", ")}.` };
	}
	return { error: `No such agent among your descendants: ${q}.` };
}

/** The wrap-up instruction injected into the agent's context. Contains no data: only what to do. */
export function wrapUpText(): string {
	return [
		"The user has marked you done. Wrap up now; do not start new work.",
		"1. Stop background processes you started (dev servers, watchers, long-running commands). Do not touch anything you did not start.",
		"2. Do NOT delete jj workspaces, branches, zellij panes or tabs you created; list them in your report.",
		"3. Run `jj st` in each repo/workspace you changed and include the result (uncommitted files, current change) in your report. Do not commit, push, discard or revert anything.",
		"4. If you spawned child agents, note their ids and statuses in the report; do not kill them.",
		"5. Call report_done with a short factual summary of what you changed and ran, plus the items above. That sends your final report to your parent and marks you done.",
		"If you cannot finish without a decision, say so in the report instead of asking a question.",
	].join("\n");
}

export interface SettleInput {
	/** A done request is outstanding for this run. */
	pending: boolean;
	aborted: boolean;
	status: AgentStatus | undefined;
	/** The last assistant message ended in a model error. */
	failed: boolean;
}

export type SettleOutcome =
	| "none" // no request outstanding
	| "reported" // the agent called report_done itself
	| "finish" // the agent ended its wrap-up turn without report_done: the runtime marks it done
	| "cancelled" // the run was aborted (user interrupted): request dropped, status unchanged
	| "asked" // the agent asked a question instead: request dropped
	| "failed"; // model error: the normal error path applies, request dropped

/** How a run that carried a done request ends. Pure. */
export function settleDone(input: SettleInput): SettleOutcome {
	if (!input.pending) return "none";
	if (input.status === "done") return "reported";
	if (input.aborted) return "cancelled";
	if (input.status === "waiting-on-user" || input.status === "waiting-on-parent") return "asked";
	if (input.failed) return "failed";
	return "finish";
}

/** Summary used when a lost agent is marked done by hand: there is no final report. */
export const LOST_DONE_SUMMARY = "Marked done by the user while its process was gone; no final report. Check its workspace with `jj st` before discarding anything.";
