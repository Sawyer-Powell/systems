/**
 * A generic fuzzy-filtered list component used for the agent picker and the
 * per-agent action menu. Typing filters; `up/down`, `ctrl+p/n` and `ctrl+k/j`
 * move; `enter` selects; `esc` closes. Optional toggles: `tab` (scope),
 * `ctrl+t` (show finished) and `ctrl+v` (triage/tree view). Header items are
 * titles: movement skips them, enter ignores them, filtering hides them.
 * Rendering is plain strings; list logic is in `model.ts`.
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, Key, matchesKey, type TUI, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { alignCells, filterListItems, type Tone } from "./model.ts";

export interface ListItem {
	id: string;
	/** Plain-text cells, aligned into columns. */
	cells: string[];
	searchText: string;
	tone?: Tone;
	/** Shown dimmed under the list for the selected item. */
	detail?: string;
	/** Dim trailing column, shown only when every visible row's suffix fits the width. */
	suffix?: string;
	/** A group title: not selectable, hidden while a query is typed. */
	header?: boolean;
	parentContext?: string;
	nameQualified?: boolean;
}

export interface ListToggles {
	scope: "all" | "subtree";
	showFinished: boolean;
	view: "triage" | "tree";
}

interface FuzzyListOptions {
	tui: TUI;
	theme: Theme;
	title: string;
	initialQuery?: string;
	getItems: (toggles: ListToggles) => ListItem[];
	/** Offer the `tab` scope toggle. */
	scopeToggle?: boolean;
	/** Offer the `ctrl+t` show-finished toggle. */
	finishedToggle?: boolean;
	/** Offer the `ctrl+v` triage/tree toggle; `getItems` receives the view. */
	viewToggle?: boolean;
	done: (id: string | undefined) => void;
	pageSize?: number;
}

const isNext = (data: string) => matchesKey(data, Key.down) || matchesKey(data, "ctrl+n") || matchesKey(data, "ctrl+j") || data === "\n";
const isPrev = (data: string) => matchesKey(data, Key.up) || matchesKey(data, "ctrl+p") || matchesKey(data, "ctrl+k");

export function createFuzzyList(options: FuzzyListOptions): Component {
	const { tui, theme, done } = options;
	const pageSize = options.pageSize ?? 12;
	const toggles: ListToggles = { scope: "all", showFinished: false, view: "triage" };
	let query = options.initialQuery ?? "";
	let index = 0;

	// A typed query drops headers and ranks agent rows only.
	const visible = () => {
		const items = options.getItems(toggles);
		return query ? filterListItems(items, query) : items;
	};
	/** Nearest selectable index to `target`, looking in `dir` first, then back (so both ends clamp). */
	const settle = (items: ListItem[], target: number, dir: 1 | -1) => {
		const at = Math.max(0, Math.min(target, items.length - 1));
		for (const d of [dir, -dir]) for (let i = at; i >= 0 && i < items.length; i += d) if (!items[i]?.header) return i;
		return -1;
	};
	// Keys act on `shown`, the list the user last saw, so a refetch cannot change what enter selects.
	let shown: ListItem[] = [];
	let stale = true; // query or toggle changed (or never rendered): refetch, cursor to the top
	/** Refetch the list; keep the cursor on the same item when it is still there. */
	const sync = () => {
		const keep = stale ? undefined : shown[index]?.id;
		shown = visible();
		const at = keep === undefined ? -1 : shown.findIndex((item) => item.id === keep);
		index = Math.max(0, settle(shown, at >= 0 ? at : stale ? 0 : index, 1));
		stale = false;
	};

	return {
		invalidate() {},
		handleInput(data: string) {
			if (stale) sync();
			if (matchesKey(data, Key.escape)) return done(undefined);
			// ctrl+j is "\n", which pi's key matcher may also report as enter: movement is checked first.
			if (!isPrev(data) && !isNext(data) && (matchesKey(data, Key.enter) || data === "\r")) {
				const chosen = shown[index];
				return done(chosen && !chosen.header ? chosen.id : undefined);
			}
			let dir: 1 | -1 = 1;
			let target = 0;
			if (isPrev(data)) [dir, target] = [-1, index - 1];
			else if (isNext(data)) target = index + 1;
			else if (matchesKey(data, Key.pageUp)) [dir, target] = [-1, index - pageSize];
			else if (matchesKey(data, Key.pageDown)) target = index + pageSize;
			else {
				if (options.scopeToggle && matchesKey(data, Key.tab)) toggles.scope = toggles.scope === "all" ? "subtree" : "all";
				else if (options.finishedToggle && matchesKey(data, "ctrl+t")) toggles.showFinished = !toggles.showFinished;
				else if (options.viewToggle && matchesKey(data, "ctrl+v")) toggles.view = toggles.view === "triage" ? "tree" : "triage";
				else if (matchesKey(data, Key.backspace)) query = query.slice(0, -1);
				else if (data.length === 1 && data >= " " && data !== "\x7f") query += data;
				else return;
				stale = true;
				return tui.requestRender();
			}
			index = Math.max(0, settle(shown, target, dir));
			tui.requestRender();
		},
		render(width: number): string[] {
			sync();
			const items = shown;
			const tags = [
				options.viewToggle ? toggles.view : undefined,
				options.scopeToggle ? (toggles.scope === "all" ? "everything" : "my subtree") : undefined,
				options.finishedToggle && toggles.showFinished ? "incl. archived" : undefined,
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
				const rows = window.filter((item) => !item.header);
				const aligned = alignCells(rows.map((item) => item.cells));
				// Pad rows to one width so the suffix column lines up; drop it when it does not fit.
				const textWidth = Math.max(0, ...aligned.map(visibleWidth));
				const suffixWidth = Math.max(0, ...rows.map((item) => visibleWidth(item.suffix ?? "")));
				const showSuffix = suffixWidth > 0 && 2 + textWidth + 2 + suffixWidth <= width;
				let next = 0;
				window.forEach((item, i) => {
					if (item.header) return void lines.push(truncateToWidth(theme.fg("muted", `  ${item.cells[0] ?? ""}`), width));
					const text = aligned[next++] ?? "";
					const suffix = showSuffix && item.suffix ? `${" ".repeat(textWidth - visibleWidth(text))}  ${theme.fg("dim", item.suffix)}` : "";
					const selected = start + i === index;
					lines.push(truncateToWidth(selected ? `${theme.fg("accent", "▸ ")}${theme.fg("accent", text)}${suffix}` : `  ${theme.fg(item.tone ?? "text", text)}${suffix}`, width));
				});
				if (items.length > pageSize) {
					const choices = items.filter((item) => !item.header);
					lines.push(theme.fg("dim", `  ${choices.indexOf(items[index]!) + 1}/${choices.length}`));
				}
				const detail = items[index]?.detail;
				if (detail) lines.push(...wrapTextWithAnsi(theme.fg("dim", detail), Math.max(1, width - 2)).map(line => `  ${line}`));
			}
			const hints = [
				"↑↓/ctrl+j,k move",
				"enter select",
				options.scopeToggle ? "tab scope" : undefined,
				options.finishedToggle ? "ctrl+t archived" : undefined,
				options.viewToggle ? `ctrl+v ${toggles.view === "triage" ? "tree" : "triage"} view` : undefined,
				"esc close",
			].filter(Boolean);
			lines.push(theme.fg("dim", `  ${hints.join(" · ")}`));
			return lines;
		},
	};
}
