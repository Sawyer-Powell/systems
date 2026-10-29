import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { mkInput, useTempStore } from "../test-support.ts";
import { claimsFromBranch, ORIENTATION_MAX_LINES, orientation, RESULT_ENTRY, resultClaim, SPAWN_ENTRY, spawnClaim } from "./index.ts";

const tmp = useTempStore("agents-orientation-");
const ME = "main.me.0001";
const now = 10_000_000;
const claimsFor = (...ids: string[]) => claimsFromBranch(ids.map((id) => ({ type: "custom", customType: SPAWN_ENTRY, data: spawnClaim(mkInput(id, ME), 1) })));
const live = (id: string, state: Parameters<typeof tmp.store.writeState>[1] = {}) => {
	tmp.store.acquireLock(id);
	tmp.store.writeState(id, { status: "working", activity: { lastEventAt: now, lastSeenAt: now }, ...state });
};

beforeEach(() => tmp.store.create(mkInput(ME, null, { role: "main" })));

describe("orientation", () => {
	it("says nothing when there is nothing to say", () => {
		assert.equal(orientation(tmp.store, ME, now, new Map()), undefined);
		tmp.store.create(mkInput("scout.old.0002", ME));
		tmp.store.writeState("scout.old.0002", { status: "archived", summary: "long ago" });
		tmp.store.writeState("scout.old.0002", { since: now - 3_600_000 }); // finished an hour ago
		assert.equal(orientation(tmp.store, ME, now, claimsFor("scout.old.0002")), undefined);
		assert.equal(orientation(tmp.store, "ghost.x.0000", now, new Map()), undefined);
	});
	it("puts obligations first, with the question the child waits on", () => {
		tmp.store.create(mkInput("worker.ask.0003", ME));
		tmp.store.create(mkInput("worker.live.0002", ME, { objective: "build the thing" }));
		live("worker.live.0002", { note: "tests running" });
		const question = tmp.store.send({ from: "worker.ask.0003", to: ME, kind: "question", body: "which\ndatabase?", deliver: "context" });
		live("worker.ask.0003", { status: "waiting-on-parent", waitingOn: { messageId: question.id } });
		const text = orientation(tmp.store, ME, now, claimsFor("worker.live.0002", "worker.ask.0003"))!;
		const lines = text.split("\n");
		assert.equal(lines[2], '! worker.ask.0003 worker is waiting on you: "which database?"');
		assert.equal(lines[3], "- worker.live.0002 worker working · tests running · build the thing");
	});
	it("flags stalled and lost children and tags children not claimed on this branch", () => {
		tmp.store.create(mkInput("worker.lost.0002", ME));
		tmp.store.writeState("worker.lost.0002", { status: "working", since: 0 });
		tmp.store.create(mkInput("worker.wedged.0003", ME));
		live("worker.wedged.0003", { activity: { lastEventAt: 0, lastSeenAt: 0 } });
		const lines = orientation(tmp.store, ME, now, claimsFor("worker.lost.0002"))!.split("\n").slice(2);
		assert.deepEqual(lines, ["! worker.lost.0002 worker blocked · Execution unavailable", "! worker.wedged.0003 worker wedged [other branch]"]);
	});
	it("lists recently finished children with a 60-char summary, and claims whose record is gone", () => {
		tmp.store.create(mkInput("scout.fin.0002", ME));
		tmp.store.writeState("scout.fin.0002", { status: "idle", summary: `found\n${"x".repeat(100)}`, handoff: { to: "parent", recipient: ME, messageId: "handoff-1", at: now - 60_000 }, since: now - 60_000 });
		const claims = claimsFor("scout.fin.0002", "worker.gone.0003");
		const lines = orientation(tmp.store, ME, now, claims)!.split("\n").slice(2);
		assert.equal(lines[0], `- scout.fin.0002 scout idle · found ${"x".repeat(60 - 6 - 1)}…`);
		assert.equal(lines[1], "? worker.gone.0003 worker unknown (store lost)");
		const finishedGone = claimsFromBranch([...claims.values()].flatMap((c) => [{ type: "custom", customType: SPAWN_ENTRY, data: c.spawn }, { type: "custom", customType: RESULT_ENTRY, data: resultClaim(c.spawn.id, "idle", "ok", 2) }]));
		assert.ok(!orientation(tmp.store, ME, now, finishedGone)!.includes("unknown"));
	});
	it("shows the agents of the session this one was forked from as read-only", () => {
		tmp.store.create(mkInput("main.parent.0009", null, { role: "main" }));
		tmp.store.create(mkInput("worker.inh.0010", "main.parent.0009", { objective: "inherited work" }));
		live("worker.inh.0010");
		tmp.store.create(mkInput("main.fork.0011", null, { role: "main", forkedFrom: "main.parent.0009" }));
		const forked = claimsFor("worker.inh.0010"); // a clone carries its parent's claims
		assert.equal(orientation(tmp.store, "main.fork.0011", now, forked)!.split("\n").length, 3); // not "unknown", not "other branch"
		assert.equal(orientation(tmp.store, "main.fork.0011", now, new Map())!.split("\n")[2], "- [inherited, read-only] worker.inh.0010 worker working · inherited work");
		assert.equal(orientation(tmp.store, "main.parent.0009", now, new Map())!.split("\n")[2], "- worker.inh.0010 worker working · inherited work [other branch]");
	});
	it("caps the block at 12 lines and points at list_agents", () => {
		for (let i = 0; i < 15; i++) {
			const id = `worker.w${String(i).padStart(2, "0")}.${1000 + i}`;
			tmp.store.create(mkInput(id, ME, { createdAt: i }));
			live(id);
		}
		const lines = orientation(tmp.store, ME, now, new Map())!.split("\n").slice(2);
		assert.equal(lines.length, ORIENTATION_MAX_LINES + 1);
		assert.equal(lines.at(-1), "...3 more (list_agents)");
	});
	it("is deterministic and never includes log, note-free detail or long text", () => {
		tmp.store.create(mkInput("worker.a.0002", ME, { objective: "o".repeat(300) }));
		live("worker.a.0002");
		const a = orientation(tmp.store, ME, now, claimsFor("worker.a.0002"));
		assert.equal(a, orientation(tmp.store, ME, now, claimsFor("worker.a.0002")));
		assert.ok(a!.split("\n").every((line) => line.length < 200));
	});
});
