/** Open native Pi through the managed, lease-holding dtach wrapper. */
import { fileURLToPath } from "node:url";
import { insideZellij, newTab } from "../../zellij/panes.ts";
import { agentName } from "../names.ts";
import type { AgentRecord } from "../store/index.ts";

export function attachArgv(id: string, home: string): string[] {
	return ["env", `PI_AGENTS_HOME=${home}`, process.env.PI_AGENTS_NODE ?? "node", "--experimental-strip-types",
		fileURLToPath(new URL("../central/attach.ts", import.meta.url)), id];
}

export function attachTabName(record: AgentRecord, ancestors: AgentRecord[] = []): string {
	return agentName(record.input, ancestors, { maxLength: 96 });
}

export async function attach(record: AgentRecord, ptySocket: string, ancestors: AgentRecord[] = []): Promise<{ opened: boolean; command: string }> {
	const home = process.env.PI_AGENTS_HOME ?? ptySocket.slice(0, ptySocket.lastIndexOf("/" + record.input.id));
	const argv = attachArgv(record.input.id, home);
	const command = argv.map(arg => `'${arg.replace(/'/g, "'\\''")}'`).join(" ");
	if (!insideZellij()) return { opened: false, command };
	await newTab({ argv, name: attachTabName(record, ancestors), cwd: record.input.cwd });
	return { opened: true, command };
}
