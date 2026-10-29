import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { startDaemon } from "./daemon.ts";
import { RuntimeClient } from "./ipc.ts";
import type { AgentInput } from "../store/types.ts";

test("durable receipts and singleton fencing survive daemon restart", async () => {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "agents-bus-"));
	let runtime = await startDaemon(home);
	const client = new RuntimeClient();
	try {
		await client.connect(home);
		await assert.rejects(startDaemon(home), /already running/);
		const input: AgentInput = { id: "root.test", name: "test", role: "main", parent: null, objective: "test",
			profile: { name: "test", modelId: "offline", thinking: "off" }, cwd: home, interactable: true,
			stepTimeoutMs: 180000, depth: 0, createdAt: 1 };
		await client.request("create", { input });
		const file = path.join(home, "session.jsonl");
		await client.request("hello", { id: input.id, pid: process.pid, sessionFile: file });
		const message = { id: "accepted-once", from: "user", to: input.id, body: "hello", kind: "info", deliver: "ui" };
		await client.request("send", { message });
		await client.request("send", { message });
		assert.equal(runtime.database.store.readInbox(input.id).length, 1);
		await client.request("receipt", { id: input.id });
		assert.equal(runtime.database.store.readInbox(input.id).length, 1, "a queue/send return without a session entry is NOT a receipt");
		fs.writeFileSync(file, JSON.stringify({ type: "custom", customType: "agents.receipt", id: "persisted-entry", data: { id: message.id } }) + "\n");
		await client.request("receipt", { id: input.id });
		assert.deepEqual(runtime.database.store.readInbox(input.id), []);
		assert.equal(runtime.database.db.prepare("SELECT receipt FROM messages WHERE id=?").get(message.id)?.receipt, "persisted-entry");
		const replacement = new RuntimeClient();
		try {
			await replacement.connect(home);
			await replacement.request("hello", { id: input.id, pid: process.pid, sessionFile: file });
			assert.equal(runtime.live.get(input.id)?.owner.pid, process.pid, "same-writer reload does not wait for the old socket EOF");
		} finally { replacement.close(); }
		for (let i = 0; i < 7; i++) {
			const id = `worker.old-lost.${i}`;
			await client.request("create", { input: { ...input, id, role: "worker", parent: input.id, depth: 1 } });
			runtime.database.store.writeState(id, { status: "waiting-on-user", activity: { lastSeenAt: 0, lastEventAt: 0 } });
			runtime.database.setRuntime(id, "blocked", { token: "unknown", settled: false });
		}
		await assert.rejects(client.request("mark-done", { id: "worker.old-lost.0" }), /live or ambiguous/);
		const waiting = "worker.genuine-wait";
		await client.request("create", { input: { ...input, id: waiting, role: "worker", parent: input.id, depth: 1 } });
		runtime.database.store.writeState(waiting, { status: "waiting-on-user" });
		const widget = runtime.database.widget(input.id);
		assert.ok(widget.records.some(r => r.input.id === waiting), "old blocked stored waiting states cannot hide a real waiting agent");
		assert.ok(!widget.records.some(r => r.input.id.startsWith("worker.old-lost.")));
		const child = { ...input, id: "worker.interrupted", parent: input.id, role: "worker", depth: 1 };
		await client.request("create", { input: child });
		runtime.database.setRuntime(child.id, "live", { token: "old-owner", pid: process.pid, settled: false });
		client.close();
		await runtime.close();
		runtime = await startDaemon(home);
		assert.equal(runtime.database.runtime(child.id)?.residency, "blocked");
		assert.equal(runtime.database.store.record(child.id)?.status, "lost");
		const reconnected = new RuntimeClient();
		try {
			await reconnected.connect(home);
			await assert.rejects(reconnected.request("resume", { id: child.id }), /still live or ambiguous/);
			await reconnected.request("send", { message: { ...message, id: "retained-during-block", to: child.id, deliver: "context" } });
			assert.equal(runtime.database.store.readInbox(child.id)[0]?.id, "retained-during-block");
			assert.equal(runtime.live.size, 0, "interrupted owners are not automatically replayed");
		} finally { reconnected.close(); }
	} finally {
		client.close(); await runtime.close(); fs.rmSync(home, { recursive: true, force: true });
	}
});
