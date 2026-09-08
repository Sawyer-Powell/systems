/**
 * The shared handle every module receives. Built synchronously at load (`index.ts`
 * reads the agent id from `PI_AGENT_ID`, or from the `globalThis` copy that survives
 * `/reload`), so tool gating needs no session. `identity` and `ctx` are filled in by
 * `runtime` on `session_start`.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentInput, Store } from "./store/index.ts";

export interface AgentsHost {
	pi: ExtensionAPI;
	store: Store;
	/** `input.json` of this process's agent when launched by a supervisor; undefined for a root. */
	launched: AgentInput | undefined;
	/** Roots are interactable and depth 0. */
	interactable: boolean;
	depth: number;
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

/** This process's agent id survives `/reload` in a process global (module state does not). */
const globals = globalThis as { __piAgents?: { id?: string } };
export const readAgentId = (): string | undefined => globals.__piAgents?.id;
export const rememberAgentId = (id: string): void => void ((globals.__piAgents ??= {}).id = id);

export function selfId(host: AgentsHost): string {
	if (!host.identity) throw new Error("Agent identity is not available before session_start.");
	return host.identity.id;
}
