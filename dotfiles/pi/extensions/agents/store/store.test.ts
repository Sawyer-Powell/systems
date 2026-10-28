import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { beforeEach, describe, it } from "node:test";
import { mkInput, useTempStore } from "../test-support.ts";
import { type AgentInput, newId, type StallReport, stallOf } from "./index.ts";

const tmp = useTempStore("agents-store-");

describe("ids", () => {
	it("makes directory-safe ids", () => {
		const id = newId("Worker!", "PF-518 row errors/../x");
		assert.match(id, /^[a-z0-9][a-z0-9._-]*$/);
		assert.ok(!id.includes(".."));
	});
	it("rejects path traversal", () => {
		assert.throws(() => tmp.store.dir("../etc"));
		assert.throws(() => tmp.store.dir("a/b"));
	});
});

describe("create and state", () => {
	it("creates exclusively and seeds starting state", () => {
		tmp.store.create(mkInput("main.a.0001", null));
		assert.equal(tmp.store.readState("main.a.0001")?.status, "starting");
		assert.throws(() => tmp.store.create(mkInput("main.a.0001", null)));
	});
	it("merges state, nests activity, stamps since only on status change", async () => {
		tmp.store.create(mkInput("main.a.0001", null));
		const first = tmp.store.writeState("main.a.0001", { status: "working" });
		await new Promise((r) => setTimeout(r, 5));
		const second = tmp.store.writeState("main.a.0001", { activity: { lastEventAt: 5 } });
		assert.equal(second.since, first.since);
		assert.equal(second.status, "working");
		assert.equal(second.activity.lastEventAt, 5);
		assert.equal(second.activity.inFlight, null);
	});
});

describe("tree", () => {
	beforeEach(() => {
		tmp.store.create(mkInput("main.root.0001", null));
		tmp.store.create(mkInput("worker.a.0002", "main.root.0001"));
		tmp.store.create(mkInput("worker.b.0003", "worker.a.0002"));
		tmp.store.create(mkInput("worker.c.0004", "main.root.0001"));
	});
	it("walks ancestors, children, descendants", () => {
		assert.deepEqual(tmp.store.ancestors("worker.b.0003").map((r) => r.input.id), ["worker.a.0002", "main.root.0001"]);
		assert.deepEqual(tmp.store.children("main.root.0001").map((r) => r.input.id).sort(), ["worker.a.0002", "worker.c.0004"]);
		assert.deepEqual(tmp.store.descendants("main.root.0001").map((r) => r.input.id).sort(), ["worker.a.0002", "worker.b.0003", "worker.c.0004"]);
	});
	it("builds a breadcrumb", () => {
		assert.equal(tmp.store.breadcrumb("worker.b.0003"), "main.root.0001 › worker.a.0002 › worker.b.0003");
	});
	it("survives a parent cycle", () => {
		fs.writeFileSync(path.join(tmp.home, "worker.a.0002", "input.json"), JSON.stringify(mkInput("worker.a.0002", "worker.b.0003")));
		assert.ok(tmp.store.ancestors("worker.b.0003").length <= 4);
	});
});

