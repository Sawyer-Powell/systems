/** Native Pi clients of the single durable agents runtime. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type AgentsHost, maxDepth } from "./host.ts";
import { AgentConnection } from "./central/client.ts";
import { registerRuntime } from "./runtime/index.ts";
import { createSupervisor } from "./supervisor/index.ts";
import { registerTools } from "./tools/index.ts";
import { registerUi } from "./ui/index.ts";

export default function (pi: ExtensionAPI) {
	const connection = new AgentConnection();
	const host: AgentsHost = { pi, store: connection.store, connection, canSpawn: false, identity: undefined, ctx: undefined };
	const supervisor = createSupervisor(host);
	registerRuntime(host);
	pi.on("session_start", () => {
		host.canSpawn = Boolean(host.identity?.interactable) && host.identity!.depth < (host.identity?.spawnDepthLimit ?? maxDepth(pi));
	});
	registerTools(host, supervisor);
	registerUi(host, supervisor);
}
