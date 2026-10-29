/**
 * Pure view-model for the agents UI: tree ordering, glyphs, activity text,
 * fuzzy filtering. No pi imports so it is unit-testable.
 */
import { type AgentMessageDetails, type AgentRecord, type EffectiveStatus, isTerminal, planYield, RESULT_ENTRY, type ResultClaim, SPAWN_ENTRY, type SpawnClaim, type StallReport } from "../store/index.ts";

export type Tone = "text" | "success" | "warning" | "error" | "muted";

/** A picker/widget row; structurally a `ListItem`. */
export interface Row {
	id: string;
	/** Display name, disambiguated when several visible agents share one. */
	name: string;
	tone: Tone;
	breadcrumb: string;
	searchText: string;
	/** Aligned-column cells: name (with tree indent and glyph), role, status, activity. */
	cells: string[];
	/** Breadcrumb, unless it adds nothing over the name. */
	detail?: string;
	/** Dim trailing text (triage: the parent's name), shown only when the width allows. */
	suffix?: string;
	/** Always-visible ownership prefix when fuzzy search flattens the groups. */
	parentContext?: string;
	nameQualified?: boolean;
	/** Non-selectable group title (triage view); hidden while filtering. */
	header?: boolean;
}

/** Short human labels; the raw status ids are too long to scan. */
const STATUS_LABELS: Record<EffectiveStatus, string> = {
	working: "working", idle: "idle", "waiting-on-parent": "needs parent",
	"needs-you": "needs you", blocked: "blocked", archived: "archived",
};
const GLYPHS: Record<EffectiveStatus, string> = {
	working: "●", idle: "○", "waiting-on-parent": "?", "needs-you": "?", blocked: "!", archived: "□",
};

export function formatDuration(ms: number): string {
	const s = Math.max(0, Math.round(ms / 1000));
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m`;
	const h = Math.floor(m / 60);
	return `${h}h${m % 60 ? `${m % 60}m` : ""}`;
}

/** First sentence of a summary, stripped of markdown noise, for a one-line view. */
export function cleanSummary(text: string, max = 48): string {
	const flat = text.replace(/[`*_#>]/g, "").replace(/\s+/g, " ").trim();
	const sentence = flat.split(/(?<=[.!?])\s/)[0] ?? flat;
	return sentence.length > max ? `${sentence.slice(0, max - 1)}…` : sentence;
}

/** What the agent is doing, without repeating the status label. */
export function activityText(record: AgentRecord, now: number): string {
	const state = record.state;
	if (!state) return "";
	switch (record.status) {
		case "working": {
			if (state.note) return state.note;
			const step = state.activity.inFlight;
			return step ? `${step.summary} ${formatDuration(now - step.startedAt)}` : `quiet ${formatDuration(now - state.activity.lastEventAt)}`;
		}
		case "idle":
		case "waiting-on-parent":
		case "needs-you": {
			const duration = formatDuration(now - state.since);
			return state.note ? `${duration} · ${state.note}` : duration;
		}
		case "blocked":
			return cleanSummary(state.reason ?? state.summary ?? "Cannot safely continue");
		case "archived":
			return state.summary ? cleanSummary(state.summary) : "Retired by user or parent";
		default:
			return "";
	}
}

interface BuildOptions {
	now: number;
	/** Per-agent stall reports from `stallOf`. */
	stalls?: Map<string, StallReport>;
	breadcrumb: (id: string) => string;
	/** Restrict to this agent and its descendants. */
	subtreeOf?: string;
	/** Hide archived rows while retaining any active descendants. */
	hideFinished?: boolean;
	/** Hide finished agents that finished longer ago than this (for the compact widget). */
	finishedMaxAgeMs?: number;
}

/** Retirement is explicit archive, never inferred from completion, age or process absence. */
const isFinished = (r: AgentRecord) => r.status === "archived";

function disambiguateNames(names: Map<string, string>): Map<string, string> {
	const duplicates = new Map<string, string[]>();
	for (const [id, name] of names) duplicates.set(name, [...(duplicates.get(name) ?? []), id]);
	for (const [name, ids] of duplicates) if (ids.length > 1) for (const id of ids) {
		const tail = id.slice(-4);
		names.set(id, `${name} · ${ids.some(other => other !== id && other.slice(-4) === tail) ? id : tail}`);
	}
	return names;
}

