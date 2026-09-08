/**
 * Panes and processes for pi.
 *
 * The core is a router. It knows how to:
 *   1. spawn a registered process kind in a new zellij pane or tab,
 *   2. route messages to a process it started, and
 *   3. list what it started.
 *
 * It has no knowledge of any specific process: kinds own their config schema,
 * launch command, transport, and message handling (see `protocol.ts`). The
 * model selects a `kind` by name and supplies schema-validated `config`; it can
 * never supply a command line, so arbitrary process spawn is impossible.
 *
 * Records live in tool-result `details`, making them branch-scoped and
 * forkable. Every message is checked against the recorded handle, and only
 * panes this extension opened can be addressed.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { stat } from "node:fs/promises";
import * as path from "node:path";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { recordZellijContext } from "./context.ts";
import { createNvimKind } from "./kinds/nvim.ts";
import { createPiKind } from "./kinds/pi.ts";
import * as panes from "./panes.ts";
import type { ProcessKind, ProcessRecord, ProcessRelation } from "./protocol.ts";

const KINDS: ProcessKind[] = [createNvimKind(), createPiKind()];
const KIND_BY_NAME = new Map(KINDS.map((kind) => [kind.name, kind]));

/** Session entry that durably records a spawned process on the current branch. */
const RECORD_ENTRY = "process_record";

interface SpawnDetails {
	record: ProcessRecord;
}

interface ListedProcess {
	handle: string;
	kind: string;
	relation: ProcessRelation;
	target: "pane" | "tab";
	tabId: string | null;
	paneId: string;
	name: string;
	config: Record<string, unknown>;
	running: boolean;
	reachable: boolean;
}

const kindUnion = Type.Union(KINDS.map((kind) => Type.Literal(kind.name)));
const configUnion = KINDS.length === 1 ? KINDS[0].configSchema : Type.Union(KINDS.map((kind) => kind.configSchema));
const messageUnion =
	KINDS.length === 1 ? KINDS[0].messageSchema : Type.Union(KINDS.map((kind) => kind.messageSchema));

const SpawnParams = Type.Object({
	kind: kindUnion,
	config: configUnion,
	direction: Type.Optional(
		Type.Union([Type.Literal("right"), Type.Literal("down")], {
			description: "Pane split direction. Panes only; defaults to right.",
		}),
	),
	target: Type.Optional(
		Type.Union([Type.Literal("pane"), Type.Literal("tab")], {
			description:
				"Where to put the process: a pane in the focused tab (default), or a new tab of its own.",
		}),
	),
	relation: Type.Optional(
		Type.Union([Type.Literal("child"), Type.Literal("sibling")], {
			description:
				'"child" (default) gets a control channel and can be messaged with send_process; "sibling" is started for a human to drive and cannot be messaged.',
		}),
	),
	floating: Type.Optional(
		Type.Boolean({ description: "Open the pane floating instead of as a split. Panes only." }),
	),
	name: Type.Optional(
		Type.String({ description: "Pane title, or tab name when target is tab. Defaults to the kind's suggestion." }),
	),
	cwd: Type.Optional(
		Type.String({
			description:
				"Working directory for the process. Defaults to the kind's suggestion (for nvim, the file's project root).",
		}),
	),
});

const SendParams = Type.Object({
	handle: Type.String({ description: 'Handle of a process this session started, e.g. "p1".' }),
	message: messageUnion,
});

