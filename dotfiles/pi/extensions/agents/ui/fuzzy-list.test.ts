import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFuzzyList, type ListItem, type ListToggles } from "./fuzzy-list.ts";

const theme = { fg: (_c: string, t: string) => t } as never;
const tui = { requestRender() {} } as never;
const item = (id: string, ...cells: string[]): ListItem => ({ id, cells, searchText: `${id} ${cells.join(" ")}`.toLowerCase() });
const ITEMS = [item("a", "alpha", "first"), item("b", "bravo", "second"), item("c", "charlie", "third")];

const header = (id: string, title: string): ListItem => ({ id, cells: [title], searchText: "", header: true });
const GROUPED = [header("h1", "NEEDS YOU (2)"), item("a", "alpha", "first"), item("b", "bravo", "second"), header("h2", "COMPLETED (1)"), item("c", "charlie", "third")];

function make(extra: { scopeToggle?: boolean; finishedToggle?: boolean; viewToggle?: boolean; items?: ListItem[]; pageSize?: number } = {}) {
	let result: string | undefined | "pending" = "pending";
	const seenToggles: ListToggles[] = [];
	const comp = createFuzzyList({
		tui,
		theme,
		title: "T",
		getItems: (t) => (seenToggles.push({ ...t }), extra.items ?? ITEMS),
		done: (id) => void (result = id),
		...extra,
	});
	return { comp, result: () => result, seenToggles };
}
const selected = (lines: string[]) => lines.find((l) => l.startsWith("▸"))?.replace(/\s+/g, " ");

describe("fuzzy list keys", () => {
	it("moves with ctrl+j / ctrl+k as well as arrows and ctrl+n / ctrl+p", () => {
		const { comp } = make();
		assert.match(selected(comp.render(80))!, /alpha/);
		comp.handleInput!("\n"); // ctrl+j
		assert.match(selected(comp.render(80))!, /bravo/);
		comp.handleInput!("\x0e"); // ctrl+n
		assert.match(selected(comp.render(80))!, /charlie/);
		comp.handleInput!("\x0b"); // ctrl+k
		assert.match(selected(comp.render(80))!, /bravo/);
		comp.handleInput!("\x10"); // ctrl+p
		assert.match(selected(comp.render(80))!, /alpha/);
		comp.handleInput!("\x1b[B"); // down arrow
		assert.match(selected(comp.render(80))!, /bravo/);
	});
	it("clamps at both ends", () => {
		const { comp } = make();
		for (let i = 0; i < 5; i++) comp.handleInput!("\x0b");
		assert.match(selected(comp.render(80))!, /alpha/);
		for (let i = 0; i < 9; i++) comp.handleInput!("\x0e");
		assert.match(selected(comp.render(80))!, /charlie/);
	});
	it("filters by typing, backspace widens again, enter returns the selected id", () => {
		const { comp, result } = make();
		for (const ch of "brv") comp.handleInput!(ch);
		const lines = comp.render(80);
		assert.match(selected(lines)!, /bravo/);
		assert.ok(!lines.join("\n").includes("alpha"));
		comp.handleInput!("\r");
		assert.equal(result(), "b");
	});
	it("shows 'no matches' and returns undefined on enter when nothing matches", () => {
		const { comp, result } = make();
		comp.handleInput!("z");
		comp.handleInput!("z");
		assert.match(comp.render(80).join("\n"), /no matches/);
		comp.handleInput!("\r");
		assert.equal(result(), undefined);
	});
	it("escape closes", () => {
		const { comp, result } = make();
		comp.handleInput!("\x1b");
		assert.equal(result(), undefined);
	});
	it("only honours tab / ctrl+t when enabled", () => {
		const off = make();
		off.comp.handleInput!("\t");
		off.comp.handleInput!("\x14");
		off.comp.render(80);
		assert.ok(off.seenToggles.every((t) => t.scope === "all" && !t.showFinished));

		const on = make({ scopeToggle: true, finishedToggle: true });
		on.comp.handleInput!("\t");
		on.comp.handleInput!("\x14"); // ctrl+t
		on.comp.render(80);
		const last = on.seenToggles.at(-1)!;
		assert.equal(last.scope, "subtree");
		assert.equal(last.showFinished, true);
		assert.match(on.comp.render(80).join("\n"), /my subtree · incl\. archived/);
	});
	it("aligns cells into columns", () => {
		const { comp } = make();
		const lines = comp.render(80).filter((l) => /alpha|bravo|charlie/.test(l));
		const cols = lines.map((l) => l.search(/first|second|third/));
		assert.equal(new Set(cols).size, 1);
	});
});

