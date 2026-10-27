/**
 * Human-visible subagent status (feature 3):
 *  - a single counter line above the editor: active / invoked / killed
 *  - `/subagents` prints the full table on demand
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SubagentRecord } from "./registry.ts";

const ICONS: Record<SubagentRecord["status"], string> = {
	running: "⏳",
	done: "✓",
	killed: "✗",
	lost: "∅",
	error: "!",
};

function truncate(text: string, width: number): string {
	return text.length > width ? `${text.slice(0, width - 1)}…` : text;
}

/** Full table, used by `/subagents`. */
export function render(records: SubagentRecord[]): string[] {
	return records.map(
		(record) => `${ICONS[record.status]} ${record.id} ${record.profile.name} — ${truncate(record.task, 60)}`,
	);
}

export function publish(records: SubagentRecord[], context: ExtensionContext | undefined): void {
	if (!context?.hasUI) return;
	if (records.length === 0) {
		context.ui.setWidget("subagents", undefined);
		return;
	}
	const active = records.filter((record) => record.status === "running").length;
	const killed = records.filter((record) => record.status === "killed").length;
	context.ui.setWidget("subagents", [`subagents: ${active} active · ${records.length} invoked · ${killed} killed`]);
}
