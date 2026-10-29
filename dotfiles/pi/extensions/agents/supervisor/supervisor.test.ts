import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { mkInput, useTempStore } from "../test-support.ts";
import type { AgentInput } from "../store/index.ts";
import { agentToolNames } from "../tool-names.ts";
import { buildChildArgs, childEnv, killGroup, planLaunch } from "./launch.ts";
import { compose, fromFrontmatter } from "./profiles.ts";
import { createSupervisor, resumeMessage } from "./index.ts";
import { newStalls, scan, stallNotice, treeNotices } from "./watchdog.ts";

const profile = { name: "worker", modelId: "claude-x", provider: "anthropic", thinking: "high", tools: ["read", "bash"], prompt: "be good" };

describe("buildChildArgs", () => {
	it("compiles to pi's CLI with the message last behind --", () => {
		const written: Record<string, string> = {};
		const args = buildChildArgs({ id: "worker.a.0001" }, profile, { message: "-x do it", dir: "/d", headless: false, extraTools: ["ask_parent"], extensionDir: "/ext" }, (name, text) => {
			written[name] = text;
			return `/tmp/${name}.md`;
		});
		assert.deepEqual(args.slice(0, 5), ["--no-extensions", "-e", "/ext", "--name", "agent:worker.a.0001"]);
		assert.ok(args.includes("--session-id") && args.includes("worker.a.0001"));
		assert.deepEqual(args.slice(args.indexOf("--session-dir"), args.indexOf("--session-dir") + 2), ["--session-dir", "/d/sessions"]);
		assert.deepEqual(args.slice(args.indexOf("--tools"), args.indexOf("--tools") + 2), ["--tools", "read,bash,ask_parent"]);
		assert.match(args.at(-1)!, /^@\/tmp\/message-\d+\.md$/); // objective goes through a file, not argv
		assert.equal(args.at(-2), "--");
		assert.ok(!args.includes("-x do it"));
		assert.equal(Object.values(written).includes("-x do it"), true);
		assert.ok(!args.includes("-p"));
	});
	it("headless adds -p, resume uses --session, no profile tools uses +names", () => {
		const args = buildChildArgs({ id: "s.a.0001" }, { ...profile, tools: undefined, prompt: undefined }, { message: "m", dir: "/d", headless: true, sessionFile: "/s.jsonl", extraTools: ["a", "b"], extensionDir: "/ext" }, (n) => `/tmp/${n}.md`);
		assert.ok(args.includes("-p"));
		assert.deepEqual(args.slice(args.indexOf("--session"), args.indexOf("--session") + 2), ["--session", "/s.jsonl"]);
		assert.ok(!args.includes("--session-id"));
		assert.deepEqual(args.slice(args.indexOf("--tools"), args.indexOf("--tools") + 2), ["--tools", "+a,+b"]);
		assert.ok(!args.includes("--append-system-prompt"));
	});
});

describe("planLaunch", () => {
	const base = mkInput("worker.a.0001", null, { name: "a", profile, cwd: "/work", stepTimeoutMs: 1, depth: 1, createdAt: 0 });
	it("wraps interactable agents in dtach with a PTY socket and the child env", () => {
		const plan = planLaunch(base, ["--x"], { home: "/h", ptySocket: "/h/worker.a.0001/pty.sock", dtach: "/bin/dtach", baseEnv: { PI_SESSION_ID: "leak", PATH: "/bin" } });
		assert.equal(plan.command, "/bin/dtach");
		assert.deepEqual(plan.args.slice(0, 4), ["-n", "/h/worker.a.0001/pty.sock", "-r", "winch"]);
		assert.equal(plan.env.PI_AGENTS_HOME, "/h");
		assert.equal(plan.env.PI_SESSION_ID, undefined);
	});
	it("runs non-interactable agents directly and rejects over-long socket paths", () => {
		const plan = planLaunch({ ...base, interactable: false }, ["--x"], { home: "/h", ptySocket: "/h/s" });
		assert.notEqual(plan.command, "dtach");
		assert.throws(() => planLaunch(base, [], { home: "/h", ptySocket: "/" + "x".repeat(120) }));
	});
	it("childEnv never inherits the session identity", () => {
		const env = childEnv({ PI_SESSION_FILE: "f", PI_SESSION_ID: "i", A: "1" }, "/h");
		assert.equal(env.PI_SESSION_FILE, undefined);
		assert.equal(env.A, "1");
	});
});

