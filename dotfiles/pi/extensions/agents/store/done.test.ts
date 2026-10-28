import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkInput, useTempStore } from "../test-support.ts";
import { type AgentRecord, type EffectiveStatus } from "./index.ts";
import { planDone, resolveAgent, settleDone, wrapUpText } from "./done.ts";

const rec = (id: string, status: EffectiveStatus, extra: { alive?: boolean; parent?: string | null; name?: string; role?: string } = {}): AgentRecord => ({
	input: mkInput(id, extra.parent === undefined ? "main.root.0001" : extra.parent, { name: extra.name ?? id.split(".")[1], ...(extra.role ? { role: extra.role } : {}) }),
	state: undefined,
	alive: extra.alive ?? !["lost", "done", "stopped", "timed-out"].includes(status),
	status,
});

describe("planDone", () => {
	it("sends to live agents in every working or waiting state", () => {
		for (const status of ["working", "idle", "waiting-on-user", "waiting-on-parent"] as const) {
			assert.deepEqual(planDone(rec("worker.a.0002", status)), { action: "send" }, status);
		}
	});
	it("lets a live interactable agent that errored be wrapped up", () => {
		assert.deepEqual(planDone(rec("worker.a.0002", "error", { alive: true })), { action: "send" });
	});
	it("marks a lost agent directly (nobody to ask)", () => {
		assert.deepEqual(planDone(rec("worker.a.0002", "lost")), { action: "mark" });
	});
	it("is a no-op for an agent that is already done", () => {
		assert.equal(planDone(rec("worker.a.0002", "done")).action, "noop");
		assert.equal(planDone(rec("worker.a.0002", "done", { alive: true })).action, "noop");
	});
	it("refuses stopped, timed-out and dead errored agents with a resume hint, and a still-starting one", () => {
		for (const status of ["stopped", "timed-out", "error"] as const) {
			const plan = planDone(rec("worker.a.0002", status, { alive: false }));
			assert.equal(plan.action, "refuse", status);
			assert.match((plan as { reason: string }).reason, /Resume it first/);
		}
		assert.equal(planDone(rec("worker.a.0002", "starting")).action, "refuse");
	});
	it("refuses a user session", () => {
		assert.equal(planDone(rec("main.root.0001", "idle", { parent: null, role: "main" })).action, "refuse");
	});
});

describe("resolveAgent", () => {
	const list = [rec("worker.alpha.0002", "idle"), rec("worker.beta.0003", "idle"), rec("scout.alphabet.0004", "working")];
	const idOf = (r: ReturnType<typeof resolveAgent>) => ("record" in r ? r.record.input.id : r.error);
	it("matches exact id, exact name, then unique prefixes", () => {
		assert.equal(idOf(resolveAgent(list, "worker.beta.0003")), "worker.beta.0003");
		assert.equal(idOf(resolveAgent(list, "beta")), "worker.beta.0003");
		assert.equal(idOf(resolveAgent(list, "alphabet")), "scout.alphabet.0004"); // exact name beats prefix of "alpha"
		assert.equal(idOf(resolveAgent(list, "worker.be")), "worker.beta.0003");
	});
	it("reports ambiguity and misses", () => {
		assert.match(idOf(resolveAgent(list, "worker")), /ambiguous: worker\.alpha\.0002, worker\.beta\.0003/);
		assert.match(idOf(resolveAgent(list, "nope")), /No such agent/);
		assert.match(idOf(resolveAgent(list, "  ")), /Name an agent/);
	});
});

describe("settleDone", () => {
	const base = { pending: true, aborted: false, status: "working" as const, failed: false };
	it("ignores runs with no outstanding request", () => {
		assert.equal(settleDone({ ...base, pending: false }), "none");
	});
	it("recognises report_done, and finishes on the agent's behalf when it was not called", () => {
		assert.equal(settleDone({ ...base, status: "done" }), "reported");
		assert.equal(settleDone(base), "finish");
		assert.equal(settleDone({ ...base, status: "idle" }), "finish");
	});
	it("drops the request on interrupt, on a question, and on a model error", () => {
		assert.equal(settleDone({ ...base, aborted: true }), "cancelled");
		assert.equal(settleDone({ ...base, status: "waiting-on-user" }), "asked");
		assert.equal(settleDone({ ...base, status: "waiting-on-parent" }), "asked");
		assert.equal(settleDone({ ...base, failed: true }), "failed");
	});
});

describe("wrapUpText", () => {
	it("tells the agent to report, not delete, and not to commit", () => {
		const text = wrapUpText();
		assert.match(text, /report_done/);
		assert.match(text, /jj st/);
		assert.match(text, /Do NOT delete/);
	});
});

describe("control done through the mailbox", () => {
	const tmp = useTempStore("agents-done-");
	it("lets the user send it to any agent, and a parent to its child, but not a sibling", () => {
		const { store } = tmp;
		store.create(mkInput("main.root.0001", null));
		store.create(mkInput("worker.a.0002", "main.root.0001"));
		store.create(mkInput("worker.b.0003", "main.root.0001"));
		const msg = { kind: "control" as const, control: "done" as const, body: "done", deliver: "context" as const };
		assert.equal(store.send({ from: "user", to: "worker.a.0002", ...msg }).control, "done");
		assert.equal(store.send({ from: "main.root.0001", to: "worker.a.0002", ...msg }).kind, "control");
		assert.throws(() => store.send({ from: "worker.b.0003", to: "worker.a.0002", ...msg }), /may not message/);
		assert.equal(store.readInbox("worker.a.0002").length, 2);
	});
});
