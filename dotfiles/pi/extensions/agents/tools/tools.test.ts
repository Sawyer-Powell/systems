import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import type { AgentsHost } from "../host.ts";
import type { AgentInput } from "../store/index.ts";
import { agentToolNames } from "../tool-names.ts";
import { mkInput as mk, useTempStore } from "../test-support.ts";
import type { Supervisor } from "../supervisor/index.ts";
import { NOTE_MAX_CHARS } from "../store/index.ts";
import { describeRecord, registerTools } from "./index.ts";

type Tool = { name: string; execute: (id: string, params: any) => Promise<{ content: { text: string }[] }> };

const tmp = useTempStore("agents-tools-");

function harness(identity: AgentInput, launched: boolean, canSpawn: boolean, supervisor?: Partial<Supervisor>) {
	const tools = new Map<string, Tool>();
	const startHandlers: Array<() => void> = [];
	const host = {
		pi: {
			registerTool: (t: Tool) => tools.set(t.name, t),
			on: (event: string, handler: () => void) => void (event === "session_start" && startHandlers.push(handler)),
		},
		store: tmp.store,
		launched: launched ? identity : undefined,
		interactable: identity.interactable,
		depth: identity.depth,
		canSpawn,
		identity,
		ctx: undefined,
	} as unknown as AgentsHost;
	registerTools(host, (supervisor ?? {}) as Supervisor);
	for (const handler of startHandlers) handler();
	return tools;
}
const run = async (tools: Map<string, Tool>, name: string, params: object) => (await tools.get(name)!.execute("id", params)).content[0]!.text;

beforeEach(() => {
	tmp.store.create(mk("main.root.0001", null));
	tmp.store.create(mk("worker.a.0002", "main.root.0001"));
	tmp.store.create(mk("scout.s.0003", "worker.a.0002", { interactable: false }));
});

describe("registration gates", () => {
	it("root gets send_message and spawn tools only", () => {
		const names = [...harness(mk("main.root.0001", null), false, true).keys()];
		assert.ok(names.includes("send_message") && names.includes("spawn_agent") && names.includes("list_agents"));
		assert.ok(!names.includes("ask_parent") && !names.includes("report_done") && !names.includes("ask_user"));
	});
	it("non-interactable leaf gets no ask_user and no spawn", () => {
		const names = [...harness(tmp.store.readInput("scout.s.0003")!, true, false).keys()];
		assert.deepEqual(names.sort(), ["ask_parent", "report_done", "send_message", "set_status"]);
	});
	it("a child registers exactly the tools agentToolNames lists for its capabilities", () => {
		for (const [interactable, canSpawn] of [[false, false], [true, false], [true, true]] as const) {
			const identity = mk("worker.a.0002", "main.root.0001", { interactable });
			assert.deepEqual([...harness(identity, true, canSpawn).keys()].sort(), agentToolNames(interactable, canSpawn).sort());
		}
	});
	it("interactable child gets ask_user", () => {
		assert.ok(harness(tmp.store.readInput("worker.a.0002")!, true, true).has("ask_user"));
	});
});

describe("flows", () => {
	it("ask_parent sends a question and records waiting-on-parent", async () => {
		tmp.store.writeState("worker.a.0002", { status: "working" });
		const tools = harness(tmp.store.readInput("worker.a.0002")!, true, true);
		assert.match(await run(tools, "ask_parent", { question: "which db?" }), /End your turn/);
		const [q] = tmp.store.readInbox("main.root.0001");
		assert.equal(q?.kind, "question");
		const state = tmp.store.readState("worker.a.0002");
		assert.equal(state?.status, "waiting-on-parent");
		assert.equal(state?.waitingOn?.messageId, q?.id);
	});
	it("report_done sets done and notifies a root parent via ui, a nested parent via context", async () => {
		await run(harness(tmp.store.readInput("worker.a.0002")!, true, true), "report_done", { summary: "did it" });
		assert.equal(tmp.store.readState("worker.a.0002")?.status, "done");
		assert.equal(tmp.store.readInbox("main.root.0001")[0]?.deliver, "ui");
		await run(harness(tmp.store.readInput("scout.s.0003")!, true, false), "report_done", { summary: "found it" });
		assert.equal(tmp.store.readInbox("worker.a.0002")[0]?.deliver, "context");
	});
	it("send_message resolves parent, blocks siblings", async () => {
		tmp.store.create(mk("worker.b.0004", "main.root.0001"));
		const tools = harness(tmp.store.readInput("worker.a.0002")!, true, true);
		await run(tools, "send_message", { to: "parent", body: "hi" });
		assert.equal(tmp.store.readInbox("main.root.0001")[0]?.kind, "info");
		await assert.rejects(run(tools, "send_message", { to: "worker.b.0004", body: "psst" }));
	});
	it("control tools refuse agents outside the caller's subtree", async () => {
		const calls: string[] = [];
		const tools = harness(tmp.store.readInput("worker.a.0002")!, true, true, { signal: async (id: string) => void calls.push(id) });
		await assert.rejects(run(tools, "kill_agent", { id: "main.root.0001" }), /not one of your descendants/);
		await run(tools, "kill_agent", { id: "scout.s.0003" });
		assert.deepEqual(calls, ["scout.s.0003"]);
	});
	it("spawn_agent reports id and how to reach it", async () => {
		const tools = harness(mk("main.root.0001", null), false, true, {
			spawn: async (r: { profile: string }) => mk(`${r.profile}.x.9999`, "main.root.0001"),
		});
		assert.match(await run(tools, "spawn_agent", { profile: "worker", objective: "do" }), /worker\.x\.9999.*\/agents/);
	});
});