describe("profiles", () => {
	it("parses the new frontmatter fields and composes extends", () => {
		const a = fromFrontmatter({ name: "scout", interactable: false, timeout: 5, model: "fast", tools: "read, grep" }, "body");
		assert.equal(a.interactable, false);
		assert.equal(a.timeoutMinutes, 5);
		assert.deepEqual(a.tools, ["read", "grep"]);
		const map = new Map([["base", { name: "base", model: "fast" as const, prompt: "p" }], ["kid", { name: "kid", extends: ["base"], interactable: true }]]);
		const merged = compose("kid", map);
		assert.equal(merged.model, "fast");
		assert.equal(merged.interactable, true);
		assert.throws(() => compose("nope", map));
	});
});

describe("agentToolNames", () => {
	it("gates by capability", () => {
		assert.deepEqual(agentToolNames(false, false), ["send_message", "ask_parent", "yield", "set_status"]);
		assert.ok(agentToolNames(true, false).includes("yield"));
		assert.ok(!agentToolNames(true, false).includes("spawn_agent"));
		assert.ok(agentToolNames(true, true).includes("spawn_agent"));
	});
});

describe("resumeMessage", () => {
	it("tells the agent it was interrupted and to re-check state", () => {
		const text = resumeMessage({ objective: "do x" } as AgentInput, "lost", undefined, "carry on");
		assert.match(text, /do x/);
		assert.match(text, /lost/);
		assert.match(text, /carry on/);
	});
});

describe("watchdog scan", () => {
	const tmp = useTempStore("agents-wd-");
	const mk = (id: string, parent: string | null) => mkInput(id, parent, { role: "w", profile, createdAt: 0 });
	beforeEach(() => {
		tmp.store.create(mk("main.root.0001", null));
		tmp.store.create(mk("worker.a.0002", "main.root.0001"));
		tmp.store.acquireLock("worker.a.0002");
	});

	it("reports a stall once, delivers to a root via ui, and resets on recovery", () => {
		const reported = new Set<string>();
		tmp.store.writeState("worker.a.0002", { status: "working", activity: { lastEventAt: 0, lastSeenAt: 200_000 } });
		assert.deepEqual(scan(tmp.store, "main.root.0001", reported, 200_000), ["worker.a.0002:stall"]);
		assert.deepEqual(scan(tmp.store, "main.root.0001", reported, 201_000), []); // deduped
		const [msg] = tmp.store.readInbox("main.root.0001");
		assert.equal(msg?.kind, "stall");
		assert.equal(msg?.deliver, "ui");
		assert.match(msg!.body, /^STALLED CHILD worker\.a\.0002 \(worker\.a\.0002\): stall, .*This is about your child, not about you\./);
		tmp.store.writeState("worker.a.0002", { activity: { lastEventAt: 200_500, lastSeenAt: 201_500 } });
		assert.deepEqual(scan(tmp.store, "main.root.0001", reported, 202_000), []);
		assert.equal(reported.size, 0);
	});
	it("only watches direct children", () => {
		tmp.store.create(mk("worker.b.0003", "worker.a.0002"));
		tmp.store.acquireLock("worker.b.0003");
		tmp.store.writeState("worker.b.0003", { status: "working", activity: { lastEventAt: 0, lastSeenAt: 200_000 } });
		assert.deepEqual(scan(tmp.store, "main.root.0001", new Set(), 200_000), []);
	});
});