/** Rust-style display names derived from immutable lineage; IDs remain operation identities. */
export function qualifiedNames(records: AgentRecord[]): Map<string, string> {
	const byId = new Map(records.map(record => [record.input.id, record]));
	const names = new Map<string, string>();
	const resolve = (id: string, seen = new Set<string>()): string => {
		if (names.has(id)) return names.get(id)!;
		const input = byId.get(id)?.input;
		if (!input) return id;
		if (seen.has(id)) return input.name;
		seen.add(id);
		const name = input.parent ? `${resolve(input.parent, seen)}::${input.name}` : input.name;
		names.set(id, name); return name;
	};
	for (const record of records) resolve(record.input.id);
	return disambiguateNames(names);
}

/** Depth-first rows: roots by creation time, children under their parent. */
export function buildRows(records: AgentRecord[], options: BuildOptions): Row[] {
	const byParent = new Map<string | null, AgentRecord[]>();
	const known = new Set(records.map((r) => r.input.id));
	for (const record of records) {
		// An agent whose parent record is missing is shown as a root.
		const parent = record.input.parent && known.has(record.input.parent) ? record.input.parent : null;
		byParent.set(parent, [...(byParent.get(parent) ?? []), record]);
	}
	for (const list of byParent.values()) list.sort((a, b) => a.input.createdAt - b.input.createdAt);

	const picked: Array<{ record: AgentRecord; depth: number }> = [];
	const seen = new Set<string>();
	const walk = (record: AgentRecord, depth: number) => {
		if (seen.has(record.input.id)) return;
		seen.add(record.input.id);
		const hidden = options.hideFinished && record.status === "archived";
		const stale =
			options.finishedMaxAgeMs !== undefined &&
			isFinished(record) &&
			record.state !== undefined &&
			options.now - record.state.since > options.finishedMaxAgeMs;
		if (!hidden && !stale) picked.push({ record, depth });
		for (const child of byParent.get(record.input.id) ?? []) walk(child, depth + (hidden ? 0 : 1));
	};

	if (options.subtreeOf) {
		const self = records.find((r) => r.input.id === options.subtreeOf);
		if (self) walk(self, 0);
	} else {
		for (const root of byParent.get(null) ?? []) walk(root, 0);
	}

	const names = qualifiedNames(records);
	return picked.map(({ record, depth }) => toRow(record, options, { depth, name: names.get(record.input.id)!,
		parentContext: record.input.parent ? names.get(record.input.parent) : undefined }));
}

function toRow(record: AgentRecord, options: Pick<BuildOptions, "now" | "stalls" | "breadcrumb">, extra: { depth: number; name: string; last?: string; suffix?: string; parentContext?: string }): Row {
	const { input, status } = record;
	const { depth, name } = extra;
	const stalled = options.stalls?.has(input.id) ?? false;
	const waiting = status === "waiting-on-parent" || status === "needs-you";
	const glyph = stalled ? "!" : GLYPHS[status];
	const tone: Tone = stalled || status === "blocked" ? "error" : waiting ? "warning" : status === "working" ? "success" : status === "archived" ? "muted" : "text";
	const breadcrumb = options.breadcrumb(input.id);
	return {
		id: input.id,
		name,
		tone,
		breadcrumb,
		detail: `${name} · ${input.id} · ${input.role} · ${STATUS_LABELS[status]}${extra.last ? ` · ${extra.last}` : ""}`,
		suffix: extra.suffix,
		parentContext: extra.parentContext,
		nameQualified: true,
		searchText: `${input.id} ${input.parent ?? ""} ${name} ${input.role} ${STATUS_LABELS[status]} ${input.objective} ${breadcrumb}`.toLowerCase(),
		cells: [`${"  ".repeat(depth)}${glyph} ${name}`, input.role, STATUS_LABELS[status] + (record.residency === "parked" ? " · parked" : ""), extra.last ?? activityText(record, options.now)],
	};
}

