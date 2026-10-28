import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentRecord, AgentState, AgentStatus } from "../store/index.ts";
import { agentMessageText } from "../store/index.ts";
import { actionsFor, activityText, agentMessageView, alignCells, buildRows, claimLine, cleanSummary, filterListItems, filterRows, formatDuration, fuzzyScore, lineageText, qualifiedNames, TRIAGE_GROUPS, triage, widgetLines } from "./model.ts";

import { createFuzzyList } from "./fuzzy-list.ts";

const NOW = 100_000_000;
function rec(id: string, parent: string | null, status: AgentStatus, state: Partial<AgentState> = {}, name = id.split(".")[1] ?? id): AgentRecord {
	return { input: { id, parent, name, role: parent ? "worker" : "main", objective: "trace row errors", profile: { name: "p", modelId: "m", thinking: "off" }, cwd: "/", interactable: true, stepTimeoutMs: 180000, depth: parent ? 1 : 0, createdAt: 0 },
		state: { status, since: 0, activity: { lastEventAt: 0, lastSeenAt: 0, inFlight: null }, ...state },
		status, alive: status === "working", residency: status === "working" ? "live" : "parked" };
}
const opts = { now: NOW, breadcrumb: (id: string) => `root › ${id}` };
const ids = (rows: { id: string }[]) => rows.map(row => row.id);

it("groups six states by urgency and explicit parent while search retains ownership and archive is explicit", () => {
	const first = rec("main.first.1111", null, "idle", {}, "shared");
	const second = rec("main.second.2222", null, "idle", {}, "shared");
	const a = rec("worker.central-agents-impl.a001", first.input.id, "needs-you", { since: 100 }, "central-agents-implementation-with-a-long-name");
	const b = rec("worker.review.b001", second.input.id, "needs-you", { since: 200 });
	const c = rec("worker.central-agents-test.a002", first.input.id, "needs-you", { since: 300 });
	const blocked = rec("worker.old-block.b002", second.input.id, "blocked", { reason: "Ownership unresolved", since: 0 });
	const waiting = rec("worker.question.a003", first.input.id, "waiting-on-parent");
	const idle = rec("worker.available.b003", second.input.id, "idle", { summary: "Completion handed to parent", handoff: { to: "parent", recipient: second.input.id, messageId: "handoff-1", at: 1 } });
	const archived = rec("worker.retired.a004", first.input.id, "archived");
	const grandchild = rec("worker.still-active.c001", archived.input.id, "working");
	const records = [first, second, a, b, c, blocked, waiting, idle, archived, grandchild];
	const t = triage(records, opts);
	assert.deepEqual(ids(t.needs), [a.input.id, b.input.id, c.input.id]);
	assert.deepEqual(ids(t.blocked), [blocked.input.id]); // old blocked records never decay/disappear
	assert.deepEqual(ids(t.waiting), [waiting.input.id]); // parked parent does not make a question or completion human attention
	assert.deepEqual(ids(t.idle), [idle.input.id]);
	assert.deepEqual(t.archived, []);
	assert.deepEqual(ids(t.items).slice(0, 6), ["header:needs", `header:needs:parent:${first.input.id}`, a.input.id, c.input.id, `header:needs:parent:${second.input.id}`, b.input.id]);
	assert.equal(t.items[1]?.cells[0], "Parent: shared · 1111 (2)");
	assert.equal(t.items[4]?.cells[0], "Parent: shared · 2222 (1)");
	assert.ok(t.items.filter(row => row.header).every(row => row.searchText === ""));
	const matches = filterListItems(t.items, "central-agents");
	assert.deepEqual(ids(matches), [a.input.id, c.input.id]);
	assert.ok(matches.every(row => !row.header && row.cells[0]?.includes("shared::central-agents")));
	assert.deepEqual(ids(filterListItems(t.items, "shared::central-agents")), [a.input.id, c.input.id]);
	const fullName = "shared::central-agents-implementation-with-a-long-name";
	assert.equal(t.needs[0]?.name, fullName);
	assert.ok(alignCells([t.needs[0]!.cells])[0]?.includes(fullName), "name is not capped at 34 while secondary columns dominate");
	const picker = createFuzzyList({ title: "Agents", getItems: () => t.items,
		theme: { fg: (_color: string, value: string) => value } as never, tui: { requestRender() {} } as never, done() {} });
	assert.ok(picker.render(24).join("").replace(/\s+/g, "").includes(fullName), "selected detail wraps the complete qualified name on narrow terminals");
	const sameA = rec("worker.same.a005", first.input.id, "idle");
	const sameB = rec("worker.same.b005", second.input.id, "idle");
	const duplicateNames = qualifiedNames([...records, sameA, sameB]);
	assert.equal(duplicateNames.get(sameA.input.id), "shared::same · a005");
	assert.equal(duplicateNames.get(sameB.input.id), "shared::same · b005");
	assert.equal(filterListItems(t.items, a.input.id)[0]?.id, a.input.id);
	assert.deepEqual(ids(triage(records, { ...opts, showArchived: true }).archived), [archived.input.id]);
	const tree = buildRows(records, { ...opts, hideFinished: true });
	assert.ok(!ids(tree).includes(archived.input.id));
	assert.ok(ids(tree).includes(grandchild.input.id), "archive never cascades to active children");
	assert.equal(tree.find(row => row.id === grandchild.input.id)?.name, "shared::retired::still-active");
	assert.deepEqual(ids(triage(records, { ...opts, subtreeOf: second.input.id }).needs), [b.input.id]);
	assert.equal(triage(records, { ...opts, idleMaxAgeMs: 600000 }).idle.length, 0);
	assert.equal(triage(records, { ...opts, idleMaxAgeMs: 600000 }).blocked.length, 1);
	const rootActions = actionsFor({ ...first, status: "archived" }, "another-root").map(([action]) => action);
	assert.ok(rootActions.includes("restore"));
	assert.ok(!rootActions.includes("restore-attach"), "human roots restore without daemon launch or managed attachment");
});

