/**
 * Zellij pane and tab primitives.
 *
 * The only zellij actions this extension ever issues are create-only:
 * `new-pane`, `new-tab`, and the read-only `list-panes`. There is deliberately
 * no close, focus, move, resize, or send-keys here.
 *
 * Pane ids are per tab, not per session: `terminal_0` exists in every tab. Every
 * pane is therefore identified by `(tabId, paneId)`, and callers must carry both.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface NewPaneOptions {
	argv: string[];
	name: string;
	cwd: string;
	direction?: "right" | "down";
	floating?: boolean;
}

export interface NewTabOptions {
	argv: string[];
	name: string;
	cwd: string;
}

/** Where a process ended up living. */
export interface Placement {
	/** Undefined when zellij would not tell us (no attached client, instant exit). */
	tabId?: string;
	/** Empty when the pane could not be resolved (e.g. the command exited immediately). */
	paneId: string;
}

export interface PaneInfo {
	/** Pane id as zellij prints it, e.g. `terminal_1`. Unique only within a tab. */
	id: string;
	tabId: string;
	title: string;
	exited: boolean;
	isFloating: boolean;
	command: string | null;
}

export function insideZellij(): boolean {
	return Boolean(process.env.ZELLIJ_SESSION_NAME?.trim() || process.env.ZELLIJ);
}

/** `--session` is a global zellij flag, so it must precede the subcommand. */
function withSession(rest: string[]): string[] {
	const session = process.env.ZELLIJ_SESSION_NAME?.trim();
	return session ? ["--session", session, ...rest] : rest;
}

async function zellij(args: string[]): Promise<string> {
	const { stdout } = await execFileAsync("zellij", withSession(args));
	return stdout;
}

export function paneKey(tabId: string, paneId: string): string {
	return `${tabId}:${paneId}`;
}

/** Create a pane in the focused tab. Returns the created pane id (`terminal_<n>`). */
export async function newPane(options: NewPaneOptions): Promise<Placement> {
	// `new-pane` goes to the active tab; ask for it directly and only diff the
	// pane list when there is no attached client to answer.
	const active = await activeTabId();
	const before = active === undefined ? await paneKeys() : undefined;
	const args = ["action", "new-pane", "--cwd", options.cwd, "--name", options.name, "--close-on-exit"];
	if (options.floating) {
		args.push("--floating");
	} else {
		args.push("--direction", options.direction ?? "right");
	}
	args.push("--", ...options.argv);
	const stdout = await zellij(args);
	const paneId = stdout.trim().split("\n").pop()?.trim();
	if (!paneId) throw new Error("zellij did not report the created pane id");
	const tabId = active ?? (await locatePaneTab(paneId, before ?? new Set()).catch(() => undefined));
	return { paneId, tabId };
}

/**
 * Create a tab whose first pane runs `argv`. zellij prints only the tab id, so
 * the pane inside it is resolved from `list-panes`.
 */
export async function newTab(options: NewTabOptions): Promise<Placement> {
	const args = ["action", "new-tab", "--cwd", options.cwd, "--name", options.name, "--close-on-exit"];
	args.push("--", ...options.argv);
	const stdout = await zellij(args);
	const tabId = stdout.trim().split("\n").pop()?.trim();
	if (!tabId || !/^\d+$/.test(tabId)) throw new Error("zellij did not report the created tab id");
	const paneId = await locateTabPane(tabId);
	return { tabId, paneId };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function paneKeys(): Promise<Set<string>> {
	return new Set((await listPanes().catch(() => [])).map((pane) => paneKey(pane.tabId, pane.id)));
}

/** The tab the attached client is looking at. Absent in a client-less session. */
async function activeTabId(): Promise<string | undefined> {
	try {
		const info = JSON.parse(await zellij(["action", "current-tab-info", "--json"])) as { tab_id?: number };
		return info.tab_id === undefined ? undefined : String(info.tab_id);
	} catch {
		return undefined;
	}
}

/** A new pane shows up in `list-panes` a moment after the action returns. */
async function locatePaneTab(paneId: string, before: Set<string>, timeoutMs = 3000): Promise<string> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const fresh = (await listPanes().catch(() => [])).find(
			(pane) => pane.id === paneId && !before.has(paneKey(pane.tabId, pane.id)),
		);
		if (fresh) return fresh.tabId;
		if (Date.now() >= deadline) throw new Error(`zellij did not report a tab for new pane ${paneId}`);
		await sleep(50);
	}
}

/** The tab's initial pane, if it is still around. */
async function locateTabPane(tabId: string, timeoutMs = 3000): Promise<string> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const pane = (await listPanes().catch(() => [])).find((entry) => entry.tabId === tabId);
		if (pane) return pane.id;
		if (Date.now() >= deadline) return "";
		await sleep(50);
	}
}

/** List terminal panes in the current session, with their tab. */
export async function listPanes(): Promise<PaneInfo[]> {
	const raw = JSON.parse(await zellij(["action", "list-panes", "--json", "--tab"])) as Array<{
		id: number;
		is_plugin: boolean;
		title: string;
		exited: boolean;
		is_floating: boolean;
		tab_id: number;
		terminal_command: string | null;
		pane_command: string | null;
	}>;
	return raw
		.filter((pane) => !pane.is_plugin)
		.map((pane) => ({
			id: `terminal_${pane.id}`,
			tabId: String(pane.tab_id),
			title: pane.title,
			exited: pane.exited,
			isFloating: pane.is_floating,
			command: pane.terminal_command ?? pane.pane_command ?? null,
		}));
}