export const TRIAGE_GROUPS = ["needs", "blocked", "working", "waiting", "idle", "archived"] as const;
type TriageGroup = (typeof TRIAGE_GROUPS)[number];
interface TriageOptions extends Pick<BuildOptions, "now" | "stalls" | "breadcrumb" | "subtreeOf"> {
	showArchived?: boolean;
	/** Compact widget only: old idle rows may be omitted, never needs-you/blocked/waiting. */
	idleMaxAgeMs?: number;
}
const stateSince = (record: AgentRecord): number => record.state?.since ?? 0;

/** A user's own session: never a triage row, and a human answers its children. */
const isRoot = (record: AgentRecord): boolean => record.input.parent === null || record.input.role === "main";

const withTail = (head: string, summary: string | undefined): string => (summary ? `${head} · ${cleanSummary(summary)}` : head);

/** Urgency buckets with explicit parent groups. Human roots are headings/context, not agent rows. */
export function triage(records: AgentRecord[], options: TriageOptions): Record<TriageGroup, Row[]> & { items: Row[] } {
	const { now, stalls } = options;
	const byId = new Map(records.map((r) => [r.input.id, r]));
	const scope = options.subtreeOf ? subtreeIds(records, options.subtreeOf) : undefined;
	const classify = (record: AgentRecord): { group: TriageGroup; sort: number; last: string } => {
		const { state, status } = record;
		const since = stateSince(record);
		if (status === "needs-you") return { group: "needs", sort: since, last: withTail(`waiting ${activityText(record, now)}`, state?.summary) };
		if (status === "blocked" || stalls?.has(record.input.id)) return { group: "blocked", sort: since, last: activityText(record, now) };
		if (status === "working") return { group: "working", sort: state?.runStartedAt ?? since, last: activityText(record, now) };
		if (status === "waiting-on-parent") return { group: "waiting", sort: since, last: activityText(record, now) };
		return { group: status === "archived" ? "archived" : "idle", sort: -since,
			last: withTail(`${STATUS_LABELS[status]} ${formatDuration(now - since)} ago`, state?.summary) };
	};

	const picked: Record<TriageGroup, Array<{ record: AgentRecord; sort: number; last: string }>> = { needs: [], blocked: [], working: [], waiting: [], idle: [], archived: [] };
	for (const record of records) {
		if (isRoot(record) || (scope && !scope.has(record.input.id))) continue;
		const { group, sort, last } = classify(record);
		if (group === "archived" && !options.showArchived) continue;
		if (group === "idle" && !record.alive && options.idleMaxAgeMs !== undefined && now - stateSince(record) >= options.idleMaxAgeMs) continue;
		picked[group].push({ record, sort, last });
	}
	for (const group of TRIAGE_GROUPS) picked[group].sort((a, b) => a.sort - b.sort);

	const names = qualifiedNames(records);
	const parentLabel = (id: string) => names.get(id) ?? (id || "No parent");
	const rows = (group: TriageGroup): Row[] =>
		picked[group].map(({ record, last }) => toRow(record, group === "blocked" ? options : { ...options, stalls: undefined }, {
			depth: 0, name: names.get(record.input.id)!, last,
			suffix: parentLabel(record.input.parent ?? ""), parentContext: parentLabel(record.input.parent ?? ""),
		}));
	const out = Object.fromEntries(TRIAGE_GROUPS.map(group => [group, rows(group)])) as Record<TriageGroup, Row[]>;
	const titles: Record<TriageGroup, string> = { needs: "NEEDS YOU", blocked: "BLOCKED", working: "WORKING", waiting: "WAITING ON PARENT", idle: "IDLE", archived: "ARCHIVED" };
	const header = (id: string, title: string): Row => ({ id, name: title, tone: "muted", breadcrumb: "", searchText: "", cells: [title], header: true });
	const items = TRIAGE_GROUPS.flatMap(group => {
		if (!out[group].length) return [];
		// Input is urgency/age sorted, so first occurrence ranks each parent by its most
		// urgent child. Grouping keeps each parent's children in that same predictable order.
		const groups = new Map<string, Row[]>();
		for (const row of out[group]) {
			const parent = byId.get(row.id)?.input.parent ?? "";
			if (!groups.has(parent)) groups.set(parent, []);
			groups.get(parent)!.push(row);
		}
		return [header(`header:${group}`, `${titles[group]} (${out[group].length})`),
			...[...groups].flatMap(([parent, children]) => [
				header(`header:${group}:parent:${parent}`, `Parent: ${parentLabel(parent)} (${children.length})`), ...children,
			])];
	});
	return { ...out, items };
}