describe("fuzzy list headers", () => {
	const group = (extra = {}) => make({ items: GROUPED, ...extra });
	const keys = { down: "\x1b[B", up: "\x1b[A", ctrlJ: "\n", ctrlK: "\x0b", ctrlN: "\x0e", ctrlP: "\x10", pageDown: "\x1b[6~", pageUp: "\x1b[5~" };

	it("starts on the first selectable item, with headers shown", () => {
		const { comp } = group();
		const lines = comp.render(80);
		assert.match(selected(lines)!, /alpha/);
		assert.ok(lines.some((l) => l.includes("NEEDS YOU (2)")) && lines.some((l) => l.includes("COMPLETED (1)")));
	});
	it("ctrl+j / ctrl+k and arrows skip headers", () => {
		for (const [next, prev] of [[keys.ctrlJ, keys.ctrlK], [keys.down, keys.up], [keys.ctrlN, keys.ctrlP]] as const) {
			const { comp } = group();
			comp.handleInput!(next);
			assert.match(selected(comp.render(80))!, /bravo/);
			comp.handleInput!(next); // jumps over the COMPLETED header
			assert.match(selected(comp.render(80))!, /charlie/);
			comp.handleInput!(prev);
			assert.match(selected(comp.render(80))!, /bravo/);
			comp.handleInput!(prev);
			comp.handleInput!(prev); // clamps: the header above alpha is not selectable
			assert.match(selected(comp.render(80))!, /alpha/);
		}
	});
	it("clamps at both ends when the first and last items are headers", () => {
		const { comp } = make({ items: [header("h1", "TOP"), item("a", "alpha"), item("b", "bravo"), header("h2", "BOTTOM")] });
		for (let i = 0; i < 4; i++) comp.handleInput!(keys.ctrlK);
		assert.match(selected(comp.render(80))!, /alpha/);
		for (let i = 0; i < 6; i++) comp.handleInput!(keys.ctrlJ);
		assert.match(selected(comp.render(80))!, /bravo/);
		comp.handleInput!(keys.pageDown);
		assert.match(selected(comp.render(80))!, /bravo/);
		comp.handleInput!(keys.pageUp);
		assert.match(selected(comp.render(80))!, /alpha/);
	});
	it("page keys never land on a header", () => {
		const { comp } = group({ pageSize: 3 });
		comp.handleInput!(keys.pageDown); // index 1 + 3 = 4: charlie
		assert.match(selected(comp.render(80))!, /charlie/);
		comp.handleInput!(keys.pageUp); // 4 - 3 = 1: alpha
		assert.match(selected(comp.render(80))!, /alpha/);
	});
	it("enter returns the selected agent, never a header", () => {
		const { comp, result } = group();
		comp.handleInput!(keys.ctrlJ);
		comp.handleInput!(keys.ctrlJ);
		comp.handleInput!("\r");
		assert.equal(result(), "c");
	});
	it("enter after the list changed under the cursor never returns a header", () => {
		let items = GROUPED;
		let result: string | undefined | "pending" = "pending";
		const comp = createFuzzyList({ tui, theme, title: "T", getItems: () => items, done: (id) => void (result = id) });
		comp.render(80); // cursor on index 1
		items = [header("h0", "NEW"), header("h1", "TOP"), ...GROUPED.slice(1)]; // index 1 is now a header
		comp.handleInput!("\r");
		assert.equal(result, "a");
	});
	it("enter selects the highlighted item even if the underlying list shifted since the last render", () => {
		let items = [item("a", "alpha"), item("b", "bravo"), item("c", "charlie")];
		let result: string | undefined | "pending" = "pending";
		const comp = createFuzzyList({ tui, theme, title: "T", getItems: () => items, done: (id) => void (result = id) });
		comp.render(80);
		comp.handleInput!(keys.ctrlJ); // on bravo
		items = [item("x", "xray"), item("y", "yankee"), ...items];
		comp.handleInput!("\r");
		assert.equal(result, "b");
		assert.match(selected(comp.render(80))!, /bravo/); // the cursor follows the item
	});
	it("enter in a list of only headers does nothing", () => {
		let result: string | undefined | "pending" = "pending";
		const comp = createFuzzyList({ tui, theme, title: "T", getItems: () => [header("h", "H")], done: (id) => void (result = id) });
		comp.render(80);
		comp.handleInput!("\r");
		assert.equal(result, undefined);
	});
	it("a whitespace-only query still hides headers", () => {
		const { comp } = group();
		comp.handleInput!(" ");
		assert.ok(!comp.render(80).join("\n").includes("NEEDS YOU"));
	});
	it("hides headers while a query is typed and ranks agent rows flat", () => {
		const { comp, result } = group();
		comp.handleInput!("c");
		comp.handleInput!("h");
		const lines = comp.render(80);
		assert.ok(!lines.join("\n").includes("NEEDS YOU") && !lines.join("\n").includes("COMPLETED"));
		assert.match(selected(lines)!, /charlie/);
		comp.handleInput!("\x7f");
		comp.handleInput!("\x7f"); // query cleared: headers come back, first agent selected
		const back = comp.render(80);
		assert.ok(back.join("\n").includes("NEEDS YOU (2)"));
		assert.match(selected(back)!, /alpha/);
		comp.handleInput!("\r");
		assert.equal(result(), "a");
	});
	it("a query matching nothing shows no matches, not a header", () => {
		const { comp } = group();
		comp.handleInput!("z");
		comp.handleInput!("z");
		const text = comp.render(80).join("\n");
		assert.match(text, /no matches/);
		assert.ok(!text.includes("NEEDS YOU"));
	});
	it("aligns agent columns across headers and counts only agents in the position", () => {
		const { comp } = group({ pageSize: 4 });
		const lines = comp.render(80);
		assert.equal(new Set(lines.filter((l) => /alpha|bravo/.test(l)).map((l) => l.search(/first|second/))).size, 1);
		assert.match(lines.join("\n"), /1\/3/);
	});
	it("ctrl+v toggles the view only when enabled; title and hint name it", () => {
		const off = make();
		off.comp.handleInput!("\x16");
		off.comp.render(80);
		assert.ok(off.seenToggles.every((t) => t.view === "triage"));
		const on = make({ viewToggle: true });
		assert.match(on.comp.render(80).join("\n"), /^T · triage[\s\S]*ctrl\+v tree view/);
		on.comp.handleInput!("\x16");
		assert.match(on.comp.render(80).join("\n"), /^T · tree[\s\S]*ctrl\+v triage view/);
		assert.equal(on.seenToggles.at(-1)!.view, "tree");
	});
	it("shows the dim parent suffix only when it fits", () => {
		const withSuffix = [{ ...item("a", "alpha", "first"), suffix: "parentname" }];
		const { comp } = make({ items: withSuffix });
		assert.match(comp.render(80).join("\n"), /alpha\s+first\s+parentname/);
		assert.ok(!comp.render(20).join("\n").includes("parentname"));
	});
});