describe("liveness", () => {
	it("is alive while the owner lives and lost after, unless terminal", () => {
		tmp.store.create(mkInput("main.a.0001", null));
		assert.equal(tmp.store.isAlive("main.a.0001"), false);
		tmp.store.acquireLock("main.a.0001");
		tmp.store.writeState("main.a.0001", { status: "working" });
		assert.equal(tmp.store.isAlive("main.a.0001"), true);
		assert.equal(tmp.store.record("main.a.0001")?.status, "working");
		tmp.store.releaseLock("main.a.0001");
		assert.equal(tmp.store.record("main.a.0001")?.status, "lost");
		tmp.store.writeState("main.a.0001", { status: "done" });
		assert.equal(tmp.store.record("main.a.0001")?.status, "done");
	});
	it("a dormant root with no process stays dormant, never lost, and is never reported as stalled", () => {
		tmp.store.create(mkInput("main.a.0001", null));
		tmp.store.writeState("main.a.0001", { status: "dormant", activity: { lastEventAt: 0, lastSeenAt: 0 } });
		const record = tmp.store.record("main.a.0001")!;
		assert.equal(record.status, "dormant");
		assert.equal(stallOf(record, Date.now() + 3_600_000), undefined);
	});
	it("refuses a second live owner, takes over a dead one", () => {
		tmp.store.create(mkInput("main.a.0001", null));
		tmp.store.acquireLock("main.a.0001", process.ppid); // another live process
		assert.throws(() => tmp.store.acquireLock("main.a.0001"));
		tmp.store.releaseLock("main.a.0001", process.ppid);
		fs.writeFileSync(path.join(tmp.home, "main.a.0001", "lock"), JSON.stringify({ pid: 999999, startedAt: "x" }));
		tmp.store.acquireLock("main.a.0001");
		assert.equal(tmp.store.lockPid("main.a.0001"), process.pid);
	});
	it("treats a recycled pid (different start time) as dead", () => {
		tmp.store.create(mkInput("main.a.0001", null));
		fs.writeFileSync(path.join(tmp.home, "main.a.0001", "lock"), JSON.stringify({ pid: process.pid, startedAt: "Thu Jan  1 00:00:00 1970" }));
		assert.equal(tmp.store.isAlive("main.a.0001"), false);
	});
});

describe("starting grace and lock races", () => {
	it("a freshly created agent is starting, not lost, until the grace expires", () => {
		tmp.store.create(mkInput("worker.a.0001", null));
		assert.equal(tmp.store.record("worker.a.0001")?.status, "starting");
		assert.equal(tmp.store.record("worker.a.0001")?.status, "starting");
		fs.writeFileSync(path.join(tmp.home, "worker.a.0001", "state.json"), JSON.stringify({ ...tmp.store.readState("worker.a.0001"), since: Date.now() - 60_000 }));
		assert.equal(tmp.store.record("worker.a.0001")?.status, "lost");
	});
	it("acquireLock fails if its fresh file is replaced by another owner", () => {
		tmp.store.create(mkInput("worker.a.0001", null));
		// simulate a racer that already took the lock with a live pid
		fs.writeFileSync(path.join(tmp.home, "worker.a.0001", "lock"), JSON.stringify({ pid: process.ppid, startedAt: "" }));
		assert.throws(() => tmp.store.acquireLock("worker.a.0001"), /already running|claimed/);
	});
});

describe("messaging", () => {
	beforeEach(() => {
		tmp.store.create(mkInput("main.root.0001", null));
		tmp.store.create(mkInput("worker.a.0002", "main.root.0001"));
		tmp.store.create(mkInput("worker.b.0003", "worker.a.0002"));
		tmp.store.create(mkInput("worker.c.0004", "main.root.0001"));
	});
	it("allows parent, ancestors, descendants and user; blocks siblings and self", () => {
		assert.ok(tmp.store.canMessage("worker.a.0002", "main.root.0001"));
		assert.ok(tmp.store.canMessage("worker.b.0003", "main.root.0001")); // ancestor
		assert.ok(tmp.store.canMessage("main.root.0001", "worker.b.0003")); // descendant
		assert.ok(tmp.store.canMessage("user", "worker.c.0004"));
		assert.ok(tmp.store.canMessage("user:review", "worker.c.0004"));
		assert.ok(!tmp.store.canMessage("worker.a.0002", "worker.c.0004")); // sibling
		assert.ok(!tmp.store.canMessage("worker.b.0003", "worker.c.0004")); // cousin
		assert.ok(!tmp.store.canMessage("worker.a.0002", "worker.a.0002"));
		assert.ok(!tmp.store.canMessage("worker.a.0002", "ghost.x.0000"));
	});
	it("throws when sending is not permitted", () => {
		assert.throws(() => tmp.store.send({ from: "worker.a.0002", to: "worker.c.0004", kind: "info", body: "hi", deliver: "context" }));
	});
	it("delivers in order and honours the cursor", () => {
		const a = tmp.store.send({ from: "user", to: "worker.a.0002", kind: "instruction", body: "1", deliver: "context", ts: 1000 });
		const b = tmp.store.send({ from: "user", to: "worker.a.0002", kind: "instruction", body: "2", deliver: "context", ts: 2000 });
		assert.deepEqual(tmp.store.readInbox("worker.a.0002").map((m) => m.body), ["1", "2"]);
		assert.deepEqual(tmp.store.readInbox("worker.a.0002", a.id).map((m) => m.body), ["2"]);
		assert.deepEqual(tmp.store.readInbox("worker.a.0002", b.id), []);
	});
	it("ignores partial temp files", () => {
		fs.writeFileSync(path.join(tmp.home, "worker.a.0002", "inbox", "0000000000001-x.json.1.tmp"), "{");
		assert.deepEqual(tmp.store.readInbox("worker.a.0002"), []);
	});
});