export default function processPanesExtension(pi: ExtensionAPI) {
	const records = new Map<string, ProcessRecord>();
	/** Children and siblings number independently, so `p1` never means a sibling. */
	const nextHandle: Record<ProcessRelation, number> = { child: 1, sibling: 1 };

	/** Cached pane liveness, so one model turn does not re-query zellij repeatedly. */
	const LIVENESS_TTL_MS = 1500;
	let liveness: { at: number; panes: panes.PaneInfo[] } | undefined;

	const reconstruct = (ctx: ExtensionContext) => {
		records.clear();
		const highest: Record<ProcessRelation, number> = { child: 0, sibling: 0 };
		const consider = (record: ProcessRecord | undefined) => {
			if (!record?.handle) return;
			const relation: ProcessRelation = record.relation ?? "child";
			records.set(record.handle, { ...record, relation, cwd: record.cwd ?? ctx.cwd });
			// `p<n>` / `s<n>` keeps the two counters independent across forks.
			const match = /^([ps])(\d+)$/.exec(record.handle);
			if (!match) return;
			const slot: ProcessRelation = match[1] === "p" ? "child" : "sibling";
			highest[slot] = Math.max(highest[slot], Number(match[2]));
		};
		for (const entry of ctx.sessionManager.getBranch()) {
			// Primary: entries written on spawn, regardless of how the tool was invoked.
			if (entry.type === "custom" && entry.customType === RECORD_ENTRY) {
				consider((entry.data as { record?: ProcessRecord } | undefined)?.record);
				continue;
			}
			// Fallback: a direct top-level spawn_process tool result.
			if (entry.type === "message" && entry.message.role === "toolResult" && entry.message.toolName === "spawn_process") {
				consider((entry.message.details as SpawnDetails | undefined)?.record);
			}
		}
		nextHandle.child = highest.child + 1;
		nextHandle.sibling = highest.sibling + 1;
	};

	async function reconcile(): Promise<void> {
		if (!panes.insideZellij()) return;
		try {
			await livePanes(true);
		} catch {
			// A transient zellij failure must not break session start.
		}
	}

	pi.on("session_start", (_event, ctx) => {
		recordZellijContext(ctx.sessionManager.getSessionId());
		reconstruct(ctx);
		void reconcile();
	});
	pi.on("session_tree", (_event, ctx) => {
		reconstruct(ctx);
		void reconcile();
	});

	async function livePanes(force = false): Promise<panes.PaneInfo[]> {
		if (!force && liveness && Date.now() - liveness.at < LIVENESS_TTL_MS) return liveness.panes;
		const live = await panes.listPanes();
		liveness = { at: Date.now(), panes: live };
		return live;
	}

	/**
	 * A record is live when its pane exists and has not exited. Pane ids repeat
	 * across tabs, so the tab is part of the match. Records written before tabs
	 * existed carry no tabId and fall back to matching the pane id anywhere.
	 */
	function paneAlive(record: ProcessRecord, live: panes.PaneInfo[]): boolean {
		if (record.tabId === undefined && record.paneId === "") return false;
		return live.some(
			(pane) =>
				(record.tabId === undefined || pane.tabId === record.tabId) &&
				(record.paneId === "" || pane.id === record.paneId) &&
				!pane.exited,
		);
	}

	function describePlacement(record: ProcessRecord): string {
		if (record.target === "tab") return `tab ${record.tabId ?? "?"}`;
		const pane = record.paneId === "" ? "pane" : `pane ${record.paneId}`;
		return record.tabId === undefined ? pane : `${pane} in tab ${record.tabId}`;
	}

	const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

	/** A pane's process needs a moment to open its control channel; don't return early. */
	async function waitForReady(kind: ProcessKind, record: ProcessRecord, timeoutMs = 5000): Promise<boolean> {
		const deadline = Date.now() + timeoutMs;
		while (!kind.alive(record)) {
			if (Date.now() >= deadline) return false;
			await sleep(50);
		}
		return true;
	}

	function relationOf(record: ProcessRecord): ProcessRelation {
		return record.relation ?? "child";
	}

	function requireMessageable(record: ProcessRecord): void {
		if (relationOf(record) === "child") return;
		throw new Error(
			`Process ${record.handle} (${record.kind}) is a sibling: it was launched for a human to drive and has no control channel, so it cannot be messaged.`,
		);
	}

	function requireLive(record: ProcessRecord, live: panes.PaneInfo[]): void {
		const kind = KIND_BY_NAME.get(record.kind);
		if (!kind) throw new Error(`Process ${record.handle} has unknown kind "${record.kind}"`);
		if (!paneAlive(record, live)) {
			throw new Error(
				`Process ${record.handle} (${record.kind}) is no longer running; its ${describePlacement(record)} was closed.`,
			);
		}
		if (!kind.alive(record)) {
			throw new Error(
				`Process ${record.handle} (${record.kind}) is not reachable; the program in ${describePlacement(record)} seems to have exited.`,
			);
		}
	}

	pi.registerTool({
		name: "spawn_process",
		label: "Spawn process",
		description:
			"Start a registered process kind in a new zellij pane or tab. " +
			"A child gets a control channel and a handle you can message with send_process; " +
			"a sibling is launched for a human to drive, gets no channel, and cannot be messaged. " +
			"The command is fixed by the kind: the model supplies a kind name and schema-validated config, never argv.\n" +
			KINDS.map((kind) => `- ${kind.name} (${kind.relations.join(", ")}): ${kind.description}`).join("\n"),
		promptSnippet: "Start a process in a new zellij pane or tab (child = messageable, sibling = human-driven)",
		parameters: SpawnParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!panes.insideZellij()) {
				throw new Error("spawn_process requires pi to run inside a zellij session.");
			}
			const kind = KIND_BY_NAME.get(params.kind);
			if (!kind) throw new Error(`Unknown process kind "${params.kind}"`);
			if (!Value.Check(kind.configSchema, params.config)) {
				throw new Error(`Invalid config for process kind "${kind.name}"`);
			}
			await kind.preflight?.();

			const relation = params.relation ?? "child";
			if (!kind.relations.includes(relation)) {
				throw new Error(
					`Process kind "${kind.name}" cannot create a ${relation}; it supports ${kind.relations.join(", ")}.`,
				);
			}

			const spec = kind.spawn(params.config as Record<string, unknown>, ctx.cwd, relation);
			const processCwd = path.resolve(ctx.cwd, params.cwd ?? spec.cwd ?? ctx.cwd);
			if (!(await stat(processCwd).catch(() => undefined))?.isDirectory()) {
				throw new Error(`Working directory ${processCwd} is not a directory`);
			}
			const target = params.target ?? "pane";
			if (target === "tab" && (params.direction !== undefined || params.floating === true)) {
				throw new Error('spawn_process: "direction" and "floating" only apply to panes; omit them when target is "tab".');
			}

			let placement: panes.Placement;
			try {
				placement =
					target === "tab"
						? await panes.newTab({ argv: spec.argv, name: params.name ?? spec.name, cwd: processCwd })
						: await panes.newPane({
								argv: spec.argv,
								name: params.name ?? spec.name,
								cwd: processCwd,
								direction: params.direction,
								floating: params.floating,
							});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				throw new Error(`Failed to open ${target}: ${message}`);
			}

			const prefix = relation === "child" ? "p" : "s";
			const record: ProcessRecord = {
				handle: `${prefix}${nextHandle[relation]++}`,
				kind: kind.name,
				relation,
				tabId: placement.tabId,
				paneId: placement.paneId,
				target,
				name: params.name ?? spec.name,
				cwd: processCwd,
				config: params.config as Record<string, unknown>,
				runtime: spec.runtime,
				createdAt: new Date().toISOString(),
			};
			records.set(record.handle, record);
			pi.appendEntry(RECORD_ENTRY, { record });
			liveness = undefined; // a new pane exists that the cache does not know about

			let text = `Spawned ${kind.name} as ${record.handle} in ${describePlacement(record)} (${record.name}) in ${record.cwd}.`;
			const note = kind.spawnNote?.(record);
			if (note) text += ` ${note}`;
			if (relation === "sibling") {
				// Siblings are for a human: no channel to wait for, nothing to drive.
				text += " It is a sibling: no control channel, so send_process cannot reach it.";
			} else {
				const ready = await waitForReady(kind, record);
				if (!ready) text += " It has not opened its control channel yet; it may still be starting.";
				if (kind.afterSpawn) {
					try {
						const note = await kind.afterSpawn(record);
						if (note) text += ` ${note}`;
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						text += ` Its start-up hook failed: ${message}`;
					}
				}
			}

			return {
				content: [{ type: "text", text }],
				details: { record } satisfies SpawnDetails,
			};
		},

		renderCall(args, theme) {
			const place = args.target === "tab" ? "tab" : args.floating ? "floating" : (args.direction ?? "right");
			const relation = args.relation === "sibling" ? "sibling " : "";
			return new Text(
				theme.fg("toolTitle", theme.bold("spawn_process ")) +
					theme.fg("accent", String(args.kind)) +
					theme.fg("dim", ` (${relation}${place})`),
				0,
				0,
			);
		},

		renderResult(result, _options, theme) {
			const record = (result.details as SpawnDetails | undefined)?.record;
			if (!record) return new Text(result.content[0]?.type === "text" ? result.content[0].text : "", 0, 0);
			return new Text(
				theme.fg("success", "✓ ") +
					theme.fg("accent", record.handle) +
					theme.fg("muted", ` ${record.kind} `) +
					theme.fg("dim", `${describePlacement(record)} ${record.name}`),
				0,
				0,
			);
		},
	});

	pi.registerTool({
		name: "send_process",
		label: "Send process",
		description:
			"Send a message to a process this session started. Can only address a handle returned by spawn_process; " +
			"if the user closed the pane, the call fails and you can spawn a new process.",
		promptSnippet: "Send a message to a spawned process",
		parameters: SendParams,

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			if (!panes.insideZellij()) {
				throw new Error("send_process requires pi to run inside a zellij session.");
			}
			const record = records.get(params.handle);
			if (!record) {
				const known = [...records.keys()];
				throw new Error(
					`Unknown process "${params.handle}". Active handles: ${known.length ? known.join(", ") : "none"}. ` +
						"Only processes started on this session branch can be messaged.",
				);
			}
			const kind = KIND_BY_NAME.get(record.kind);
			if (!kind) throw new Error(`Process ${record.handle} has unknown kind "${record.kind}"`);
			requireMessageable(record);
			const message = params.message as { type: string; [key: string]: unknown };
			if (!kind.messageTypes.includes(message.type)) {
				throw new Error(
					`Process ${record.handle} (${kind.name}) does not accept message "${message.type}"; expected ${kind.messageTypes.join(", ")}.`,
				);
			}
			requireLive(record, await livePanes());

			const result = await kind.send(record, message);
			return {
				content: [{ type: "text", text: result.text }],
				details: result.details,
			};
		},

		renderCall(args, theme) {
			const message = args.message as { type?: string } | undefined;
			return new Text(
				theme.fg("toolTitle", theme.bold("send_process ")) +
					theme.fg("accent", String(args.handle)) +
					theme.fg("dim", ` ${message?.type ?? "?"}`),
				0,
				0,
			);
		},
	});

	pi.registerTool({
		name: "list_processes",
		label: "List processes",
		description:
			"List processes this session started, with whether their pane is still running and reachable. " +
			"Does not show the user's own panes.",
		promptSnippet: "List spawned processes and whether they are still reachable",
		parameters: Type.Object({}),

		async execute(_toolCallId, _params, _signal, _onUpdate) {
			let live: panes.PaneInfo[] = [];
			if (panes.insideZellij()) live = await livePanes();

			const listed: ListedProcess[] = [...records.values()].map((record) => {
				const isRunning = paneAlive(record, live);
				const kind = KIND_BY_NAME.get(record.kind);
				const relation = relationOf(record);
				return {
					handle: record.handle,
					kind: record.kind,
					relation,
					target: record.target ?? "pane",
					tabId: record.tabId ?? null,
					paneId: record.paneId,
					name: record.name,
					config: record.config,
					running: isRunning,
					// Siblings have no channel, so only children can be reachable.
					reachable: isRunning && relation === "child" && kind ? kind.alive(record) : false,
				};
			});

			if (listed.length === 0) {
				return { content: [{ type: "text", text: "No processes started." }], details: { processes: listed } };
			}
			const lines = listed.map((entry) => {
				const location =
					entry.tabId === null
						? entry.paneId || "?"
						: entry.target === "tab"
							? `tab:${entry.tabId}`
							: `tab:${entry.tabId}/${entry.paneId || "?"}`;
				const status = !entry.running
					? "closed"
					: entry.relation === "sibling"
						? "running"
						: entry.reachable
							? "reachable"
							: "unreachable";
				return `${entry.handle}  ${entry.kind}  ${entry.relation}  ${location}  ${status}  ${entry.name}`;
			});
			return { content: [{ type: "text", text: lines.join("\n") }], details: { processes: listed } };
		},
	});
}
