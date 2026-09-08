/**
 * `agents`: durable, nestable, attachable agents. Replaces the old `subagents`
 * extension. All state lives in the file store (`store/`); this file only wires
 * modules together. Design: see SPEC.md.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type AgentsHost, maxDepth, readAgentId, rememberAgentId } from "./host.ts";
import { registerRuntime } from "./runtime/index.ts";
import { createStore } from "./store/index.ts";
import { createSupervisor } from "./supervisor/index.ts";
import { startWatchdog } from "./supervisor/watchdog.ts";
import { registerTools } from "./tools/index.ts";
import { registerUi } from "./ui/index.ts";

export default function (pi: ExtensionAPI) {
	const store = createStore();
	// Identity survives /reload via a process global. The env var is consumed here and
	// removed, so a pi started from this agent's bash can never adopt its identity.
	const envId = process.env.PI_AGENT_ID?.trim();
	delete process.env.PI_AGENT_ID;
	if (envId) rememberAgentId(envId);
	const launchedId = readAgentId();
	const launched = launchedId ? store.readInput(launchedId) : undefined;
	const depth = launched?.depth ?? 0;
	const interactable = launched?.interactable ?? true;

	const host: AgentsHost = {
		pi,
		store,
		launched,
		interactable,
		depth,
		canSpawn: false, // needs settings, which are unavailable while the factory runs; set on session_start
		identity: undefined,
		ctx: undefined,
	};

	const supervisor = createSupervisor(host);

	// Registered before every other session_start handler so they all see the right value.
	pi.on("session_start", () => {
		host.canSpawn = host.interactable && host.depth < maxDepth(pi);
	});

	registerRuntime(host); // sets host.identity/ctx on session_start
	registerTools(host, supervisor);
	registerUi(host, supervisor);

	let stopWatchdog: (() => void) | undefined;
	pi.on("session_start", () => {
		if (host.canSpawn) stopWatchdog = startWatchdog(host);
	});
	pi.on("session_shutdown", () => {
		stopWatchdog?.();
		stopWatchdog = undefined;
	});
}
