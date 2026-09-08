import * as path from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentInput, Store } from "../store/index.ts";
import { DEFAULT_STEP_TIMEOUT_MS, newId } from "../store/index.ts";

/** Create the root agent record for a user's interactive pi. */
export function createRootInput(store: Store, ctx: ExtensionContext, now = Date.now()): AgentInput {
	const name = path.basename(ctx.cwd) || "root";
	const id = newId("main", name);
	const input: AgentInput = {
		id,
		role: "main",
		name,
		parent: null,
		objective: "interactive session",
		profile: {
			name: "main",
			modelId: ctx.model?.id ?? "unknown",
			provider: ctx.model?.provider,
			thinking: ctx.thinkingLevel ?? "off",
		},
		cwd: ctx.cwd,
		interactable: true,
		stepTimeoutMs: DEFAULT_STEP_TIMEOUT_MS,
		depth: 0,
		createdAt: now,
	};
	store.create(input);
	return input;
}

/** Session entry that ties a pi session to its root agent, so resuming the session shows its agents. */
export const ROOT_ENTRY = "agents.root";

/** The root id recorded in a session branch (the latest entry wins). */
export function savedRootId(entries: Iterable<{ type: string; customType?: string; data?: unknown }>): string | undefined {
	let found: string | undefined;
	for (const entry of entries) {
		const id = (entry.data as { id?: unknown } | undefined)?.id;
		if (entry.type === "custom" && entry.customType === ROOT_ENTRY && typeof id === "string") found = id;
	}
	return found;
}

/**
 * Pick the root agent for a session, in order: the one recorded in the session
 * (resume, fork), then the one this process already had (`/new` keeps its agents),
 * else a fresh one. A root is usable when it exists, is a root, and no other live
 * process holds it.
 */
export function chooseRoot(store: Store, saved: string | undefined, previous: AgentInput | undefined, create: () => AgentInput): AgentInput {
	for (const id of [saved, previous?.id]) {
		if (!id) continue;
		const record = store.readInput(id);
		const heldElsewhere = store.isAlive(id) && store.lockPid(id) !== process.pid;
		if (record && record.role === "main" && record.parent === null && !heldElsewhere) return record;
	}
	return create();
}
