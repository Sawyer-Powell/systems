/**
 * Human-facing UI: the agents widget under the editor, the lineage status line,
 * and the universal `/agents` picker (search, attach, message, resume, kill,
 * details). It reads the store; actions go through the supervisor and mailbox.
 */
import * as fs from "node:fs";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentsHost } from "../host.ts";
import { type AgentRecord, planYield, resolveAgent, type StallReport, stallOf } from "../store/index.ts";
import type { Supervisor } from "../supervisor/index.ts";
import { stallNotice } from "../supervisor/watchdog.ts";
import { attach } from "./attach.ts";
import { createFuzzyList } from "./fuzzy-list.ts";
import { registerRenderers } from "./render.ts";
import { type Action, actionsFor, buildRows, lineageText, TRIAGE_GROUPS, triage, widgetLines } from "./model.ts";

const WIDGET_KEY = "agents";
/** Old idle rows leave the compact widget; attention/question/blocked rows never age away. */
const WIDGET_IDLE_MAX_AGE_MS = 10 * 60_000;

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
	// Ignore unrelated-tree invalidations; widget reads decode bounded SQL-ranked candidates.
	const onChange = (change: { id: string; kind: string }) => {
		const self = host.identity?.id;
		if (!self) return;
		const relevant = change.id === self || store.ancestors(change.id).some(r => r.input.id === self);
		if (!relevant) return;
		const record = store.record(change.id);
		if (record && ["stall", "exit"].includes(change.kind) && host.identity?.parent === null && record.input.parent !== self) {
			const report = stallOf(record); if (report) host.ctx?.ui.notify(stallNotice({ record, report }), "warning");
		}
		refresh(host.ctx);
	};

	/** Records plus the options every view shares; one store read and one `stallOf` per agent per call. */
	function load(records = store.list()) {
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
			const snapshot = host.connection?.widget(self);
			const { records, ...shared } = load(snapshot?.records);
			const grouped = triage(records, { ...shared, subtreeOf: self, idleMaxAgeMs: WIDGET_IDLE_MAX_AGE_MS });
			const rows = TRIAGE_GROUPS.flatMap(group => grouped[group]).filter(row => row.id !== self);
			ctx.ui.setWidget(WIDGET_KEY, rows.length ? widgetLines(rows, 6, snapshot?.total) : undefined);
			const record = store.record(self);
			const parent = record?.input.parent ? store.readInput(record.input.parent) : undefined;
			ctx.ui.setStatus(WIDGET_KEY, lineageText(record, parent?.name, records.filter(r => r.input.parent === self), snapshot?.children));
		} catch (error) {
			process.stderr.write(`[agents] ui refresh failed: ${String(error)}\n`);
		}
	}

	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;
		refresh(ctx);
		host.connection?.on("changed", onChange);
	});
	pi.on("session_shutdown", () => {
		host.connection?.off("changed", onChange);
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
						: triage(records, { ...shared, subtreeOf, showArchived: showFinished }).items;
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
		const current = store.record(id) ?? record;
		if (current.residency === "blocked" || (current.status === "blocked" && !current.alive)) await supervisor.resume(id, "The user attached to explicitly recover this interrupted session. Re-check in-flight work before acting.");
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
			`status: ${record.status} · ${record.residency ?? "unknown"}${state?.summary ? ` · ${state.summary.slice(0, 200)}` : ""}`,
			...(state?.reason ? [`reason: ${state.reason}`] : []),
			...(state?.handoff ? [`handoff: ${state.handoff.to} (${state.handoff.recipient}) · ${state.handoff.messageId}`] : []),
			`objective: ${input.objective.slice(0, 300)}`,
			`model: ${input.profile.modelId} · cwd: ${input.cwd}`,
			...tail(store.logPath(input.id), 8).map((line) => `log: ${line.slice(0, 160)}`),
		].join("\n");
	}

	async function requestYield(record: AgentRecord): Promise<{ text: string; level: "info" | "warning" }> {
		const current = store.record(record.input.id) ?? record;
		const plan = planYield(current);
		if (plan.action === "refuse") return { text: plan.reason, level: "warning" };
		await host.connection?.flush();
		await host.connection?.request("request-yield", { id: current.input.id });
		return { text: `Asked ${current.input.name} to wrap up safely and yield to you. No work was interrupted.`, level: "info" };
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
					await host.connection?.flush();
					const sent = await host.connection?.request("send", { message: { from: "user", to: id, kind: "instruction", body, deliver: "context" } });
					ctx.ui.notify(`Sent to ${id}${sent?.deferred ? `; retained, delivery deferred (${sent.deferred})` : ""}`, "info");
				}
			} else if (choice === "yield") {
				const result = await requestYield(record);
				await host.connection?.flush();
				ctx.ui.notify(result.text, result.level);
			} else if (choice === "archive" || choice === "restore" || choice === "restore-attach") {
				await host.connection?.request(choice === "archive" ? "archive" : "restore", { id, actor: "user" });
				if (choice === "restore-attach") await attachTo(ctx, store.record(id)!);
				else ctx.ui.notify(`${choice === "archive" ? "Archived" : "Restored"} ${id}. Children were not changed.`, "info");
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

	for (const operation of ["yield", "archive", "restore"] as const) {
		pi.registerCommand(`agent-${operation}`, {
			description: operation === "yield" ? "Request safe wrap-up and a handoff to you: /agent-yield [id|name]"
				: `Explicitly ${operation} an agent: /agent-${operation} <id|name>`,
			handler: async (args, ctx) => {
				const query = args.trim();
				const resolved = query ? resolveAgent(store.list(), query)
					: host.identity?.parent ? { record: store.record(host.identity.id)! } : { error: `Usage: /agent-${operation} <id|name>` };
				if ("error" in resolved) return void ctx.ui.notify(resolved.error, "warning");
				try {
					if (operation === "yield") {
						const result = await requestYield(resolved.record); ctx.ui.notify(result.text, result.level);
					} else {
						await host.connection?.request(operation, { id: resolved.record.input.id, actor: "user" });
						ctx.ui.notify(`${operation === "archive" ? "Archived" : "Restored"} ${resolved.record.input.name}. Children were not changed.`, "info");
					}
				} catch (error) { ctx.ui.notify(String(error instanceof Error ? error.message : error), "error"); }
			},
		});
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
