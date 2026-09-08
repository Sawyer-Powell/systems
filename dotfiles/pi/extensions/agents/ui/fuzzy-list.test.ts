import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFuzzyList, type ListItem, type ListToggles } from "./fuzzy-list.ts";

const theme = { fg: (_c: string, t: string) => t } as never;
const tui = { requestRender() {} } as never;
const item = (id: string, ...cells: string[]): ListItem => ({ id, cells, searchText: `${id} ${cells.join(" ")}`.toLowerCase() });
const ITEMS = [item("a", "alpha", "first"), item("b", "bravo", "second"), item("c", "charlie", "third")];

function make(extra: { scopeToggle?: boolean; finishedToggle?: boolean } = {}) {
	let result: string | undefined | "pending" = "pending";
	const seenToggles: ListToggles[] = [];
	const comp = createFuzzyList({
		tui,
		theme,
		title: "T",
		getItems: (t) => (seenToggles.push({ ...t }), ITEMS),
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
		assert.match(on.comp.render(80).join("\n"), /my subtree · incl\. finished/);
	});
	it("aligns cells into columns", () => {
		const { comp } = make();
		const lines = comp.render(80).filter((l) => /alpha|bravo|charlie/.test(l));
		const cols = lines.map((l) => l.search(/first|second|third/));
		assert.equal(new Set(cols).size, 1);
	});
});