it("compact widget names are relative to focus without changing full picker identity", () => {
	const parent = rec("main.parent.0001", null, "idle", {}, "parent");
	const child = rec("worker.child.0002", parent.input.id, "idle");
	const grandchild = rec("worker.grandchild.0003", child.input.id, "needs-you");
	const other = rec("worker.other.0004", parent.input.id, "idle");
	const otherGrandchild = rec("worker.grandchild.0005", other.input.id, "blocked", { reason: "review failure" });
	const sameA = rec("worker.same.0006", parent.input.id, "idle");
	const sameB = rec("worker.same.0007", parent.input.id, "idle");
	const records = [parent, child, grandchild, other, otherGrandchild, sameA, sameB];
	const rowsFor = (focusedId: string) => {
		const grouped = triage(records, { ...opts, subtreeOf: focusedId });
		return TRIAGE_GROUPS.flatMap(group => grouped[group]).filter(row => row.id !== focusedId);
	};
	const rows = rowsFor(parent.input.id);
	const original = JSON.stringify({ records, rows });
	const compact = widgetLines(rows, 20, rows.length, { records, focusedId: parent.input.id }).join("\n");
	assert.match(compact, /○ child\s+worker/);
	assert.match(compact, /\? child::grandchild\s+worker/);
	assert.match(compact, /! other::grandchild\s+worker/);
	assert.match(compact, /same · 0006/);
	assert.match(compact, /same · 0007/);
	assert.ok(!compact.includes("parent::"));
	assert.ok(!compact.includes("grandchild · 0003"), "distinct branch paths need no extra ID");
	const focusedChild = widgetLines(rowsFor(child.input.id), 6, 1, { records, focusedId: child.input.id }).join("\n");
	assert.match(focusedChild, /\? grandchild\s+worker/);
	assert.ok(!focusedChild.includes("child::"));
	assert.ok(widgetLines(rows, 20).join("\n").includes("parent::child::grandchild"), "full picker-style rows stay qualified by default");
	assert.equal(rows.find(row => row.id === grandchild.input.id)?.name, "parent::child::grandchild");
	assert.equal(JSON.stringify({ records, rows }), original, "relative rendering never mutates input, breadcrumbs or search identity");
	assert.match(widgetLines(rows, 3, 10, { records, focusedId: parent.input.id })[3]!, /7 more/);
});

describe("fuzzy filtering", () => {
	it("matches subsequences across id, objective and status", () => {
		const rows = [{ id: "worker", searchText: "worker.pf518.0001 trace row errors working" }, { id: "scout", searchText: "scout.smartopen.0002 review smart_open idle" }];
		assert.ok(fuzzyScore("wkr", "worker") !== undefined);
		assert.equal(fuzzyScore("zzz", "worker"), undefined);
		assert.deepEqual(ids(filterRows(rows, "smrt")), ["scout"]);
		assert.deepEqual(ids(filterRows(rows, "row err")), ["worker"]);
		assert.equal(filterRows(rows, "rowerr").length, 0);
		assert.equal(filterRows(rows, "").length, 2);
		assert.equal(filterRows(rows, "nomatch").length, 0);
		const names = [{ id: "fuzzy", searchText: "worker.cenxtral-agxents-ixmpl.ef56" }, { id: "first-exact", searchText: "WORKER.CENTRAL-AGENTS-IMPL.AB12" }, { id: "second-exact", searchText: "worker.central-agents-impl.cd34" }];
		const ranked = ["first-exact", "second-exact", "fuzzy"];
		assert.deepEqual(ids(filterRows(names, "central-agents-impl")), ranked);
		assert.deepEqual(ids(filterRows(names, "CENTRAL agents impl")), ranked);
		assert.deepEqual(ids(filterRows(names, "worker.central-agents-impl.ab12")), ["first-exact"]);
		assert.deepEqual(ids(filterRows(names, "central--agents_impl")), ranked);
		assert.equal(filterRows(names, " --._ "), names);
	});
});