describe("stall visibility for the user", () => {
	const tmp = useTempStore("agents-wd2-");
	const mk = (id: string, parent: string | null) => mkInput(id, parent, { role: "w", name: id.split(".")[1], profile, createdAt: 0 });
	const stalled = (id: string, lastSeenAt: number) => {
		tmp.store.acquireLock(id);
		tmp.store.writeState(id, { status: "working", activity: { lastEventAt: 0, lastSeenAt } });
	};
	beforeEach(() => {
		tmp.store.create(mk("main.root.0001", null));
		tmp.store.create(mk("worker.a.0002", "main.root.0001"));
		tmp.store.create(mk("worker.b.0003", "worker.a.0002"));
	});

	it("newStalls lists a stall once and a recovery resets the dedupe", () => {
		stalled("worker.b.0003", 200_000);
		const reported = new Set<string>();
		const records = () => [tmp.store.record("worker.b.0003")!];
		assert.deepEqual(newStalls(records(), reported, 200_000).map((s) => s.report.kind), ["stall"]);
		assert.deepEqual(newStalls(records(), reported, 201_000), []);
		tmp.store.writeState("worker.b.0003", { activity: { lastEventAt: 200_500, lastSeenAt: 201_500 } });
		assert.deepEqual(newStalls(records(), reported, 202_000), []);
		assert.equal(reported.size, 0);
		assert.equal(newStalls(records(), reported, 400_000).length, 1); // stalls again after recovering
	});
	it("reports a grandchild stall to the root once, as a one-line notice, without creating store messages", () => {
		stalled("worker.b.0003", 200_000);
		const reported = new Set<string>();
		const [line, ...rest] = treeNotices(tmp.store, "main.root.0001", reported, 200_000);
		assert.equal(rest.length, 0);
		assert.match(line!, /^b·0003 \(w\): stall, .+\. Open \/agents to interrupt\.$/);
		assert.deepEqual(treeNotices(tmp.store, "main.root.0001", reported, 201_000), []);
		assert.deepEqual(tmp.store.readInbox("main.root.0001"), []);
		assert.deepEqual(tmp.store.readInbox("worker.a.0002"), []);
	});
	it("leaves direct children to their stall message so the user is not notified twice", () => {
		stalled("worker.a.0002", 200_000);
		assert.deepEqual(treeNotices(tmp.store, "main.root.0001", new Set(), 200_000), []);
		assert.deepEqual(scan(tmp.store, "main.root.0001", new Set(), 200_000), ["worker.a.0002:stall"]);
	});
	it("tells the user to resume a lost agent rather than interrupt it", () => {
		const record = tmp.store.record("worker.b.0003")!;
		assert.match(stallNotice({ record, report: { kind: "lost", overMs: 1, detail: "process gone" } }), /Open \/agents to resume\.$/);
	});
	it("formats the notice", () => {
		const record = tmp.store.record("worker.b.0003")!;
		assert.equal(stallNotice({ record, report: { kind: "wedged", overMs: 1, detail: "heartbeat stopped" } }), "b·0003 (w): wedged, heartbeat stopped. Open /agents to interrupt.");
	});
});

describe("killGroup", () => {
	it("is a no-op for a pid that is gone", () => {
		assert.doesNotThrow(() => killGroup(999_999, "SIGTERM"));
	});
});

describe("resume guards", () => {
	const tmp = useTempStore("agents-sup-");
	const base = (id: string, role: string) => mkInput(id, null, { role, profile, stepTimeoutMs: 1 });
	const requests: string[] = [];
	const sup = () => createSupervisor({ pi: {}, store: tmp.store, canSpawn: true, identity: undefined, ctx: undefined,
		connection: { flush: async () => {}, request: async (op: string) => { requests.push(op); } } } as never);

	it("refuses roots and unknown agents, delegating execution fencing to the sole daemon owner", async () => {
		tmp.store.create(base("main.r.0001", "main"));
		await assert.rejects(sup().resume("main.r.0001"), /root session/);
		await assert.rejects(sup().resume("nope.x.0000"), /Unknown agent/);
		tmp.store.create(base("worker.a.0002", "worker"));
		requests.length = 0;
		await sup().resume("worker.a.0002");
		assert.deepEqual(requests, ["resume"]);
	});
});