describe("set_status", () => {
	const ME = "worker.a.0002";
	const tools = () => harness(tmp.store.readInput(ME)!, true, true);
	const note = () => tmp.store.readState(ME)?.note;

	it("is registered for interactable and non-interactable children, absent for the root", () => {
		assert.ok(harness(mk("main.root.0001", null), false, true).has("set_status") === false);
		assert.ok(harness(tmp.store.readInput(ME)!, true, true).has("set_status"));
		assert.ok(harness(tmp.store.readInput("scout.s.0003")!, true, false).has("set_status"));
	});
	it("collapses whitespace and newlines", async () => {
		await run(tools(), "set_status", { note: "  running \n\t tests   now \n" });
		assert.equal(note(), "running tests now");
	});
	it("truncates to exactly 60 chars with an ellipsis", async () => {
		await run(tools(), "set_status", { note: "x".repeat(200) });
		assert.equal([...note()!].length, NOTE_MAX_CHARS);
		assert.equal(note(), `${"x".repeat(NOTE_MAX_CHARS - 1)}…`);
		await run(tools(), "set_status", { note: "y".repeat(NOTE_MAX_CHARS) });
		assert.equal(note(), "y".repeat(NOTE_MAX_CHARS)); // exactly at the limit is untouched
	});
	it("an empty note clears it", async () => {
		await run(tools(), "set_status", { note: "running tests" });
		await run(tools(), "set_status", { note: " \n " });
		assert.equal(note(), undefined);
	});
	it("never changes status or sends a message", async () => {
		tmp.store.writeState(ME, { status: "waiting-on-user", summary: "q?" });
		assert.equal(await run(tools(), "set_status", { note: "waiting on CI" }), "Status set.");
		const state = tmp.store.readState(ME);
		assert.equal(state?.status, "waiting-on-user");
		assert.equal(state?.summary, "q?");
		assert.equal(note(), "waiting on CI");
		assert.deepEqual(tmp.store.readInbox("main.root.0001"), []);
		assert.deepEqual(tmp.store.readInbox(ME), []);
	});
	it("is cleared by report_done", async () => {
		await run(tools(), "set_status", { note: "almost there" });
		await run(tools(), "report_done", { summary: "done" });
		assert.equal(note(), undefined);
	});
});

describe("describeRecord", () => {
	it("includes the note after the running/quiet bit and before the summary", () => {
		tmp.store.writeState("worker.a.0002", { status: "working", note: "running tests", summary: "sum", activity: { lastEventAt: 0, inFlight: null } });
		tmp.store.acquireLock("worker.a.0002");
		assert.match(describeRecord(tmp.store.record("worker.a.0002")!, 5000), /working · quiet 5s · running tests · sum$/);
	});
	it("shows running step, otherwise quiet time, then the summary", () => {
		tmp.store.writeState("worker.a.0002", { status: "working", activity: { lastEventAt: 0, inFlight: { kind: "tool", name: "bash", summary: "bash: pytest", startedAt: 0 } } });
		tmp.store.acquireLock("worker.a.0002");
		const line = describeRecord(tmp.store.record("worker.a.0002")!, 1000);
		assert.match(line, /worker\.a\.0002 · worker · working · running bash: pytest/);
	});
});