/** The agent and everything below it. */
function subtreeIds(records: AgentRecord[], rootId: string): Set<string> {
	const ids = new Set([rootId]);
	for (let grew = true; grew; ) {
		grew = false;
		for (const { input } of records) {
			if (input.parent && ids.has(input.parent) && !ids.has(input.id)) {
				ids.add(input.id);
				grew = true;
			}
		}
	}
	return ids;
}

/** `[id, label, hint]` entry of the per-agent action menu. */
export type Action = [id: string, label: string, hint: string];

/** Actions offered for one agent; `selfId` is the viewing agent (it cannot act on itself). */
export function actionsFor(record: AgentRecord, selfId: string | undefined): Action[] {
	const isSelf = record.input.id === selfId;
	const isRoot = record.input.role === "main";
	const resumable = !record.alive && !isRoot && record.status !== "archived" && (record.status === "blocked" || record.residency === "parked");
	const actions: Action[] = [];
	if (record.input.interactable && !isRoot && !isSelf && record.status !== "archived" && (record.alive || resumable)) {
		actions.push(["attach", "Attach", record.alive ? "open its session in a new zellij tab" : "resume it, then attach"]);
	}
	if (!isSelf) actions.push(["message", "Message", "send it an instruction"]);
	if (!isSelf && planYield(record).action === "send") actions.push(["yield", "Request yield to you", "ask it to wrap up safely and hand work to the human"]);
	if (!isSelf && record.status !== "archived") actions.push(["archive", "Archive", "retire this agent after detached idle parking; children stay active"]);
	if (!isSelf && record.status === "archived") {
		actions.push(["restore", "Restore", "make available; deliver queued messages"]);
		if (record.input.interactable && !isRoot) actions.push(["restore-attach", "Restore and attach", "explicitly restore, then open native Pi"]);
	}
	if (record.alive && !isSelf) {
		actions.push(["interrupt", "Interrupt", "abort its current run; it stays alive"], ["kill", "Kill", "terminate its process group"]);
	} else if (resumable) {
		actions.push(["resume", "Resume", "relaunch from its saved session"]);
	}
	actions.push(["details", "Details", "objective, state and log tail"]);
	return actions;
}

/** Pad cells into aligned columns. Cells are plain text; `max` caps each column (last column is never padded). */
export function alignCells(rows: string[][], max: number[] = [Infinity, 10, 12]): string[] {
	const cols = Math.max(0, ...rows.map((r) => r.length));
	const widths = Array.from({ length: cols }, (_, c) => Math.min(max[c] ?? Infinity, Math.max(0, ...rows.map((r) => [...(r[c] ?? "")].length))));
	return rows.map((r) =>
		r
			.map((cell, c) => {
				const chars = [...cell];
				const w = widths[c] ?? chars.length;
				const clipped = chars.length > w && c < cols - 1 ? `${chars.slice(0, w - 1).join("")}…` : cell;
				return c < cols - 1 ? clipped.padEnd(w + (clipped.length - [...clipped].length), " ") : clipped;
			})
			.join("  ")
			.trimEnd(),
	);
}

/** Subsequence match; lower score is better. Undefined = no match. */
export function fuzzyScore(query: string, text: string): number | undefined {
	if (!query) return 0;
	let score = 0;
	let from = 0;
	let last = -1;
	for (const ch of query.toLowerCase()) {
		const at = text.indexOf(ch, from);
		if (at < 0) return undefined;
		score += last < 0 ? at : at - last - 1; // gaps cost; contiguous runs are free
		last = at;
		from = at + 1;
	}
	return score;
}

const searchWords = (text: string): string[] => text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** Each term must fuzzy-match within a single word, so long text does not match everything. */
export function filterRows<T extends { searchText: string }>(rows: T[], query: string): T[] {
	const terms = searchWords(query);
	if (!terms.length) return rows;
	return rows
		.map((row) => {
			const words = searchWords(row.searchText);
			let total = 0;
			for (const term of terms) {
				let best: number | undefined;
				for (const word of words) {
					const s = fuzzyScore(term, word);
					if (s !== undefined && (best === undefined || s < best)) best = s;
				}
				if (best === undefined) return undefined;
				total += best;
			}
			return { row, total };
		})
		.filter((entry): entry is { row: T; total: number } => entry !== undefined)
		.sort((a, b) => a.total - b.total)
		.map((entry) => entry.row);
}

