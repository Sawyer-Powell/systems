import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { beforeEach, describe, it } from "node:test";
import { mkInput, useTempStore } from "../test-support.ts";
import { ActivityTracker, summarize } from "./activity.ts";
import { InboxPump } from "./inbox.ts";
import { agentStartPatch, resumedFromWaiting } from "./index.ts";

const ID = "worker.a.0001";
const tmp = useTempStore("agents-runtime-");
beforeEach(() => tmp.store.create(mkInput(ID, null, { createdAt: 0 })));

describe("summarize", () => {
	it("records the executable or file basename only, never arguments or patterns", () => {
		assert.equal(summarize("bash", { command: "/usr/bin/pytest -q --secret=abc\nfoo" }), "bash: pytest");
		assert.equal(summarize("read", { path: "/data/patients/jane-doe.csv" }), "read: jane-doe.csv");
		assert.equal(summarize("grep", { pattern: "ssn 123" }), "grep");
		assert.equal(summarize("custom", { x: 1 }), "custom");
	});
});

describe("ActivityTracker", () => {
	it("tracks tool in-flight with a declared deadline and clears it", () => {
		let t = 1_000;
		const tracker = new ActivityTracker({ store: tmp.store, id: ID, now: () => t });
		tracker.declareDeadline("c1", 61_000);
		tracker.toolStart("c1", "bash", { command: "pytest" });
		let inFlight = tmp.store.readState(ID)?.activity.inFlight;
		assert.equal(inFlight?.name, "bash");
		assert.equal(inFlight?.deadline, 61_000);
		t = 5_000;
		tracker.toolEnd("c1");
		inFlight = tmp.store.readState(ID)?.activity.inFlight;
		assert.equal(inFlight, null);
		assert.equal(tmp.store.readState(ID)?.activity.lastEventAt, 5_000);
	});
	it("gives a model request a first-token deadline only for xhigh/max thinking", () => {
		for (const [thinking, expected] of [["xhigh", 1000 + 600_000], ["max", 1000 + 600_000], ["high", undefined], ["low", undefined], [undefined, undefined]] as const) {
			const tracker = new ActivityTracker({ store: tmp.store, id: ID, now: () => 1000 });
			tracker.modelStart(thinking);
			assert.equal(tmp.store.readState(ID)?.activity.inFlight?.deadline, expected, String(thinking));
		}
	});
	it("clears the first-token deadline on the first stream event and flushes it at once", () => {
		let t = 1000;
		const tracker = new ActivityTracker({ store: tmp.store, id: ID, now: () => t });
		tracker.modelStart("xhigh");
		t = 1100;
		tracker.touch(); // within the throttle window: not flushed
		t = 1200;
		tracker.streamStart();
		const activity = tmp.store.readState(ID)?.activity;
		assert.equal(activity?.inFlight?.deadline, undefined);
		assert.equal(activity?.inFlight?.kind, "model");
		assert.equal(activity?.lastEventAt, 1200);
		t = 1300;
		tracker.streamStart(); // later stream events do nothing more
		assert.equal(tmp.store.readState(ID)?.activity.lastEventAt, 1200);
		tracker.modelEnd();
		tracker.modelStart("xhigh"); // the next request gets its own deadline
		assert.equal(tmp.store.readState(ID)?.activity.inFlight?.deadline, 1300 + 600_000);
	});
	it("prefers the longest-running tool over the model request", () => {
		let t = 0;
		const tracker = new ActivityTracker({ store: tmp.store, id: ID, now: () => t });
		tracker.modelStart();
		t = 10;
		tracker.toolStart("a", "read", {});
		t = 20;
		tracker.toolStart("b", "bash", {});
		assert.equal(tracker.current()?.name, "read");
		tracker.toolEnd("a");
		tracker.toolEnd("b");
		assert.equal(tracker.current()?.kind, "model");
	});
	it("throttles touch writes but heartbeat always writes lastSeenAt", () => {
		let t = 10_000;
		const tracker = new ActivityTracker({ store: tmp.store, id: ID, now: () => t });
		tracker.touch();
		const first = tmp.store.readState(ID)?.activity.lastEventAt;
		t = 10_200;
		tracker.touch();
		assert.equal(tmp.store.readState(ID)?.activity.lastEventAt, first); // throttled
		t = 10_300;
		tracker.heartbeat();
		assert.equal(tmp.store.readState(ID)?.activity.lastSeenAt, 10_300);
		assert.equal(tmp.store.readState(ID)?.activity.lastEventAt, 10_200); // heartbeat flushes the pending value
	});
});

