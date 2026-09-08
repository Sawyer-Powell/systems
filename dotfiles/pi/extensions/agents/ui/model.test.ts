import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentRecord, EffectiveStatus } from "../store/index.ts";
import { actionsFor, activityText, alignCells, buildRows, cleanSummary, filterRows, formatDuration, fuzzyScore, lineageText, widgetLines } from "./model.ts";

const rec = (id: string, parent: string | null, status: EffectiveStatus, extra: Partial<AgentRecord["input"]> = {}, state: Partial<NonNullable<AgentRecord["state"]>> = {}): AgentRecord => ({
	input: { id, role: id.split(".")[0]!, name: id.split(".")[1] ?? id, parent, objective: `obj ${id}`, profile: { name: "p", modelId: "m", thinking: "low" }, cwd: "/", interactable: true, stepTimeoutMs: 1, depth: 0, createdAt: Number(id.slice(-4)), ...extra },
	state: { status: status === "lost" ? "working" : status, since: 0, activity: { lastEventAt: 0, lastSeenAt: 0, inFlight: null }, ...state },
	alive: !["lost", "done", "stopped", "error", "timed-out"].includes(status), // terminal agents have no process unless a test says otherwise
	status,
});
const opts = { now: 600_000, breadcrumb: (id: string) => id };

describe("formatDuration", () => {
	it("is compact", () => {
		assert.equal(formatDuration(5_000), "5s");
		assert.equal(formatDuration(240_000), "4m");
		assert.equal(formatDuration(3_900_000), "1h5m");
	});
});

describe("activityText", () => {
	it("shows the in-flight step with elapsed time", () => {
		const r = rec("worker.a.0002", null, "working", {}, { activity: { lastEventAt: 0, lastSeenAt: 0, inFlight: { kind: "tool", name: "bash", summary: "bash: pytest", startedAt: 0 } } });
		assert.equal(activityText(r, 1_380_000), "bash: pytest 23m");
	});
	it("shows waiting and idle durations", () => {
		// the status label is a separate column, so activity never repeats it
		assert.equal(activityText(rec("worker.a.0002", null, "idle", {}, { since: 0 }), 240_000), "4m");
		assert.equal(activityText(rec("worker.a.0002", null, "waiting-on-user", {}, { since: 0 }), 60_000), "1m");
		assert.equal(activityText(rec("worker.a.0002", null, "lost", {}, { activity: { lastEventAt: 0, lastSeenAt: 0, inFlight: null } }), 120_000), "gone 2m");
	});
});

describe("activityText with a status note", () => {
	const inFlight = { kind: "tool" as const, name: "bash", summary: "bash: pytest", startedAt: 0 };
	it("working shows the note instead of the step; without it, the step", () => {
		const base = { activity: { lastEventAt: 0, lastSeenAt: 0, inFlight } };
		assert.equal(activityText(rec("worker.a.0002", null, "working", {}, { ...base, note: "running tests" }), 60_000), "running tests");
		assert.equal(activityText(rec("worker.a.0002", null, "working", {}, base), 60_000), "bash: pytest 1m");
		assert.equal(activityText(rec("worker.a.0002", null, "working", {}, { note: "waiting on CI" }), 60_000), "waiting on CI");
		assert.equal(activityText(rec("worker.a.0002", null, "working", {}), 60_000), "quiet 1m");
	});
	it("idle and waiting-on-user show duration, then the note", () => {
		assert.equal(activityText(rec("worker.a.0002", null, "idle", {}, { since: 0, note: "tests green" }), 240_000), "4m · tests green");
		assert.equal(activityText(rec("worker.a.0002", null, "idle", {}, { since: 0 }), 240_000), "4m");
		assert.equal(activityText(rec("worker.a.0002", null, "waiting-on-user", {}, { since: 0, note: "tests green" }), 60_000), "1m · tests green");
		assert.equal(activityText(rec("worker.a.0002", null, "waiting-on-user", {}, { since: 0 }), 60_000), "1m");
		assert.equal(activityText(rec("worker.a.0002", null, "waiting-on-parent", {}, { since: 0, note: "n" }), 60_000), "1m · n");
	});
});

