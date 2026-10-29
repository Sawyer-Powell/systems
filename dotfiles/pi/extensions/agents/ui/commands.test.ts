import assert from "node:assert/strict";
import { it } from "node:test";
import type { Component } from "@earendil-works/pi-tui";
import type { AgentsHost } from "../host.ts";
import type { AgentRecord } from "../store/index.ts";
import { registerUi } from "./index.ts";

it("agent commands select fuzzy targets explicitly, cancel safely and preserve stable IDs", async () => {
	const record = (id: string, name: string, status: "idle" | "archived", parent: string | null): AgentRecord => ({
		input: { id, name, parent, role: parent ? "worker" : "main", objective: "test", profile: { name: "fixture", modelId: "none", thinking: "off" }, cwd: "/fixture", interactable: true, depth: parent ? 1 : 0, stepTimeoutMs: 180000, createdAt: Number(id.slice(-4)) },
		state: { status, since: Date.now(), activity: { lastSeenAt: 0, lastEventAt: 0, inFlight: null } }, status, alive: false, residency: "parked",
	});
	const root = record("main.parent.0001", "parent", "idle", null);
	root.alive = true; root.residency = "live";
	const first = record("worker.alpha.0002", "alpha", "idle", root.input.id);
	const beta = record("worker.beta.0003", "beta", "idle", root.input.id);
	const retired = record("worker.retired.0004", "retired", "archived", root.input.id);
	const second = record("worker.alpha.0005", "alpha", "idle", root.input.id);
	let records = [root, first, beta, retired, second];
	const requests: Array<{ op: string; args: any }> = [];
	const notices: string[] = [];
	const commands = new Map<string, { handler: (args: string, ctx: any) => Promise<void> }>();
	const listeners = new Map<string, (...args: any[]) => void>();
	let picker: Component | undefined;
	let listReads = 0;
	let widget: { lines: string[] | undefined; placement?: string } | undefined;
	const ctx = { hasUI: true, ui: {
		notify: (message: string) => notices.push(message), setStatus() {},
		setWidget: (_key: string, lines: string[] | undefined, options: { placement?: string }) => { widget = { lines, placement: options.placement }; },
		custom: (factory: any) => new Promise(resolve => { picker = factory({ requestRender() {} }, { fg: (_color: string, text: string) => text }, {}, resolve); }),
	} };
	const host = { identity: root.input, ctx, canSpawn: true,
		pi: { registerCommand: (name: string, definition: any) => commands.set(name, definition), on: (name: string, handler: (...args: any[]) => void) => listeners.set(name, handler), registerShortcut() {}, registerEntryRenderer() {}, registerMessageRenderer() {} },
		store: {
			list: () => { listReads++; return records; }, record: (id: string) => records.find(r => r.input.id === id),
			readInput: (id: string) => records.find(r => r.input.id === id)?.input,
		},
		connection: { widget: () => ({ records, total: 3, children: { total: 4, live: 0 } }), on() {}, off() {}, flush: async () => {}, request: async (op: string, args: any) => { requests.push({ op, args }); } },
	} as unknown as AgentsHost;
	registerUi(host, {} as never);
	assert.deepEqual([...commands.keys()].sort(), ["agent-archive", "agent-restore", "agent-yield", "agents"]);
	listeners.get("session_start")!({}, ctx);
	assert.equal(listReads, 0, "widget refresh uses its bounded snapshot, never on-demand store.list");
	assert.equal(widget?.placement, "aboveEditor");
	assert.ok(widget?.lines?.some(line => line.includes("alpha")));
	assert.ok(!widget?.lines?.some(line => line.includes("parent::")));

	const start = (command: string, args = "") => { picker = undefined; return commands.get(command)!.handler(args, ctx); };
	const currentPicker = (): Component => { assert.ok(picker); return picker; };
	for (const name of ["agent-yield", "agent-archive", "agent-restore"]) {
		const pending = start(name);
		assert.ok(currentPicker().render(120).join("\n").includes("select target"));
		assert.equal(requests.length, 0, "opening the default picker never acts on self or nearest target");
		currentPicker().handleInput!("\x1b"); await pending;
		assert.equal(requests.length, 0);
	}
	const ambiguous = start("agent-archive", "alpha");
	const initial = currentPicker().render(140).join("\n");
	assert.match(initial, /› alpha/);
	assert.match(initial, /parent::alpha · 0002/);
	assert.match(initial, /parent::alpha · 0005/);
	assert.equal(requests.length, 0);
	currentPicker().handleInput!("\x1b[B");
	records = [root, record("worker.alpha.0000", "alpha", "idle", root.input.id), ...records.slice(1)];
	currentPicker().handleInput!("\r"); await ambiguous;
	assert.deepEqual(requests.pop(), { op: "archive", args: { id: second.input.id, actor: "user" } }, "Enter uses the shown stable ID even if underlying rows shift");

	await start("agent-archive", beta.input.id);
	assert.equal(picker, undefined, "exact ID may bypass selection");
	assert.equal(requests.pop()?.args.id, beta.input.id);
	await start("agent-archive", "parent::beta");
	assert.equal(picker, undefined, "unambiguous full qualified name may bypass selection");
	assert.equal(requests.pop()?.args.id, beta.input.id);
	const restoring = start("agent-restore", "ret");
	assert.match(currentPicker().render(100).join("\n"), /› ret/);
	currentPicker().handleInput!("\r"); await restoring;
	assert.deepEqual(requests.pop(), { op: "restore", args: { id: retired.input.id, actor: "user" } });
	await start("agent-yield", "parent::beta");
	assert.deepEqual(requests.pop(), { op: "request-yield", args: { id: beta.input.id } });
	const missing = start("agent-archive", "no-such-agent");
	assert.match(currentPicker().render(100).join("\n"), /no matches/);
	currentPicker().handleInput!("\r"); await missing;
	assert.equal(requests.length, 0);
	const universal = start("agents", "parent::beta");
	assert.match(currentPicker().render(100).join("\n"), /› parent::beta/);
	currentPicker().handleInput!("\x1b"); await universal;
	assert.equal(requests.length, 0);
	const vanished = start("agent-archive", "bet");
	currentPicker().render(100);
	records = records.filter(r => r.input.id !== beta.input.id);
	currentPicker().handleInput!("\r"); await vanished;
	assert.equal(requests.length, 0);
	assert.ok(notices.includes("Selected agent is no longer available."));
});