describe("display helpers", () => {
	it("formats duration, notes and blocked reasons", () => {
		assert.equal(formatDuration(60000), "1m");
		assert.equal(formatDuration(3660000), "1h1m");
		assert.equal(activityText(rec("worker.a.0001", "root", "blocked", { reason: "Owner is unknown" }), NOW), "Owner is unknown");
		assert.match(activityText(rec("worker.a.0001", "root", "needs-you", { since: NOW - 60000, note: "review ready" }), NOW), /1m · review ready/);
	});
	it("aligns columns, clips long cells and cleans summaries", () => {
		const lines = alignCells([["● a", "worker", "working", "bash: pytest"], ["○ longer", "scout", "idle", "x"]]);
		assert.equal(lines[0]!.indexOf("worker"), lines[1]!.indexOf("scout"));
		assert.ok(!lines[1]!.endsWith(" "));
		assert.match(alignCells([["x".repeat(50), "r", "s", "a"]], [10, 5, 5])[0]!, /^x{9}…/);
		assert.equal(cleanSummary("`Summary`. More details."), "Summary.");
	});
	it("bounds widget output and uses independent residency counts", () => {
		const root = rec("main.root.0001", null, "idle");
		const children = Array.from({ length: 5 }, (_, i) => rec(`worker.w${i}.000${i}`, root.input.id, "idle"));
		const rows = buildRows(children, opts);
		assert.match(widgetLines(rows, 3, 100)[3]!, /97 more/);
		assert.equal(lineageText(root, undefined, children), "5 agents (0 live)");
		assert.equal(lineageText(root, undefined, [], { total: 100, live: 2 }), "100 agents (2 live)");
	});
});

describe("actions", () => {
	it("offers explicit archive/restore and never fabricates a blocked yield", () => {
		const root = "main.root.0001";
		const choices = (record: AgentRecord) => actionsFor(record, root).map(([id]) => id);
		assert.ok(choices(rec("worker.a.0001", root, "idle")).includes("yield"));
		assert.ok(!choices(rec("worker.a.0001", root, "blocked")).includes("yield"));
		const retired = choices(rec("worker.a.0001", root, "archived"));
		assert.ok(retired.includes("restore") && retired.includes("restore-attach"));
		assert.ok(!retired.includes("attach") && !retired.includes("resume") && !retired.includes("archive"));
		assert.deepEqual(actionsFor(rec(root, null, "idle"), root).map(([id]) => id), ["details"]);
	});
});

describe("transcript markers", () => {
	it("keeps branch result claims and sender rendering distinct from workflow completion", () => {
		assert.match(claimLine("agents.spawn", { id: "scout.a.0001", name: "a", role: "scout", objective: "find things" })!, /spawned a/);
		assert.equal(claimLine("agents.result", { id: "scout.a.0001", status: "idle", summary: "handed off" }), "◂ scout.a.0001 idle · handed off");
		assert.equal(claimLine("other", {}), undefined);
		const text = agentMessageText({ from: "worker.a.0001", kind: "yield", id: "m1", body: Array.from({ length: 10 }, (_, i) => `line ${i}`).join("\n") });
		const view = agentMessageView(text, { from: "worker.a.0001", kind: "yield" }, false);
		assert.equal(view.header, "[from worker.a.0001 · yield]");
		assert.equal(view.body.length, 6); assert.equal(view.hidden, 4);
		const labeled = agentMessageText({ from: "worker.a.0001", kind: "info", id: "m2", body: "hello" }, "parent::child");
		assert.equal(labeled, "[from parent::child (id: worker.a.0001) · info · m2]\nhello");
		assert.equal(agentMessageView(labeled, { from: "worker.a.0001", fromName: "parent::child", kind: "info" }, false).header, "[from parent::child · info]");
		assert.equal(claimLine("agents.result", { id: "worker.a.0001", name: "parent::child", status: "idle", summary: "ok" }), "◂ parent::child idle · ok");
		assert.deepEqual(agentMessageView("plain", undefined, false).body, ["plain"]);
	});
});
