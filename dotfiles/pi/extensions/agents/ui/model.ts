/**
 * Pure view-model for the agents UI: tree ordering, glyphs, activity text,
 * fuzzy filtering. No pi imports so it is unit-testable.
 */
import { type AgentRecord, type EffectiveStatus, isTerminal, type StallReport } from "../store/index.ts";

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
}

/** Short human labels; the raw status ids are too long to scan. */
const STATUS_LABELS: Record<EffectiveStatus, string> = {
	starting: "starting",
	idle: "idle",
	working: "working",
	"waiting-on-parent": "needs parent",
	"waiting-on-user": "needs you",
	done: "done",
	stopped: "stopped",
	error: "error",
	"timed-out": "timed out",
	lost: "lost",
};

const GLYPHS: Record<EffectiveStatus, string> = {
	starting: "…",
	idle: "○",
	working: "●",
	"waiting-on-parent": "?",
	"waiting-on-user": "?",
	done: "✓",
	stopped: "■",
	error: "✗",
	"timed-out": "⏱",
	lost: "∅",
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
		case "waiting-on-user": {
			const duration = formatDuration(now - state.since);
			return state.note ? `${duration} · ${state.note}` : duration;
		}
		case "lost":
			return `gone ${formatDuration(now - state.activity.lastSeenAt)}`;
		case "done":
		case "error":
		case "timed-out":
			return state.summary ? cleanSummary(state.summary) : "";
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
	/** Hide whole trees in which every agent has finished (done/stopped/timed out/error). */
	hideFinished?: boolean;
	/** Hide finished agents that finished longer ago than this (for the compact widget). */
	finishedMaxAgeMs?: number;
}

/** Finished = terminal status AND no live process: a `done` interactable agent that is still attachable is not finished. */
const isFinished = (r: AgentRecord) => isTerminal(r.status) && !r.alive;

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

	const treeFinished = (record: AgentRecord, seen = new Set<string>()): boolean => {
		if (seen.has(record.input.id)) return true;
		seen.add(record.input.id);
		return isFinished(record) && (byParent.get(record.input.id) ?? []).every((child) => treeFinished(child, seen));
	};

	const picked: Array<{ record: AgentRecord; depth: number }> = [];
	const seen = new Set<string>();
	const walk = (record: AgentRecord, depth: number) => {
		if (seen.has(record.input.id)) return;
		seen.add(record.input.id);
		if (depth === 0 && options.hideFinished && treeFinished(record)) return;
		const stale =
			options.finishedMaxAgeMs !== undefined &&
			isFinished(record) &&
			record.state !== undefined &&
			options.now - record.state.since > options.finishedMaxAgeMs;
		if (!stale) picked.push({ record, depth });
		for (const child of byParent.get(record.input.id) ?? []) walk(child, depth + 1);
	};

	if (options.subtreeOf) {
		const self = records.find((r) => r.input.id === options.subtreeOf);
		if (self) walk(self, 0);
	} else {
		for (const root of byParent.get(null) ?? []) walk(root, 0);
	}

	// Several agents may share a name (every root is named after its cwd): add the id tail.
	const counts = new Map<string, number>();
	for (const { record } of picked) counts.set(record.input.name, (counts.get(record.input.name) ?? 0) + 1);
	return picked.map(({ record, depth }) => toRow(record, depth, options, (counts.get(record.input.name) ?? 0) > 1));
}

function toRow(record: AgentRecord, depth: number, options: BuildOptions, duplicate: boolean): Row {
	const { input, status } = record;
	const stalled = options.stalls?.has(input.id) ?? false;
	const waiting = status === "waiting-on-parent" || status === "waiting-on-user";
	const glyph = stalled ? "!" : GLYPHS[status];
	const name = duplicate ? `${input.name}·${input.id.slice(-4)}` : input.name;
	const activity = activityText(record, options.now);
	const tone: Tone = stalled || status === "error" ? "error" : waiting ? "warning" : status === "working" ? "success" : isTerminal(status) || status === "lost" ? "muted" : "text";
	const breadcrumb = options.breadcrumb(input.id);
	return {
		id: input.id,
		name,
		tone,
		breadcrumb,
		detail: breadcrumb === name ? undefined : breadcrumb,
		searchText: `${input.id} ${input.name} ${input.role} ${STATUS_LABELS[status]} ${input.objective} ${breadcrumb}`.toLowerCase(),
		cells: [`${"  ".repeat(depth)}${glyph} ${name}`, input.role, STATUS_LABELS[status], activity],
	};
}

/** `[id, label, hint]` entry of the per-agent action menu. */
export type Action = [id: string, label: string, hint: string];

/** Actions offered for one agent; `selfId` is the viewing agent (it cannot act on itself). */
export function actionsFor(record: AgentRecord, selfId: string | undefined): Action[] {
	const isSelf = record.input.id === selfId;
	const isRoot = record.input.role === "main";
	const resumable = !record.alive && !isRoot && (isTerminal(record.status) || record.status === "lost");
	const actions: Action[] = [];
	if (record.input.interactable && !isSelf && (record.alive || resumable)) {
		actions.push(["attach", "Attach", record.alive ? "open its session in a new zellij tab" : "resume it, then attach"]);
	}
	if (!isSelf) actions.push(["message", "Message", "send it an instruction"]);
	if (record.alive && !isSelf) {
		actions.push(["interrupt", "Interrupt", "abort its current run; it stays alive"], ["kill", "Kill", "terminate its process group"]);
	} else if (resumable) {
		actions.push(["resume", "Resume", "relaunch from its saved session"]);
	}
	actions.push(["details", "Details", "objective, state and log tail"]);
	return actions;
}

/** Pad cells into aligned columns. Cells are plain text; `max` caps each column (last column is never padded). */
export function alignCells(rows: string[][], max: number[] = [34, 10, 12]): string[] {
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

/** Each term must fuzzy-match within a single word, so long text does not match everything. */
export function filterRows<T extends { searchText: string }>(rows: T[], query: string): T[] {
	const q = query.trim();
	if (!q) return rows;
	const terms = q.toLowerCase().split(/\s+/);
	return rows
		.map((row) => {
			const words = row.searchText.split(/[^a-z0-9]+/).filter(Boolean);
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

/** Widget lines for a tree: aligned, one row per agent. */
export function widgetLines(rows: Row[], max = 6): string[] {
	if (rows.length === 0) return [];
	const shown = rows.slice(0, max);
	const lines = alignCells(shown.map((row) => row.cells));
	if (rows.length > max) lines.push(`… ${rows.length - max} more (/agents)`);
	return lines;
}

/** Lineage status text for the footer. */
export function lineageText(self: AgentRecord | undefined, parentName: string | undefined, children: AgentRecord[]): string | undefined {
	const running = children.filter((c) => c.alive).length;
	const kids = children.length > 0 ? `${children.length} agent${children.length === 1 ? "" : "s"} (${running} live)` : undefined;
	const parent = self?.input.parent && parentName ? `child of ${parentName}` : undefined;
	const parts = [parent, kids].filter((p): p is string => Boolean(p));
	return parts.length ? parts.join(" · ") : undefined;
}
