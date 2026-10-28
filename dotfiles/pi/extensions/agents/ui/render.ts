/** Transcript renderers: claim markers and delivered agent messages. Formatting lives in `model.ts`. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import { AGENT_MESSAGE, type AgentMessageDetails, RESULT_ENTRY, SPAWN_ENTRY } from "../store/index.ts";
import { agentMessageView, claimLine } from "./model.ts";

export function registerRenderers(pi: ExtensionAPI): void {
	for (const type of [SPAWN_ENTRY, RESULT_ENTRY]) {
		pi.registerEntryRenderer(type, (entry, _options, theme) => {
			const line = claimLine(entry.customType, entry.data);
			return line ? new Text(theme.fg("dim", line), 1, 0) : undefined;
		});
	}
	pi.registerMessageRenderer<AgentMessageDetails>(AGENT_MESSAGE, (message, { expanded, outputPad }, theme) => {
		const view = agentMessageView(message.content, message.details, expanded);
		const more = view.hidden > 0 ? `\n${theme.fg("dim", `… ${view.hidden} more lines (expand)`)}` : "";
		const box = new Box(outputPad, 1, (text) => theme.bg("customMessageBg", text));
		box.addChild(new Text(`${theme.fg("accent", view.header)}\n${view.body.join("\n")}${more}`, 0, 0));
		return box;
	});
}
