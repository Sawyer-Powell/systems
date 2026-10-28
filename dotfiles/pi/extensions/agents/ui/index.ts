/**
 * Human-facing UI: the agents widget under the editor, the lineage status line,
 * and the universal `/agents` picker (search, attach, message, resume, kill,
 * details). It reads the store; actions go through the supervisor and mailbox.
 */
import * as fs from "node:fs";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentsHost } from "../host.ts";
import { type AgentRecord, deliveryForParent, LOST_DONE_SUMMARY, planDone, resolveAgent, type StallReport, stallOf } from "../store/index.ts";
import type { Supervisor } from "../supervisor/index.ts";
import { attach } from "./attach.ts";
import { createFuzzyList } from "./fuzzy-list.ts";
import { registerRenderers } from "./render.ts";
import { type Action, actionsFor, buildRows, lineageText, TRIAGE_WINDOW_MS, triage, widgetLines } from "./model.ts";

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
	registerRenderers(pi);
	let timer: ReturnType<typeof setInterval> | undefined;

	/** Records plus the options every view shares; one store read and one `stallOf` per agent per call. */
	function load() {
		const records = store.list();
		const stalls = new Map<string, StallReport>();
		for (const record of records) {
			const report = stallOf(record);
			if (report) stalls.set(record.input.id, report);
		}
		// Breadcrumbs from the records already in memory: `store.breadcrumb` re-reads every ancestor per row.
		const byId = new Map(records.map((r) => [r.input.id, r]));
		const breadcrumb = (id: string) => {
			const chain: string[] = [];
			for (let at = byId.get(id); at && chain.length <= byId.size; at = at.input.parent ? byId.get(at.input.parent) : undefined) chain.unshift(at.input.name);
			return chain.length ? chain.join(" › ") : id;
		};
		return { records, stalls, now: Date.now(), breadcrumb };
	}

	function refresh(ctx: ExtensionContext | undefined): void {
		if (!ctx?.hasUI) return;
		try {
			const self = host.identity?.id;
			if (!self) return;
			const { records, ...shared } = load();
			const { needs, working, completed } = triage(records, { ...shared, subtreeOf: self, completedMaxAgeMs: WIDGET_FINISHED_MAX_AGE_MS });
			const rows = [...needs, ...working, ...completed].filter((row) => row.id !== self);
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
				getItems: ({ scope, showFinished, view }) => {
					const { records, ...shared } = load();
					const subtreeOf = scope === "subtree" ? host.identity?.id : undefined;
					return view === "tree"
						? buildRows(records, { ...shared, subtreeOf, hideFinished: !showFinished })
						: triage(records, { ...shared, subtreeOf, completedMaxAgeMs: showFinished ? undefined : TRIAGE_WINDOW_MS }).items;
				},
				scopeToggle: Boolean(host.identity),
				finishedToggle: true,
				viewToggle: true,
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
		// A fork keeps the agents of the session it came from, read-only.
		const forkedFrom = input.forkedFrom ? store.readInput(input.forkedFrom) : undefined;
		const inherited = host.identity?.forkedFrom ? store.ancestors(input.id).find((a) => a.input.id === host.identity?.forkedFrom) : undefined;
		return [
			`${input.id}  (${store.breadcrumb(input.id)})`,
			...(forkedFrom ? [`forked from ${forkedFrom.name} (${forkedFrom.id})`] : []),
			...(inherited ? [`inherited, read-only: owned by ${inherited.input.name} (the session this one was forked from)`] : []),
			`status: ${record.status}${state?.summary ? ` · ${state.summary.slice(0, 200)}` : ""}`,
			`objective: ${input.objective.slice(0, 300)}`,
			`model: ${input.profile.modelId} · cwd: ${input.cwd}`,
			...tail(store.logPath(input.id), 8).map((line) => `log: ${line.slice(0, 160)}`),
		].join("\n");
	}

	/**
	 * `/agent-done` and the "Mark done" action. A live agent is sent `control: "done"` and finishes itself;
	 * a lost one has no process to ask, so (like kill) its dead state is written here. Returns the message to show.
	 */
	function markDone(record: AgentRecord): { text: string; level: "info" | "warning" } {
		const id = record.input.id;
		const current = store.record(id) ?? record; // re-read: the state may have changed since the list was drawn
		const plan = planDone(current);
		if (plan.action === "noop") return { text: plan.reason, level: "info" };
		if (plan.action === "refuse") return { text: plan.reason, level: "warning" };
		if (plan.action === "send") {
			store.send({ from: "user", to: id, kind: "control", control: "done", body: "done", deliver: "context" });
			const busy = current.status === "working" ? " It finishes its current run first (interrupt it to cut that short)." : "";
			return { text: `Told ${current.input.name} to wrap up and mark itself done.${busy}`, level: "info" };
		}
		if (store.isAlive(id)) return { text: `${current.input.name} came back to life; try again.`, level: "warning" };
		store.writeState(id, { status: "done", summary: LOST_DONE_SUMMARY, waitingOn: undefined, note: undefined });
		const parent = current.input.parent;
		if (parent) {
			try {
				store.send({ from: id, to: parent, kind: "result", body: `MARKED DONE by the user: ${LOST_DONE_SUMMARY}`, deliver: deliveryForParent(store, parent) });
			} catch (error) {
				process.stderr.write(`[agents] could not notify parent: ${String(error)}\n`);
			}
		}
		return { text: `${current.input.name} had no process; marked done.`, level: "info" };
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
			} else if (choice === "done") {
				const result = markDone(record);
				ctx.ui.notify(result.text, result.level);
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

	pi.registerCommand("agent-done", {
		description: "Tell an agent to wrap up, report and mark itself done: /agent-done [id|name] (no argument: this agent)",
		handler: async (args, ctx) => {
			const self = host.identity;
			if (!self) return void ctx.ui.notify("This session is not an agent.", "warning");
			const query = args.trim();
			let target: AgentRecord | undefined;
			if (!query) {
				target = self.parent ? store.record(self.id) : undefined;
				if (!target) {
					const open = store.descendants(self.id).filter((r) => planDone(r).action !== "noop" && planDone(r).action !== "refuse");
					return void ctx.ui.notify(`Usage: /agent-done <id|name>${open.length ? `. Open: ${open.map((r) => r.input.name).join(", ")}` : ""}`, "info");
				}
			} else {
				const resolved = resolveAgent(store.descendants(self.id), query);
				if ("error" in resolved) return void ctx.ui.notify(resolved.error, "warning");
				target = resolved.record;
			}
			try {
				const result = markDone(target);
				ctx.ui.notify(result.text, result.level);
			} catch (error) {
				ctx.ui.notify(String(error instanceof Error ? error.message : error), "error");
			}
		},
	});
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
