import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentRecord, EffectiveStatus } from "../store/index.ts";
import { agentMessageText } from "../store/index.ts";
import { actionsFor, activityText, agentMessageView, alignCells, buildRows, claimLine, cleanSummary, filterRows, formatDuration, fuzzyScore, lineageText, TRIAGE_WINDOW_MS, triage, widgetLines } from "./model.ts";

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
	it("hides a dormant root with nothing unfinished, but shows it while a child is unfinished", () => {
		const dormant = { ...rec("main.a.0001", null, "dormant"), alive: false };
		assert.equal(dormant.status, "dormant");
		const finishedChild = rec("scout.b.0002", "main.a.0001", "done");
		assert.equal(buildRows([dormant, finishedChild], { ...opts, hideFinished: true }).length, 0);
		const rows = buildRows([dormant, rec("worker.c.0003", "main.a.0001", "working")], { ...opts, hideFinished: true });
		assert.deepEqual(rows.map((r) => r.id), ["main.a.0001", "worker.c.0003"]);
		assert.deepEqual(rows[0]!.cells.slice(1, 3), ["main", "dormant"]);
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

describe("triage", () => {
	const H = 3_600_000;
	const NOW = 100 * H;
	const o = { now: NOW, breadcrumb: (id: string) => id };
	const root = rec("main.root.0001", null, "idle", { role: "main" });
	const ids = (rows: { id: string }[]) => rows.map((r) => r.id);
	const stall = (id: string) => new Map([[id, { kind: "stall" as const, overMs: 1, detail: "" }]]);
	const kid = (id: string, status: EffectiveStatus, state: Partial<NonNullable<AgentRecord["state"]>> = {}, parent = "main.root.0001") => rec(id, parent, status, {}, state);

	it("never lists roots, but lists their children", () => {
		const t = triage([root, rec("main.old.0000", null, "stopped", { role: "main" }), kid("worker.a.0002", "working")], o);
		assert.deepEqual(ids(t.items), ["header:working", "worker.a.0002"]);
		// a main-role session nested under another agent is still the user's own
		const nested = rec("main.nested.0003", "main.root.0001", "dormant", { role: "main" });
		assert.deepEqual(ids(triage([root, nested, kid("worker.c.0004", "waiting-on-parent", {}, "main.nested.0003")], o).needs), ["worker.c.0004"]);
		assert.equal(triage([root, nested], o).items.length, 0);
	});

	describe("NEEDS YOU", () => {
		it("includes waiting-on-user", () => {
			assert.deepEqual(ids(triage([root, kid("worker.a.0002", "waiting-on-user")], o).needs), ["worker.a.0002"]);
		});
		it("waiting-on-parent needs the human only when the parent is a root, gone or not alive", () => {
			const mid = kid("worker.m.0002", "working");
			const underRoot = kid("worker.r.0003", "waiting-on-parent");
			const underLive = kid("worker.l.0004", "waiting-on-parent", {}, "worker.m.0002");
			const underDead = kid("worker.d.0005", "waiting-on-parent", {}, "worker.x.0006");
			const dead = { ...kid("worker.x.0006", "done"), alive: false };
			const underMissing = kid("worker.g.0007", "waiting-on-parent", {}, "worker.ghost.9999");
			const t = triage([root, mid, underRoot, underLive, underDead, dead, underMissing], o);
			assert.deepEqual(ids(t.needs).sort(), ["worker.d.0005", "worker.g.0007", "worker.r.0003"]);
			assert.deepEqual(ids(t.working), ["worker.m.0002"]);
			assert.deepEqual(ids(t.completed).sort(), ["worker.l.0004", "worker.x.0006"]); // answered by a live agent, not the human
		});
		it("a stalled working agent is NEEDS YOU, not WORKING", () => {
			const a = kid("worker.a.0002", "working", { activity: { lastEventAt: NOW - 5 * 60_000, lastSeenAt: NOW, inFlight: null } });
			const t = triage([root, a], { ...o, stalls: stall("worker.a.0002") });
			assert.deepEqual(ids(t.needs), ["worker.a.0002"]);
			assert.equal(t.working.length, 0);
			assert.equal(t.needs[0]!.cells[0], "! a");
			assert.equal(t.needs[0]!.cells[3], "stalled 5m");
			assert.equal(triage([root, a], o).working.length, 1); // without a report it is just working
		});
		it("a stalled idle (wedged) agent is NEEDS YOU too", () => {
			const a = kid("worker.a.0002", "idle");
			assert.deepEqual(ids(triage([root, a], { ...o, stalls: stall("worker.a.0002") }).needs), ["worker.a.0002"]);
		});
		it("error decays into COMPLETED after 24h", () => {
			const at = (hours: number) => kid("worker.a.0002", "error", { since: NOW - hours * H, summary: "boom. more" });
			const young = triage([root, at(23)], o);
			assert.deepEqual(ids(young.needs), ["worker.a.0002"]);
			assert.equal(young.needs[0]!.cells[3], "error 23h ago · boom.");
			const old = triage([root, at(25)], { ...o, completedMaxAgeMs: undefined });
			assert.equal(old.needs.length, 0);
			assert.deepEqual(ids(old.completed), ["worker.a.0002"]);
		});
		it("lost decays into COMPLETED after 24h, measured from its last heartbeat", () => {
			const at = (hours: number) => kid("worker.a.0002", "lost", { since: 0, activity: { lastEventAt: 0, lastSeenAt: NOW - hours * H, inFlight: null } });
			const lostStall = (id: string) => new Map([[id, { kind: "lost" as const, overMs: 1, detail: "" }]]);
			const young = triage([root, at(23)], { ...o, stalls: lostStall("worker.a.0002") });
			assert.deepEqual(ids(young.needs), ["worker.a.0002"]);
			assert.equal(young.needs[0]!.cells[3], "gone 23h");
			const old = triage([root, at(25)], { ...o, stalls: lostStall("worker.a.0002"), completedMaxAgeMs: TRIAGE_WINDOW_MS });
			assert.equal(old.needs.length, 0);
			assert.equal(old.completed.length, 0); // outside the default 24h window
			assert.deepEqual(ids(triage([root, at(25)], { ...o, stalls: lostStall("worker.a.0002"), completedMaxAgeMs: undefined }).completed), ["worker.a.0002"]);
		});
		it("orders longest waiting first: waiting by since, stalls by lastEventAt", () => {
			const act = (lastEventAt: number) => ({ activity: { lastEventAt, lastSeenAt: NOW, inFlight: null } });
			const recs = [
				root,
				kid("worker.w2.0002", "waiting-on-user", { since: NOW - 10 * 60_000 }),
				kid("worker.s1.0003", "working", act(NOW - 30 * 60_000)),
				kid("worker.w1.0004", "waiting-on-user", { since: NOW - 20 * 60_000 }),
				kid("worker.s2.0005", "working", act(NOW - 5 * 60_000)),
			];
			const stalls = new Map(["worker.s1.0003", "worker.s2.0005"].map((id) => [id, { kind: "stall" as const, overMs: 1, detail: "" }]));
			assert.deepEqual(ids(triage(recs, { ...o, stalls }).needs), ["worker.s1.0003", "worker.w1.0004", "worker.w2.0002", "worker.s2.0005"]);
		});
		it("labels the wait", () => {
			const t = triage([root, kid("worker.a.0002", "waiting-on-user", { since: NOW - 12 * 60_000, note: "which db?" })], o);
			assert.deepEqual(t.needs[0]!.cells.slice(1), ["worker", "needs you", "waiting 12m · which db?"]);
		});
	});

	describe("WORKING", () => {
		it("takes working and starting, longest-running first (runStartedAt, else since)", () => {
			const recs = [
				root,
				kid("worker.a.0002", "working", { since: NOW - 1 * H, runStartedAt: NOW - 10 * 60_000 }),
				kid("worker.b.0003", "working", { since: NOW - 30 * 60_000 }),
				kid("worker.c.0004", "starting", { since: NOW - 5_000 }),
				kid("worker.d.0005", "working", { since: NOW, runStartedAt: NOW - 2 * H }),
			];
			assert.deepEqual(ids(triage(recs, o).working), ["worker.d.0005", "worker.b.0003", "worker.a.0002", "worker.c.0004"]);
		});
	});

	describe("COMPLETED", () => {
		const finished = [
			kid("worker.a.0002", "done", { since: NOW - 3 * 60_000, summary: "All good. Extra." }),
			kid("scout.b.0003", "stopped", { since: NOW - 2 * H }),
			kid("scout.c.0004", "timed-out", { since: NOW - 26 * H }),
			kid("worker.d.0005", "idle", { since: NOW - 23 * H }),
		];
		it("lists the last 24h by default, most recent first; show-all adds the rest", () => {
			const t = triage([root, ...finished], { ...o, completedMaxAgeMs: TRIAGE_WINDOW_MS });
			assert.deepEqual(ids(t.completed), ["worker.a.0002", "scout.b.0003", "worker.d.0005"]);
			assert.deepEqual(ids(triage([root, ...finished], o).completed), ["worker.a.0002", "scout.b.0003", "worker.d.0005", "scout.c.0004"]);
		});
		it("never ages out an agent that still has a process (idle, attachable done)", () => {
			const idle = kid("worker.a.0002", "idle", { since: NOW - 30 * H });
			const attachable = { ...kid("worker.b.0003", "done", { since: NOW - 30 * H }), alive: true };
			assert.deepEqual(ids(triage([root, idle, attachable], { ...o, completedMaxAgeMs: TRIAGE_WINDOW_MS }).completed).sort(), ["worker.a.0002", "worker.b.0003"]);
		});
		it("a decayed lost agent keeps the muted look, not the stall glyph", () => {
			const lost = kid("worker.a.0002", "lost", { since: 0, activity: { lastEventAt: 0, lastSeenAt: NOW - 30 * H, inFlight: null } });
			const t = triage([root, lost], { ...o, stalls: new Map([["worker.a.0002", { kind: "lost" as const, overMs: 1, detail: "" }]]) });
			assert.equal(t.completed[0]!.cells[0], "∅ a");
			assert.equal(t.completed[0]!.tone, "muted");
		});
		it("labels the completion age and summary", () => {
			assert.deepEqual(triage([root, finished[0]!], o).completed[0]!.cells.slice(1), ["worker", "done", "done 3m ago · All good."]);
		});
		it("keeps a done-but-alive (attachable) agent, and idle or dormant non-roots", () => {
			const attachable = { ...kid("worker.a.0002", "done", { since: NOW - 60_000 }), alive: true };
			const dormant = { ...kid("worker.b.0003", "dormant", { since: NOW - 60_000 }), alive: false };
			assert.deepEqual(ids(triage([root, attachable, dormant], o).completed).sort(), ["worker.a.0002", "worker.b.0003"]);
		});
		it("a record with no readable state is completed, only visible under show-all", () => {
			const broken = { ...kid("worker.a.0002", "lost"), state: undefined };
			assert.equal(triage([root, broken], { ...o, completedMaxAgeMs: TRIAGE_WINDOW_MS }).items.length, 0);
			assert.deepEqual(ids(triage([root, broken], o).completed), ["worker.a.0002"]);
		});
	});

	it("flattens with a header per non-empty group, counts and no empty groups", () => {
		const recs = [root, kid("worker.a.0002", "waiting-on-user"), kid("worker.b.0003", "done", { since: NOW - 1000 }), kid("worker.c.0004", "done", { since: NOW - 2000 })];
		const { items } = triage(recs, o);
		assert.deepEqual(ids(items), ["header:needs", "worker.a.0002", "header:completed", "worker.b.0003", "worker.c.0004"]);
		assert.deepEqual(items.filter((r) => r.header).map((r) => r.cells), [["NEEDS YOU (1)"], ["COMPLETED (2)"]]);
		assert.ok(items.filter((r) => r.header).every((r) => r.searchText === ""));
	});

	it("scopes to a subtree and shows the parent's name as the suffix", () => {
		const mid = kid("worker.m.0002", "working");
		const leaf = kid("scout.l.0003", "working", {}, "worker.m.0002");
		const other = kid("worker.o.0004", "working");
		const t = triage([root, mid, leaf, other], { ...o, subtreeOf: "worker.m.0002" });
		assert.deepEqual(ids(t.working), ["worker.m.0002", "scout.l.0003"]);
		assert.deepEqual(t.working.map((r) => r.suffix), ["root", "m"]);
	});

	it("disambiguates duplicate names across groups", () => {
		const twin = kid("worker.y.0003", "done", { since: NOW - 1000 });
		const t = triage([root, kid("worker.x.0002", "working"), { ...twin, input: { ...twin.input, name: "x" } }], o);
		assert.deepEqual(t.items.filter((r) => !r.header).map((r) => r.name), ["x·0002", "x·0003"]);
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
		assert.deepEqual(ids(rec("worker.a.0002", "main.root.0001", "working"), "main.root.0001"), ["attach", "message", "done", "interrupt", "kill", "details"]);
	});
	it("does not offer attach for a live non-interactable agent", () => {
		assert.deepEqual(ids(rec("scout.s.0003", "main.root.0001", "working", { interactable: false }), "main.root.0001"), ["message", "done", "interrupt", "kill", "details"]);
	});
	it("offers resume (and attach, if interactable) for a dead resumable agent", () => {
		assert.deepEqual(ids(rec("worker.a.0002", "main.root.0001", "lost")), ["attach", "message", "done", "resume", "details"]);
		assert.deepEqual(ids(rec("scout.s.0003", "main.root.0001", "done", { interactable: false })), ["message", "resume", "details"]);
		assert.equal(actionsFor(rec("worker.a.0002", "main.root.0001", "lost"), undefined)[0]![2], "resume it, then attach");
	});
	it("offers Mark done only where /agent-done does something", () => {
		assert.ok(!ids(rec("worker.a.0002", "main.root.0001", "done", { interactable: false })).includes("done"));
		assert.ok(!ids(rec("worker.a.0002", "main.root.0001", "stopped")).includes("done"));
		assert.ok(ids(rec("worker.a.0002", "main.root.0001", "idle")).includes("done"));
	});
	it("never offers resume for a dead root", () => {
		assert.deepEqual(ids(rec("main.old.0000", null, "stopped", { role: "main" })), ["message", "details"]);
	});
});

describe("transcript markers", () => {
	it("renders claim entries as one line and ignores foreign or malformed ones", () => {
		const spawned = claimLine("agents.spawn", { id: "scout.a.0001", name: "a", role: "scout", objective: `find\nthings ${"x".repeat(200)}` })!;
		assert.match(spawned, /^▸ spawned a \(scout\) · find things x+…$/);
		assert.equal([...spawned.split(" · ")[1]!].length, 80);
		assert.equal(claimLine("agents.result", { id: "scout.a.0001", status: "done", summary: "all good" }), "◂ scout.a.0001 done · all good");
		assert.equal(claimLine("agents.result", {}), undefined);
		assert.equal(claimLine("other", { id: "x" }), undefined);
	});
	it("shows the sender from details and collapses long bodies", () => {
		const text = agentMessageText({ from: "worker.a.0001", kind: "question", id: "m1", body: Array.from({ length: 10 }, (_, i) => `line ${i}`).join("\n") });
		const collapsed = agentMessageView(text, { from: "worker.a.0001", kind: "question" }, false);
		assert.equal(collapsed.header, "[from worker.a.0001 · question]");
		assert.equal(collapsed.body.length, 6);
		assert.equal(collapsed.hidden, 4);
		assert.equal(collapsed.body[0], "line 0");
		assert.deepEqual(agentMessageView(text, undefined, true).hidden, 0);
		assert.deepEqual(agentMessageView("plain", undefined, false).body, ["plain"]);
	});
});
