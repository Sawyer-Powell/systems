/**
 * Human-facing UI: the agents widget under the editor, the lineage status line,
 * and the universal `/agents` picker (search, attach, message, resume, kill,
 * details). It reads the store; actions go through the supervisor and mailbox.
 */
import * as fs from "node:fs";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentsHost } from "../host.ts";
import { type AgentRecord, type StallReport, stallOf } from "../store/index.ts";
import type { Supervisor } from "../supervisor/index.ts";
import { attach } from "./attach.ts";
import { createFuzzyList } from "./fuzzy-list.ts";
import { type Action, actionsFor, buildRows, lineageText, type Row, widgetLines } from "./model.ts";

const REFRESH_MS = 2000;
const WIDGET_KEY = "agents";
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
/** Finished agents leave the compact widget after this long (they stay in /agents). */
const WIDGET_FINISHED_MAX_AGE_MS = 10 * 60_000;

function tail(file: string, lines: number): string[] {
	try {
		return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).slice(-lines);
	} catch {
		return [];
	}
}

export function registerUi(host: AgentsHost, supervisor: Supervisor): void {
	const { pi, store } = host;
	let timer: ReturnType<typeof setInterval> | undefined;

	function snapshot(opts: { subtree: boolean; showFinished: boolean; widget?: boolean }): Row[] {
		const records = store.list();
		const stalls = new Map<string, StallReport>();
		for (const record of records) {
			const report = stallOf(record);
			if (report) stalls.set(record.input.id, report);
		}
		return buildRows(records, {
			now: Date.now(),
			stalls,
			breadcrumb: (id) => store.breadcrumb(id),
			subtreeOf: opts.subtree ? host.identity?.id : undefined,
			hideFinished: !opts.showFinished,
			finishedMaxAgeMs: opts.widget ? WIDGET_FINISHED_MAX_AGE_MS : undefined,
		});
	}

	function refresh(ctx: ExtensionContext | undefined): void {
		if (!ctx?.hasUI) return;
		try {
			const self = host.identity?.id;
			if (!self) return;
			const rows = snapshot({ subtree: true, showFinished: true, widget: true }).filter((row) => row.id !== self);
			ctx.ui.setWidget(WIDGET_KEY, rows.length ? widgetLines(rows) : undefined);
			const record = store.record(self);
			const parent = record?.input.parent ? store.readInput(record.input.parent) : undefined;
			ctx.ui.setStatus(WIDGET_KEY, lineageText(record, parent?.name, store.children(self)));
		} catch (error) {
			process.stderr.write(`[agents] ui refresh failed: ${String(error)}\n`);
		}
	}

	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;
		refresh(ctx);
		timer = setInterval(() => refresh(host.ctx ?? ctx), REFRESH_MS);
		timer.unref?.();
	});
	pi.on("session_shutdown", () => {
		if (timer) clearInterval(timer);
		timer = undefined;
	});

	async function pick(ctx: ExtensionContext): Promise<string | undefined> {
		return ctx.ui.custom<string | undefined>((tui, theme, _kb, done) =>
			createFuzzyList({
				tui,
				theme,
				title: "Agents",
				getItems: ({ scope, showFinished }) => snapshot({ subtree: scope === "subtree", showFinished }),
				scopeToggle: Boolean(host.identity),
				finishedToggle: true,
				done,
			}),
		);
	}

	/** Fuzzy action menu for one agent. */
	async function chooseAction(ctx: ExtensionContext, title: string, actions: Action[]): Promise<string | undefined> {
		return ctx.ui.custom<string | undefined>((tui, theme, _kb, done) =>
			createFuzzyList({
				tui,
				theme,
				title,
				getItems: () => actions.map(([id, label, hint]) => ({ id, cells: [label, hint], searchText: `${label} ${hint}`.toLowerCase() })),
				done,
				pageSize: actions.length,
			}),
		);
	}

	/** Open the agent's session in a zellij tab, resuming it first when its process is gone. */
	async function attachTo(ctx: ExtensionContext, record: AgentRecord): Promise<void> {
		const id = record.input.id;
		let current = store.record(id) ?? record;
		if (!current.alive && current.input.interactable) {
			await supervisor.resume(id, "The user attached to continue this session.");
			for (let i = 0; i < 100 && !(store.isAlive(id) && fs.existsSync(store.ptySocket(id))); i++) await sleep(100);
			current = store.record(id) ?? current;
		}
		const result = await attach(current, store.ptySocket(id));
		if (!result.opened) ctx.ui.notify(`Not inside zellij. Run: ${result.command}`, "info");
	}

	function detailsText(record: AgentRecord): string {
		const { input, state } = record;
		return [
			`${input.id}  (${store.breadcrumb(input.id)})`,
			`status: ${record.status}${state?.summary ? ` · ${state.summary.slice(0, 200)}` : ""}`,
			`objective: ${input.objective.slice(0, 300)}`,
			`model: ${input.profile.modelId} · cwd: ${input.cwd}`,
			...tail(store.logPath(input.id), 8).map((line) => `log: ${line.slice(0, 160)}`),
		].join("\n");
	}

	async function act(ctx: ExtensionContext, record: AgentRecord): Promise<void> {
		const id = record.input.id;
		const choice = await chooseAction(ctx, `${record.input.name} · ${record.status}`, actionsFor(record, host.identity?.id));
		if (!choice) return;
		try {
			if (choice === "attach") {
				await attachTo(ctx, record);
			} else if (choice === "message") {
				const body = await ctx.ui.input(`Message to ${record.input.name}`, "text");
				if (body?.trim()) {
					store.send({ from: "user", to: id, kind: "instruction", body, deliver: "context" });
					ctx.ui.notify(`Sent to ${id}`, "info");
				}
			} else if (choice === "interrupt" || choice === "kill") {
				await supervisor.signal(id, choice);
				ctx.ui.notify(`${choice} sent to ${id}`, "info");
			} else if (choice === "resume") {
				await supervisor.resume(id);
				ctx.ui.notify(`Resumed ${id}`, "info");
			} else if (choice === "details") {
				ctx.ui.notify(detailsText(record), "info");
			}
		} catch (error) {
			ctx.ui.notify(String(error instanceof Error ? error.message : error), "error");
		}
	}

	async function open(ctx: ExtensionContext): Promise<void> {
		const id = await pick(ctx);
		if (!id) return;
		const record = store.record(id);
		if (record) await act(ctx, record);
	}

	pi.registerCommand("agents", {
		description: "Search every agent, attach, message, resume or kill",
		handler: async (_args, ctx) => open(ctx),
	});
	try {
		pi.registerShortcut("alt+a", { description: "Open the agents picker", handler: (ctx) => open(ctx) });
	} catch {
		// shortcut unsupported in this terminal; the command still works
	}
}