/** Search flattens headings but keeps ownership in the first visible column, not an optional suffix. */
export function filterListItems<T extends { searchText: string; cells: string[]; header?: boolean; parentContext?: string; nameQualified?: boolean }>(items: T[], query: string): T[] {
	return filterRows(items.filter(item => !item.header), query).map(item => item.parentContext && !item.nameQualified
		? { ...item, cells: [`${item.parentContext} › ${item.cells[0] ?? ""}`, ...item.cells.slice(1)] }
		: item);
}

/** Widget lines for a tree: aligned, one row per agent. */
export function widgetLines(rows: Row[], max = 6, total = rows.length, context?: { records: AgentRecord[]; focusedId: string }): string[] {
	if (rows.length === 0) return [];
	const shown = rows.slice(0, max);
	let names: Map<string, string> | undefined;
	if (context) {
		const byId = new Map(context.records.map(record => [record.input.id, record]));
		names = disambiguateNames(new Map(shown.map(row => {
			const parts: string[] = [], seen = new Set<string>();
			let current = byId.get(row.id);
			while (current && current.input.id !== context.focusedId && !seen.has(current.input.id)) {
				seen.add(current.input.id); parts.unshift(current.input.name);
				current = current.input.parent ? byId.get(current.input.parent) : undefined;
			}
			return [row.id, current?.input.id === context.focusedId && parts.length ? parts.join("::") : row.name];
		})));
	}
	// Render-only projection: records, full picker names, breadcrumbs and search text stay untouched.
	const lines = alignCells(shown.map(row => names
		? [`${row.cells[0]!.slice(0, -row.name.length)}${names.get(row.id)}`, ...row.cells.slice(1)] : row.cells));
	if (total > max) lines.push(`… ${total - max} more (/agents)`);
	return lines;
}

/** Lineage status text for the footer. */
export function lineageText(self: AgentRecord | undefined, parentName: string | undefined, children: AgentRecord[], counts?: { total: number; live: number }): string | undefined {
	const running = counts?.live ?? children.filter((c) => c.alive).length;
	const total = counts?.total ?? children.length;
	const kids = total > 0 ? `${total} agent${total === 1 ? "" : "s"} (${running} live)` : undefined;
	const parent = self?.input.parent && parentName ? `child of ${parentName}` : undefined;
	const parts = [parent, kids].filter((p): p is string => Boolean(p));
	return parts.length ? parts.join(" · ") : undefined;
}

const oneLine = (text: string, max: number): string => {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/** One-line transcript marker for an `agents.spawn` / `agents.result` claim entry. */
export function claimLine(customType: string | undefined, data: unknown): string | undefined {
	if (customType === SPAWN_ENTRY) {
		const claim = data as Partial<SpawnClaim> | undefined;
		return claim?.id ? `▸ spawned ${claim.name ?? claim.id} (${claim.role ?? "agent"}) · ${oneLine(claim.objective ?? "", 80)}` : undefined;
	}
	if (customType === RESULT_ENTRY) {
		const claim = data as Partial<ResultClaim> | undefined;
		return claim?.id ? `◂ ${claim.id} ${claim.status ?? ""} · ${oneLine(claim.summary ?? "", 80)}` : undefined;
	}
	return undefined;
}

/** Lines of a message body shown while collapsed. */
export const COLLAPSED_LINES = 6;

/** Header and (optionally collapsed) body lines of a delivered message, for the transcript. */
export function agentMessageView(content: unknown, details: Partial<AgentMessageDetails> | undefined, expanded: boolean): { header: string; body: string[]; hidden: number } {
	const text = typeof content === "string" ? content : "";
	const newline = text.indexOf("\n");
	const body = text.startsWith("[from ") && newline >= 0 ? text.slice(newline + 1) : text;
	const lines = body.split("\n");
	const shown = expanded ? lines : lines.slice(0, COLLAPSED_LINES);
	return { header: `[from ${details?.from ?? "?"} · ${details?.kind ?? "message"}]`, body: shown, hidden: lines.length - shown.length };
}
