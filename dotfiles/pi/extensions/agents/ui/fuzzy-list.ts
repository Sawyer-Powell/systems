/**
 * A generic fuzzy-filtered list component used for the agent picker and the
 * per-agent action menu. Typing filters; `up/down`, `ctrl+p/n` and `ctrl+k/j`
 * move; `enter` selects; `esc` closes. Optional toggles: `tab` (scope) and
 * `ctrl+t` (show finished). Rendering is plain strings; list logic is in `model.ts`.
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, Key, matchesKey, type TUI, truncateToWidth } from "@earendil-works/pi-tui";
import { alignCells, filterRows, type Tone } from "./model.ts";

export interface ListItem {
	id: string;
	/** Plain-text cells, aligned into columns. */
	cells: string[];
	searchText: string;
	tone?: Tone;
	/** Shown dimmed under the list for the selected item. */
	detail?: string;
}

export interface ListToggles {
	scope: "all" | "subtree";
	showFinished: boolean;
}

interface FuzzyListOptions {
	tui: TUI;
	theme: Theme;
	title: string;
	getItems: (toggles: ListToggles) => ListItem[];
	/** Offer the `tab` scope toggle. */
	scopeToggle?: boolean;
	/** Offer the `ctrl+t` show-finished toggle. */
	finishedToggle?: boolean;
	done: (id: string | undefined) => void;
	pageSize?: number;
}

const isNext = (data: string) => matchesKey(data, Key.down) || matchesKey(data, "ctrl+n") || matchesKey(data, "ctrl+j") || data === "\n";
const isPrev = (data: string) => matchesKey(data, Key.up) || matchesKey(data, "ctrl+p") || matchesKey(data, "ctrl+k");

export function createFuzzyList(options: FuzzyListOptions): Component {
	const { tui, theme, done } = options;
	const pageSize = options.pageSize ?? 12;
	const toggles: ListToggles = { scope: "all", showFinished: false };
	let query = "";
	let index = 0;

	const visible = () => filterRows(options.getItems(toggles), query);
	const clamp = (count: number) => {
		index = Math.max(0, Math.min(index, Math.max(0, count - 1)));
	};

	return {
		invalidate() {},
		handleInput(data: string) {
			const items = visible();
			if (matchesKey(data, Key.escape)) return done(undefined);
			// ctrl+j is "\n", which pi's key matcher may also report as enter: movement is checked first.
			if (!isPrev(data) && !isNext(data) && (matchesKey(data, Key.enter) || data === "\r")) return done(items[index]?.id);
			if (isPrev(data)) index--;
			else if (isNext(data)) index++;
			else if (matchesKey(data, Key.pageUp)) index -= pageSize;
			else if (matchesKey(data, Key.pageDown)) index += pageSize;
			else if (options.scopeToggle && matchesKey(data, Key.tab)) {
				toggles.scope = toggles.scope === "all" ? "subtree" : "all";
				index = 0;
			} else if (options.finishedToggle && matchesKey(data, "ctrl+t")) {
				toggles.showFinished = !toggles.showFinished;
				index = 0;
			} else if (matchesKey(data, Key.backspace)) {
				query = query.slice(0, -1);
				index = 0;
			} else if (data.length === 1 && data >= " " && data !== "\x7f") {
				query += data;
				index = 0;
			} else return;
			clamp(visible().length);
			tui.requestRender();
		},
		render(width: number): string[] {
			const items = visible();
			clamp(items.length);
			const tags = [
				options.scopeToggle ? (toggles.scope === "all" ? "everything" : "my subtree") : undefined,
				options.finishedToggle && toggles.showFinished ? "incl. finished" : undefined,
			].filter(Boolean);
			const lines = [
				truncateToWidth(theme.fg("accent", [options.title, ...tags].join(" · ")), width),
				truncateToWidth(`${theme.fg("muted", "› ")}${query}${theme.fg("dim", "▏")}`, width),
			];
			if (items.length === 0) {
				lines.push(theme.fg("warning", "  no matches"));
			} else {
				const start = Math.max(0, Math.min(index - Math.floor(pageSize / 2), items.length - pageSize));
				const window = items.slice(start, start + pageSize);
				const aligned = alignCells(window.map((item) => item.cells));
				window.forEach((item, i) => {
					const selected = start + i === index;
					const text = aligned[i] ?? "";
					lines.push(truncateToWidth(selected ? `${theme.fg("accent", "▸ ")}${theme.fg("accent", text)}` : `  ${theme.fg(item.tone ?? "text", text)}`, width));
				});
				if (items.length > pageSize) lines.push(theme.fg("dim", `  ${index + 1}/${items.length}`));
				const detail = items[index]?.detail;
				if (detail) lines.push(truncateToWidth(theme.fg("dim", `  ${detail}`), width));
			}
			const hints = ["↑↓/ctrl+j,k move", "enter select", options.scopeToggle ? "tab scope" : undefined, options.finishedToggle ? "ctrl+t finished" : undefined, "esc close"].filter(Boolean);
			lines.push(theme.fg("dim", `  ${hints.join(" · ")}`));
			return lines;
		},
	};
}
