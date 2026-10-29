/**
 * The shared handle every module receives. Identity is the pi session id (agent id ===
 * session id), so it is only known at `session_start`, when `runtime` fills in `identity`
 * and `ctx`. Anything that depends on who we are (tool gating, spawn rights) is set up then.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentInput, Store } from "./store/index.ts";
import type { AgentConnection } from "./central/client.ts";

export interface AgentsHost {
	pi: ExtensionAPI;
	store: Store;
	connection?: AgentConnection;
	/** Local request only, not an accepted handoff. Runtime commits it after the tool batch completes. */
	pendingYield?: { to: "parent" | "user"; message: string; messageId: string };
	/** Set from the finalized assistant message, before any tool in that batch executes. */
	soleYieldCallId?: string;
	/** interactable && depth < settings.agents.maxDepth. False until session_start (settings are unreadable while loading). */
	canSpawn: boolean;
	/** This process's own agent. Set by `runtime` on session_start; undefined before. */
	identity: AgentInput | undefined;
	/** Latest session context. Set by `runtime` on session_start. */
	ctx: ExtensionContext | undefined;
}

const DEFAULT_MAX_DEPTH = 3;

/** `settings.agents.maxDepth`: how deep the agent tree may grow. */
export function maxDepth(pi: ExtensionAPI): number {
	const configured = (pi.getSettings() as { agents?: { maxDepth?: number } }).agents?.maxDepth;
	return typeof configured === "number" && configured >= 0 ? configured : DEFAULT_MAX_DEPTH;
}

export function selfId(host: AgentsHost): string {
	if (!host.identity) throw new Error("Agent identity is not available before session_start.");
	return host.identity.id;
}