describe("InboxPump", () => {
	it("delivers in order once, advancing the cursor, even across restarts", async () => {
		tmp.store.send({ from: "user", to: ID, kind: "instruction", body: "1", deliver: "context", ts: 1000 });
		tmp.store.send({ from: "user", to: ID, kind: "instruction", body: "2", deliver: "context", ts: 2000 });
		const seen: string[] = [];
		const pump = new InboxPump({ store: tmp.store, id: ID, deliver: (m) => void seen.push(m.body) });
		await pump.pump();
		await pump.pump();
		assert.deepEqual(seen, ["1", "2"]);

		tmp.store.send({ from: "user", to: ID, kind: "instruction", body: "3", deliver: "context", ts: 3000 });
		const again: string[] = [];
		const restarted = new InboxPump({ store: tmp.store, id: ID, deliver: (m) => void again.push(m.body) });
		await restarted.pump();
		assert.deepEqual(again, ["3"]);
	});
	it("advances the cursor before a control message is delivered", async () => {
		const m = tmp.store.send({ from: "user", to: ID, kind: "control", control: "stop", body: "stop", deliver: "context", ts: 1000 });
		let cursorDuringDelivery: string | undefined;
		const pump = new InboxPump({ store: tmp.store, id: ID, deliver: () => void (cursorDuringDelivery = tmp.store.readState(ID)?.lastDelivered) });
		await pump.pump();
		assert.equal(cursorDuringDelivery, m.id);
	});
	it("never rejects when state cannot be written", async () => {
		tmp.store.send({ from: "user", to: ID, kind: "instruction", body: "x", deliver: "context", ts: 1000 });
		const pump = new InboxPump({ store: tmp.store, id: ID, deliver: () => fs.rmSync(path.join(tmp.home, ID), { recursive: true, force: true }) });
		await assert.doesNotReject(pump.pump());
	});
	it("keeps going (and advances) when one delivery throws", async () => {
		tmp.store.send({ from: "user", to: ID, kind: "instruction", body: "bad", deliver: "context", ts: 1000 });
		tmp.store.send({ from: "user", to: ID, kind: "instruction", body: "good", deliver: "context", ts: 2000 });
		const seen: string[] = [];
		const pump = new InboxPump({
			store: tmp.store,
			id: ID,
			deliver: (m) => {
				if (m.body === "bad") throw new Error("boom");
				seen.push(m.body);
			},
		});
		await pump.pump();
		assert.deepEqual(seen, ["good"]);
	});
	it("picks up messages that arrive while running", async () => {
		tmp.store.send({ from: "user", to: ID, kind: "instruction", body: "1", deliver: "context", ts: 1000 });
		const seen: string[] = [];
		const pump = new InboxPump({
			store: tmp.store,
			id: ID,
			deliver: async (m) => {
				seen.push(m.body);
				if (m.body === "1") {
					tmp.store.send({ from: "user", to: ID, kind: "instruction", body: "2", deliver: "context", ts: 2000 });
					await pump.pump(); // re-entrant call must coalesce
				}
			},
		});
		await pump.pump();
		assert.deepEqual(seen, ["1", "2"]);
	});
	it("start() reacts to a new file via the watcher or poll", async () => {
		const seen: string[] = [];
		const pump = new InboxPump({ store: tmp.store, id: ID, pollMs: 50, deliver: (m) => void seen.push(m.body) });
		pump.start();
		tmp.store.send({ from: "user", to: ID, kind: "instruction", body: "late", deliver: "context" });
		for (let i = 0; i < 40 && seen.length === 0; i++) await new Promise((r) => setTimeout(r, 25));
		pump.stop();
		assert.deepEqual(seen, ["late"]);
	});
});

describe("dormant root mailbox", () => {
	it("accumulates messages while dormant and delivers exactly the pending ones once the session is resumed", async () => {
		const first = tmp.store.send({ from: "user", to: ID, kind: "instruction", body: "before", deliver: "context", ts: 1000 });
		const loaded = new InboxPump({ store: tmp.store, id: ID, deliver: () => {} });
		await loaded.pump(); // session loaded: cursor advances
		assert.equal(tmp.store.readState(ID)?.lastDelivered, first.id);
		tmp.store.writeState(ID, { status: "idle" }); // unloaded root is available; residency is separate
		tmp.store.send({ from: "user", to: ID, kind: "instruction", body: "while dormant 1", deliver: "context", ts: 2000 });
		tmp.store.send({ from: "user", to: ID, kind: "instruction", body: "while dormant 2", deliver: "context", ts: 3000 });
		assert.equal(tmp.store.record(ID)?.status, "idle");
		tmp.store.writeState(ID, { status: "idle" }); // session_start on resume
		const seen: string[] = [];
		await new InboxPump({ store: tmp.store, id: ID, deliver: (m) => void seen.push(m.body) }).pump();
		assert.deepEqual(seen, ["while dormant 1", "while dormant 2"]);
	});
});

describe("resumedFromWaiting", () => {
	it("a non-ask tool starting while waiting means the agent is working again", () => {
		for (const status of ["waiting-on-parent"] as const) {
			assert.equal(resumedFromWaiting("bash", status), true);
			assert.equal(resumedFromWaiting("read", status), true);
		}
	});
	it("the ask tools themselves never resume", () => {
		for (const status of ["needs-you", "waiting-on-parent"] as const) {
			assert.equal(resumedFromWaiting("yield", status), false);
			assert.equal(resumedFromWaiting("ask_parent", status), false);
		}
	});
	it("other statuses are untouched", () => {
		for (const status of ["working", "idle", "needs-you", "blocked", "archived", undefined] as const) {
			assert.equal(resumedFromWaiting("bash", status), false);
			assert.equal(resumedFromWaiting("yield", status), false);
		}
	});
});

describe("agent_start patch", () => {
	it("clears the previous summary and status note", () => {
		tmp.store.writeState(ID, { status: "idle", summary: "old", note: "tests green" });
		tmp.store.writeState(ID, { status: "working", ...agentStartPatch() });
		const state = tmp.store.readState(ID);
		assert.equal(state?.note, undefined);
		assert.equal(state?.summary, undefined);
		assert.equal(state?.status, "working");
	});
});