describe("stallOf", () => {
	const t0 = 1_000_000;
	const stall = (id: string, now?: number): StallReport | undefined => stallOf(tmp.store.record(id)!, now);
	function start(id: string, extra: Partial<AgentInput> = {}) {
		tmp.store.create(mkInput(id, null, { createdAt: t0, ...extra }));
		tmp.store.acquireLock(id);
	}
	it("is quiet when idle, waiting, or terminal", () => {
		start("main.a.0001");
		tmp.store.writeState("main.a.0001", { status: "idle", activity: { lastEventAt: t0, lastSeenAt: t0 + 3_600_000 - 1 } });
		assert.equal(stall("main.a.0001", t0 + 3_600_000), undefined);
		tmp.store.writeState("main.a.0001", { status: "waiting-on-user", activity: { lastSeenAt: t0 + 3_600_000 } });
		assert.equal(stall("main.a.0001", t0 + 3_600_000), undefined);
	});
	it("flags a stall after the step timeout without events", () => {
		start("main.a.0001");
		tmp.store.writeState("main.a.0001", { status: "working", activity: { lastEventAt: t0, lastSeenAt: t0 + 170_000 } });
		assert.equal(stall("main.a.0001", t0 + 170_000), undefined);
		const report = stall("main.a.0001", t0 + 181_000);
		assert.equal(report?.kind, "stall");
	});
	it("uses the declared deadline instead of the step timeout, and reports overrun", () => {
		start("main.a.0001");
		tmp.store.writeState("main.a.0001", {
			status: "working",
			activity: {
				lastEventAt: t0,
				lastSeenAt: t0 + 590_000,
				inFlight: { kind: "tool", name: "bash", summary: "pytest", startedAt: t0, deadline: t0 + 600_000 },
			},
		});
		assert.equal(stall("main.a.0001", t0 + 590_000), undefined); // quiet but within deadline
		tmp.store.writeState("main.a.0001", { activity: { lastSeenAt: t0 + 606_000 } });
		assert.equal(stall("main.a.0001", t0 + 604_000), undefined); // within the kill grace
		assert.equal(stall("main.a.0001", t0 + 606_000)?.kind, "overrun");
	});
	describe("model requests", () => {
		const model = (deadline?: number) => ({ kind: "model" as const, name: "request", summary: "model request", startedAt: t0, ...(deadline !== undefined ? { deadline } : {}) });
		const working = (inFlight: ReturnType<typeof model>, lastEventAt: number, lastSeenAt: number) => {
			start("main.a.0001");
			tmp.store.writeState("main.a.0001", { status: "working", activity: { lastEventAt, lastSeenAt, inFlight } });
		};
		it("a request that has produced events stalls after 120 s without provider events", () => {
			working(model(), t0 + 1_000, t0 + 125_000);
			assert.equal(stall("main.a.0001", t0 + 120_000), undefined);
			assert.equal(stall("main.a.0001", t0 + 122_000)?.kind, "stall");
		});
		it("provider events keep a model request alive past 120 s", () => {
			working(model(), t0 + 200_000, t0 + 320_000);
			assert.equal(stall("main.a.0001", t0 + 320_000), undefined); // 120 s since the last event, request 320 s old
			assert.equal(stall("main.a.0001", t0 + 322_000)?.kind, "stall");
		});
		it("a request still waiting for its first event gets 10 min, and the detail separates age from silence", () => {
			working(model(), t0, t0 + 599_000);
			assert.equal(stall("main.a.0001", t0 + 599_000), undefined);
			const report = stall("main.a.0001", t0 + 601_000);
			assert.equal(report?.kind, "stall");
			assert.match(report!.detail, /in flight 601s, no events for the last 601s/);
		});
		it("never exceeds a step timeout shorter than the silence limit", () => {
			start("main.a.0001", { stepTimeoutMs: 10_000 });
			tmp.store.writeState("main.a.0001", { status: "working", activity: { lastEventAt: t0, lastSeenAt: t0 + 15_000, inFlight: model() } });
			assert.equal(stall("main.a.0001", t0 + 11_000)?.kind, "stall");
		});
		it("a silent tool still gets the full step timeout", () => {
			start("main.a.0001");
			tmp.store.writeState("main.a.0001", { status: "working", activity: { lastEventAt: t0, lastSeenAt: t0 + 60_000, inFlight: { kind: "tool", name: "bash", summary: "bash: x", startedAt: t0 } } });
			assert.equal(stall("main.a.0001", t0 + 60_000), undefined);
		});
		it("with a first-token deadline it does not stall before the deadline", () => {
			working(model(t0 + 600_000), t0, t0 + 590_000);
			assert.equal(stall("main.a.0001", t0 + 590_000), undefined);
		});
		it("once streaming started (deadline cleared) a silent stream stalls after 120 s", () => {
			working(model(), t0 + 5_000, t0 + 125_000);
			assert.equal(stall("main.a.0001", t0 + 124_000), undefined); // 119 s of silence
			assert.equal(stall("main.a.0001", t0 + 126_000)?.kind, "stall");
		});
	});
	it("flags wedged (heartbeat stopped, process alive)", () => {
		start("main.a.0001");
		tmp.store.writeState("main.a.0001", { status: "working", activity: { lastEventAt: t0, lastSeenAt: t0 } });
		assert.equal(stall("main.a.0001", t0 + 61_000)?.kind, "wedged");
	});
	it("does not report a just-created agent (starting, within grace, no lock yet) as lost", () => {
		tmp.store.create(mkInput("worker.a.0001", null));
		assert.equal(tmp.store.record("worker.a.0001")?.alive, false);
		assert.equal(stall("worker.a.0001"), undefined);
	});
	it("flags lost when the process is gone", () => {
		tmp.store.create(mkInput("main.a.0001", null));
		tmp.store.writeState("main.a.0001", { status: "working" });
		assert.equal(stall("main.a.0001")?.kind, "lost");
	});
	it("flags a whole-run overrun for non-interactable agents", () => {
		start("scout.a.0001", { interactable: false, runTimeoutMs: 300_000 });
		tmp.store.writeState("scout.a.0001", { status: "working", runStartedAt: t0, activity: { lastEventAt: t0 + 299_000, lastSeenAt: t0 + 301_000 } });
		assert.equal(stall("scout.a.0001", t0 + 301_000)?.kind, "run-overrun");
	});
	it("counts the whole-run limit from the current run, not from creation (resume)", () => {
		start("scout.a.0001", { interactable: false, runTimeoutMs: 300_000 });
		// created long ago, but this run started just now
		tmp.store.writeState("scout.a.0001", { status: "working", runStartedAt: t0 + 3_000_000, activity: { lastEventAt: t0 + 3_000_000, lastSeenAt: t0 + 3_001_000 } });
		assert.equal(stall("scout.a.0001", t0 + 3_001_000), undefined);
	});
});
