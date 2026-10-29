/** Human wrap-up requests, distinct from completion and process residency. */
import type { AgentRecord } from "./types.ts";

export function planYield(record: AgentRecord): { action: "send" } | { action: "refuse"; reason: string } {
	const { input, status, residency } = record;
	if (!input.parent) return { action: "refuse", reason: "A human root is not a managed worker." };
	if (status === "archived") return { action: "refuse", reason: "Restore this agent before requesting a yield." };
	if (status === "blocked" || residency === "blocked") return { action: "refuse", reason: "Resolve the blocked execution owner first; no completion can be inferred." };
	if (residency === "starting") return { action: "refuse", reason: "This agent is still starting; try again after its ownership handshake." };
	if (!record.alive && residency !== "parked") return { action: "refuse", reason: "No safely owned session is available to request a yield." };
	return { action: "send" };
}

export type Resolved = { record: AgentRecord } | { error: string };
export function resolveAgent(candidates: AgentRecord[], query: string): Resolved {
	const q = query.trim();
	if (!q) return { error: "Name an agent: /agent-yield <id|name>." };
	const tiers = [
		(r: AgentRecord) => r.input.id === q,
		(r: AgentRecord) => r.input.name === q,
		(r: AgentRecord) => r.input.id.startsWith(q),
		(r: AgentRecord) => r.input.name.startsWith(q),
	];
	for (const match of tiers) {
		const hits = candidates.filter(match);
		if (hits.length === 1) return { record: hits[0]! };
		if (hits.length > 1) return { error: `"${q}" is ambiguous: ${hits.map(r => r.input.id).join(", ")}.` };
	}
	return { error: `No such agent among your descendants: ${q}.` };
}

export function wrapUpText(): string {
	return [
		"The user requests a handoff to them. Wrap up safely; do not start new work.",
		"Stop background processes you started, not anyone else's. Do not delete workspaces or panes; report them.",
		"Run `jj st` in workspaces you changed. Do not commit, push, discard or revert anything.",
		"Include child agents and their current states; do not kill them.",
		'Call yield with to: "user" and a factual message explaining work, verification and anything needing review.',
		"Call yield alone as your final tool. It hands off at the current tool-batch boundary, without aborting other tools.",
	].join("\n");
}
