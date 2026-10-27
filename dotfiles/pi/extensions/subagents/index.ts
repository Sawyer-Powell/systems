/**
 * Background subagents for pi.
 *
 * This extension only ever configures *child* processes. The main agent is
 * configured by pi itself (settings.json + APPEND_SYSTEM.md), so nothing here
 * touches a running agent's model, thinking level, tools, or prompt.
 *
 * A child is a `pi --mode rpc` process whose profile is compiled into argv by
 * `toChildArgs` — pi's own launch surface. The child reloads this extension so
 * it can spawn its own children; only its depth travels in the environment.
 *
 * Features:
 *  1. `kill_subagent` sends SIGTERM then SIGKILL to the whole process group.
 *  2. Durable records; `resume_subagent` reopens the child's session.
 *  3. Counter line above the editor plus `/subagents`.
 *  4. Tool allowlist and system prompt come from the profile.
 *  5. Children only get `spawn_subagent` under `agents.maxDepth`.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { loadProfiles, maxDepth, resolveSubagent } from "./profiles.ts";
import { createRegistry, type SubagentRecord } from "./registry.ts";
import * as ui from "./ui.ts";

const DEPTH = Number(process.env.PI_AGENT_DEPTH ?? "0");

export default function (pi: ExtensionAPI) {
	let spawnRegistered = false;

	const registry = createRegistry(pi, {
		onComplete: (record) => {
			pi.sendMessage(
				{
					customType: "subagent_result",
					content: `Subagent ${record.id} (${record.profile.name}) ${record.status}:\n\n${record.summary ?? "(no output)"}`,
					display: true,
					details: record,
				},
				{ triggerTurn: true, deliverAs: "steer" },
			);
		},
		onChange: ui.publish,
	});

	pi.on("session_start", (_event, ctx) => {
		registry.restore(ctx);
		// Settings are only readable once the session exists, and a depth-capped
		// child should not see the tool at all. Register once per runtime.
		if (!spawnRegistered && DEPTH < maxDepth(pi)) {
			spawnRegistered = true;
			registerSpawn(pi, registry);
		}
	});
	pi.on("session_shutdown", () => registry.shutdown());

	registerControl(pi, registry);

	pi.registerCommand("subagents", {
		description: "Show the detailed table of background subagents",
		handler: async (_args, ctx) => {
			const records = registry.list();
			ctx.ui.notify(records.length > 0 ? ui.render(records).join("\n") : "No subagents", "info");
		},
	});
}

function childDepth(): number {
	return DEPTH + 1;
}

function registerSpawn(pi: ExtensionAPI, registry: ReturnType<typeof createRegistry>) {
	pi.registerTool({
		name: "spawn_subagent",
		label: "Spawn Subagent",
		description:
			"Start a background subagent from a named profile. Returns immediately; its result is injected into this conversation when it finishes.",
		parameters: Type.Object({
			profile: Type.String({ description: `Profile name. Available: ${profileHint()}` }),
			task: Type.String({ description: "Task for the subagent." }),
			model: Type.Optional(
				Type.Union([Type.Literal("fast"), Type.Literal("deliberate")], {
					description: "Model alias override. Defaults to the profile's alias.",
				}),
			),
			thinking: Type.Optional(Type.String({ description: "Thinking-level override for this run." })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			if (!(DEPTH < maxDepth(pi))) throw new Error(`Spawning is not allowed at depth ${DEPTH}.`);
			const profile = resolveSubagent(pi, {
				name: params.profile,
				model: params.model,
				thinking: params.thinking,
			});
			const record = await registry.start({ profile, message: params.task, cwd: ctx.cwd, depth: childDepth() });
			return text(`Subagent ${record.id} (${profile.name}, ${profile.model}) started. It will report back; do not wait for it.`);
		},
	});
}

function registerControl(pi: ExtensionAPI, registry: ReturnType<typeof createRegistry>) {
	pi.registerTool({
		name: "list_subagents",
		label: "List Subagents",
		description: "List background subagents, their status, and whether they can be resumed.",
		parameters: Type.Object({}),
		async execute() {
			return text(JSON.stringify(registry.list(), null, 2));
		},
	});

	pi.registerTool({
		name: "kill_subagent",
		label: "Kill Subagent",
		description: "Fully terminate a background subagent and its child processes. Use id '*' to kill all.",
		parameters: Type.Object({
			id: Type.String({ description: "Subagent id, or '*' for every running subagent." }),
			force: Type.Optional(Type.Boolean({ description: "Skip the graceful window and SIGKILL immediately." })),
		}),
		async execute(_id, params) {
			const ids =
				params.id === "*"
					? registry.list().filter((record) => record.status === "running").map((record) => record.id)
					: [params.id];
			const killed = ids.filter((id) => registry.kill(id, params.force));
			return text(killed.length > 0 ? `Killed ${killed.join(", ")}` : "No running subagent matched.");
		},
	});

	pi.registerTool({
		name: "resume_subagent",
		label: "Resume Subagent",
		description: "Re-drive a stopped or lost subagent against its saved conversation history.",
		parameters: Type.Object({
			id: Type.String({ description: "Subagent id from list_subagents." }),
			instruction: Type.String({ description: "What the subagent should do next." }),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const record = registry.list().find((candidate) => candidate.id === params.id);
			if (!record?.sessionFile) throw new Error(`Subagent ${params.id} cannot be resumed (no session file).`);
			if (record.status === "running") throw new Error(`Subagent ${params.id} is already running.`);
			await registry.start({
				id: record.id,
				profile: record.profile,
				sessionFile: record.sessionFile,
				message: resumeMessage(record, params.instruction),
				cwd: ctx.cwd,
				depth: childDepth(),
			});
			return text(`Resumed ${record.id}.`);
		},
	});
}

function resumeMessage(record: SubagentRecord, instruction: string): string {
	return [
		`Resume your assigned task: ${record.task}`,
		`Your previous run ended as "${record.status}". Re-check the current state before acting.`,
		`New instruction: ${instruction}`,
	].join("\n\n");
}

function profileHint(): string {
	const names = [...loadProfiles().keys()];
	return names.length > 0 ? names.join(", ") : "none configured";
}

function text(value: string): { content: { type: "text"; text: string }[]; details: undefined } {
	return { content: [{ type: "text", text: value }], details: undefined };
}
