/** Names of the tools this extension registers, grouped by who may have them. */
const ALWAYS_TOOLS = ["send_message", "ask_parent", "report_done", "set_status"] as const;
const INTERACTABLE_TOOLS = ["ask_user"] as const;
const SPAWN_TOOLS = [
	"spawn_agent",
	"resume_agent",
	"interrupt_agent",
	"kill_agent",
	"redrive_agent",
	"list_agents",
] as const;

/** Every tool an agent with these capabilities gets from this extension. */
export function agentToolNames(interactable: boolean, canSpawn: boolean): string[] {
	return [...ALWAYS_TOOLS, ...(interactable ? INTERACTABLE_TOOLS : []), ...(canSpawn ? SPAWN_TOOLS : [])];
}