describe("buildRows", () => {
	const records = [
		rec("main.root.0001", null, "idle"),
		rec("worker.a.0002", "main.root.0001", "working"),
		rec("scout.b.0003", "worker.a.0002", "done"),
		rec("worker.c.0004", "main.root.0001", "waiting-on-user"),
		rec("main.old.0000", null, "stopped"),
	];
	it("orders depth-first with indentation and waiting glyphs", () => {
		const rows = buildRows(records, { ...opts, hideFinished: true });
		assert.deepEqual(rows.map((r) => r.id), ["main.root.0001", "worker.a.0002", "scout.b.0003", "worker.c.0004"]);
		assert.deepEqual(rows.map((r) => r.cells[0]!.search(/\S/)), [0, 2, 4, 2]); // indent = 2 spaces per depth
		assert.equal(rows.find((r) => r.id === "worker.c.0004")?.cells[0], "  ? c");
		assert.equal(rows.find((r) => r.id === "worker.c.0004")?.tone, "warning");
		assert.deepEqual(rows[2]!.cells.slice(0, 3), ["    ✓ b", "scout", "done"]);
		assert.equal(rows.find((r) => r.id === "worker.c.0004")?.cells[2], "needs you");
	});
	it("shows finished roots when not hidden, and scopes to a subtree", () => {
		assert.equal(buildRows(records, opts).length, 5);
		assert.deepEqual(buildRows(records, { ...opts, subtreeOf: "worker.a.0002" }).map((r) => r.id), ["worker.a.0002", "scout.b.0003"]);
	});
	it("hides whole finished trees but keeps trees with anything unfinished or lost", () => {
		const finished = [rec("main.a.0001", null, "stopped"), rec("scout.b.0002", "main.a.0001", "done")];
		assert.equal(buildRows(finished, { ...opts, hideFinished: true }).length, 0);
		assert.equal(buildRows(finished, opts).length, 2);
		const lostChild = [rec("main.a.0001", null, "stopped"), rec("worker.b.0002", "main.a.0001", "lost")];
		assert.equal(buildRows(lostChild, { ...opts, hideFinished: true }).length, 2);
	});
	it("keeps a done-but-alive (attachable) agent visible even when its root has stopped", () => {
		const stoppedRoot = rec("main.a.0001", null, "stopped");
		const attachable = { ...rec("worker.b.0002", "main.a.0001", "done"), alive: true };
		const rows = buildRows([stoppedRoot, attachable], { ...opts, hideFinished: true });
		assert.deepEqual(rows.map((r) => r.id), ["main.a.0001", "worker.b.0002"]);
		// once its process is gone the tree is finished and hides
		assert.equal(buildRows([stoppedRoot, rec("worker.b.0002", "main.a.0001", "done")], { ...opts, hideFinished: true }).length, 0);
	});
	it("disambiguates duplicate names with the id tail and leaves unique names alone", () => {
		const twins = [rec("main.plenful.s0jf", null, "idle", { name: "plenful" }), rec("main.plenful.ab12", null, "idle", { name: "plenful" }), rec("worker.demo.lmba", "main.plenful.s0jf", "idle", { name: "demo" })];
		const names = buildRows(twins, opts).map((r) => r.name);
		assert.deepEqual(names, ["plenful·s0jf", "demo", "plenful·ab12"]);
	});
	it("drops long-finished agents from the compact widget view only", () => {
		const old = rec("scout.b.0002", "main.a.0001", "done", {}, { since: 0 });
		const recs = [rec("main.a.0001", null, "idle"), old];
		assert.equal(buildRows(recs, { ...opts, now: 20 * 60_000, finishedMaxAgeMs: 10 * 60_000 }).length, 1);
		assert.equal(buildRows(recs, { ...opts, now: 20 * 60_000 }).length, 2);
	});
	it("marks stalled agents and treats orphans as roots", () => {
		const rows = buildRows([rec("worker.z.0009", "ghost.x.0000", "working")], { ...opts, stalls: new Map([["worker.z.0009", { kind: "stall", overMs: 1, detail: "" }]]) });
		assert.equal(rows[0]?.cells[0], "! z"); // depth 0, stall glyph
		assert.equal(rows[0]?.tone, "error");
	});
});

