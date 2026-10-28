import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentInput, Store } from "../store/index.ts";
import { DEFAULT_STEP_TIMEOUT_MS } from "../store/index.ts";

/**
 * Create the root agent record for a user's interactive pi. The agent id is the pi
 * session id, so the same session is always the same agent.
 */
export function createRootInput(store: Store, ctx: ExtensionContext, now = Date.now()): AgentInput {
	const forkedFrom = forkedFromOf(store, ctx.sessionManager.getHeader()?.parentSession);
	const name = ctx.sessionManager.getSessionName?.() || path.basename(ctx.cwd) || "root";
	const input: AgentInput = {
		id: ctx.sessionManager.getSessionId(),
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
		...(forkedFrom ? { forkedFrom } : {}),
	};
	store.create(input);
	return input;
}

/** Id of the session in a session file: the `id` of its first line (the header). */
function sessionIdOfFile(file: string): string | undefined {
	try {
		const fd = fs.openSync(file, "r");
		try {
			const buffer = Buffer.alloc(4096);
			const text = buffer.subarray(0, fs.readSync(fd, buffer, 0, buffer.length, 0)).toString("utf8");
			const id = (JSON.parse(text.split("\n")[0] ?? "") as { id?: unknown }).id;
			return typeof id === "string" ? id : undefined;
		} finally {
			fs.closeSync(fd);
		}
	} catch {
		return undefined;
	}
}

/** The agent a forked/cloned session came from: its parent session's id, when the store knows that agent. */
export function forkedFromOf(store: Store, parentSessionFile: string | undefined): string | undefined {
	const id = parentSessionFile ? sessionIdOfFile(parentSessionFile) : undefined;
	try {
		return id && store.exists(id) ? id : undefined;
	} catch {
		return undefined; // not a valid agent id
	}
}
