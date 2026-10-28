/** Display-only lineage names. Never use these labels as durable/routing identities. */
import type { AgentInput } from "./store/types.ts";

type Input = Pick<AgentInput, "id" | "name" | "parent">;
type Record = { input: Input };

/** Resolve by parent IDs, not array order; tolerate missing/cyclic ancestry. */
export function agentName(input: Input, ancestors: readonly Record[] | ReadonlyMap<string, Record> = [], options: { relativeTo?: string; maxLength?: number } = {}): string {
	const byId = "get" in ancestors ? ancestors : new Map(ancestors.map(record => [record.input.id, record]));
	const parts: string[] = [];
	const seen = new Set<string>();
	let current: Input | undefined = input;
	while (current && !seen.has(current.id)) {
		if (current.id === options.relativeTo && parts.length) break;
		seen.add(current.id);
		parts.unshift(current.name || current.id);
		if (!current.parent || seen.has(current.parent)) break;
		const parent: Input | undefined = byId.get(current.parent)?.input;
		if (!parent) parts.unshift(current.parent);
		current = parent;
	}
	const name = parts.join("::").replace(/[\x00-\x1f\x7f]/g, " ");
	const chars = [...name];
	const max = options.maxLength;
	return max && chars.length > max ? `…${chars.slice(-(max - 1)).join("")}` : name;
}

/** Store adapter; unknown external senders (e.g. user) retain their literal identity. */
export function agentLabel(store: { readInput(id: string): AgentInput | undefined; ancestors(id: string): { input: AgentInput }[] }, id: string): string {
	try {
		const input = store.readInput(id);
		return input ? agentName(input, store.ancestors(id)) : id;
	} catch { return id; }
}