describe("fuzzy filtering", () => {
	const rows = buildRows([rec("worker.pf518.0001", null, "working", { objective: "trace row errors" }), rec("scout.smartopen.0002", null, "done", { objective: "review smart_open" })], opts);
	it("matches subsequences across id, objective and status", () => {
		assert.ok(fuzzyScore("wkr", "worker") !== undefined);
		assert.equal(fuzzyScore("zzz", "worker"), undefined);
		assert.deepEqual(filterRows(rows, "smrt").map((r) => r.id), ["scout.smartopen.0002"]);
		assert.deepEqual(filterRows(rows, "row err").map((r) => r.id), ["worker.pf518.0001"]);
		assert.equal(filterRows(rows, "").length, 2);
		assert.equal(filterRows(rows, "nomatch").length, 0);
	});
});

describe("alignment and summaries", () => {
	it("pads columns to a common width and never pads the last column", () => {
		const lines = alignCells([["● a", "worker", "working", "bash: pytest 2m"], ["  ✓ longername", "scout", "done", "x"]]);
		assert.equal(lines[0]!.indexOf("worker"), lines[1]!.indexOf("scout"));
		assert.equal(lines[0]!.indexOf("working"), lines[1]!.indexOf("done"));
		assert.ok(!lines[1]!.endsWith(" "));
	});
	it("clips over-wide cells with an ellipsis", () => {
		const lines = alignCells([["x".repeat(50), "r", "s", "a"], ["y", "r", "s", "a"]], [10, 5, 5]);
		assert.match(lines[0]!, /^x{9}…/);
	});
	it("cleans a summary to one tidy sentence", () => {
		assert.equal(cleanSummary("Summary (base: `/Users/x/y`). More text here."), "Summary (base: /Users/x/y).");
		assert.equal(cleanSummary("a".repeat(100), 20).length, 20);
	});
});

describe("widget and lineage", () => {
	it("truncates with a pointer to /agents and aligns columns", () => {
		const rows = buildRows(Array.from({ length: 5 }, (_, i) => rec(`worker.w${i}.000${i}`, null, "idle")), opts);
		const lines = widgetLines(rows, 3);
		assert.equal(lines.length, 4);
		assert.match(lines[3]!, /2 more/);
	});
	it("describes lineage", () => {
		const kids = [rec("worker.a.0002", "main.root.0001", "working"), rec("worker.b.0003", "main.root.0001", "done")];
		assert.equal(lineageText(rec("main.root.0001", null, "idle"), undefined, kids), "2 agents (1 live)");
		assert.equal(lineageText(rec("worker.a.0002", "main.root.0001", "working"), "root", []), "child of root");
		assert.equal(lineageText(rec("main.root.0001", null, "idle"), undefined, []), undefined);
	});
});

describe("actionsFor", () => {
	const ids = (record: AgentRecord, self?: string) => actionsFor(record, self).map(([id]) => id);
	it("offers nothing but details on the viewer's own agent", () => {
		assert.deepEqual(ids(rec("main.root.0001", null, "idle", { role: "main" }), "main.root.0001"), ["details"]);
	});
	it("offers attach, message, interrupt, kill, details for a live interactable agent", () => {
		assert.deepEqual(ids(rec("worker.a.0002", "main.root.0001", "working"), "main.root.0001"), ["attach", "message", "interrupt", "kill", "details"]);
	});
	it("does not offer attach for a live non-interactable agent", () => {
		assert.deepEqual(ids(rec("scout.s.0003", "main.root.0001", "working", { interactable: false }), "main.root.0001"), ["message", "interrupt", "kill", "details"]);
	});
	it("offers resume (and attach, if interactable) for a dead resumable agent", () => {
		assert.deepEqual(ids(rec("worker.a.0002", "main.root.0001", "lost")), ["attach", "message", "resume", "details"]);
		assert.deepEqual(ids(rec("scout.s.0003", "main.root.0001", "done", { interactable: false })), ["message", "resume", "details"]);
		assert.equal(actionsFor(rec("worker.a.0002", "main.root.0001", "lost"), undefined)[0]![2], "resume it, then attach");
	});
	it("never offers resume for a dead root", () => {
		assert.deepEqual(ids(rec("main.old.0000", null, "stopped", { role: "main" })), ["message", "details"]);
	});
});
