/**
 * `agents`: durable, nestable, attachable agents. Replaces the old `subagents`
 * extension. All state lives in the file store (`store/`); this file only wires
 * modules together. Design: see SPEC.md.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type AgentsHost, maxDepth } from "./host.ts";
import { registerRuntime } from "./runtime/index.ts";
import { createStore } from "./store/index.ts";
import { createSupervisor } from "./supervisor/index.ts";
import { startWatchdog } from "./supervisor/watchdog.ts";
import { registerTools } from "./tools/index.ts";
import { registerUi } from "./ui/index.ts";

export default function (pi: ExtensionAPI) {
	const store = createStore();
	const host: AgentsHost = {
		pi,
		store,
		canSpawn: false, // needs identity (depth) and settings; both are only available on session_start
		identity: undefined,
		ctx: undefined,
	};

	const supervisor = createSupervisor(host);

	registerRuntime(host); // sets host.identity/ctx on session_start; must be registered first
	// After runtime (identity known), before tools/ui/watchdog (they read canSpawn).
	pi.on("session_start", () => {
		host.canSpawn = Boolean(host.identity?.interactable) && host.identity!.depth < maxDepth(pi);
	});
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
