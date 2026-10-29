import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { it } from "node:test";
import type { AgentsHost } from "../host.ts";
import { runtimeHome } from "../central/database.ts";
import { createStore } from "../store/store.ts";
import { legacyStartupRefusal } from "./cutover.ts";
import { registerRuntime } from "./index.ts";

it("official home resolver preserves overrides and cutover refuses legacy writers before daemon startup", async t => {
	const saved = Object.fromEntries(["PI_AGENTS_HOME", "PI_AGENTS_ID", "PI_AGENTS_OWNER"].map(key => [key, process.env[key]]));
	t.after(() => { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
	delete process.env.PI_AGENTS_ID; delete process.env.PI_AGENTS_OWNER;
	// These calls resolve strings only: never open/create the official home or database.
	for (const value of [undefined, "", " \t "]) {
		if (value === undefined) delete process.env.PI_AGENTS_HOME; else process.env.PI_AGENTS_HOME = value;
		assert.equal(runtimeHome(), path.join(os.homedir(), ".pi", "agents-v2"));
		assert.equal(createStore().home, runtimeHome());
	}
	process.env.PI_AGENTS_HOME = " /tmp/agents-custom-not-created ";
	assert.equal(runtimeHome(), "/tmp/agents-custom-not-created");
	assert.equal(createStore().home, runtimeHome());
	assert.equal(createStore("/tmp/explicit-not-created").home, "/tmp/explicit-not-created");

	const temp = fs.mkdtempSync(path.join(os.tmpdir(), "agents-cutover-"));
	t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
	const legacy = path.join(temp, "legacy"), home = path.join(temp, "runtime"), id = randomUUID();
	const dir = path.join(legacy, id);
	fs.mkdirSync(dir, { recursive: true });
	const input = path.join(dir, "input.json"), lock = path.join(dir, "lock");
	assert.equal(legacyStartupRefusal(id, home, legacy), undefined);
	fs.writeFileSync(input, JSON.stringify({ parent: "old-parent" }));
	assert.match(legacyStartupRefusal(id, home, legacy)!, /Legacy managed worker/);
	fs.writeFileSync(input, JSON.stringify({ parent: null }));
	assert.equal(legacyStartupRefusal(id, home, legacy), undefined, "unowned human session may reconnect");
	fs.writeFileSync(lock, JSON.stringify({ pid: process.pid }));
	assert.equal(legacyStartupRefusal(id, home, legacy), undefined, "same human writer may reload");
	fs.writeFileSync(lock, JSON.stringify({ pid: process.ppid })); // test runner, signal 0 only
	assert.match(legacyStartupRefusal(id, home, legacy)!, /live owner/);
	const probe = t.mock.method(process, "kill", () => { throw Object.assign(new Error("dead"), { code: "ESRCH" }); });
	assert.equal(legacyStartupRefusal(id, home, legacy), undefined, "conclusively dead old owner allows reconnect");
	probe.mock.mockImplementation(() => { throw Object.assign(new Error("unknown"), { code: "EPERM" }); });
	assert.match(legacyStartupRefusal(id, home, legacy)!, /Cannot verify/);
	probe.mock.restore();
	fs.writeFileSync(lock, "{");
	assert.match(legacyStartupRefusal(id, home, legacy)!, /Cannot verify/);
	assert.equal(fs.readFileSync(lock, "utf8"), "{", "unknown legacy lock is never changed");
	fs.rmSync(lock);
	fs.writeFileSync(input, JSON.stringify({ parent: "old-parent" }));
	assert.match(legacyStartupRefusal(id, legacy, home)!, /Legacy managed worker/, "explicit old home is checked too");
	process.env.PI_AGENTS_ID = id; process.env.PI_AGENTS_OWNER = "v2-token";
	assert.equal(legacyStartupRefusal(id, home, legacy), undefined, "known managed identity keeps daemon ownership protocol");
	process.env.PI_AGENTS_ID = "different";
	assert.match(legacyStartupRefusal(id, home, legacy)!, /mismatched/);
	delete process.env.PI_AGENTS_ID; delete process.env.PI_AGENTS_OWNER;

	// Real lifecycle handler, fake transport: refusal happens before start/root creation.
	const handlers = new Map<string, (...args: any[]) => Promise<void>>();
	let starts = 0, shutdowns = 0;
	const notices: string[] = [];
	const host = { pi: { on: (name: string, fn: (...args: any[]) => Promise<void>) => handlers.set(name, fn) }, store: { home: legacy },
		connection: { start: async () => { starts++; throw new Error("must not start"); } }, canSpawn: true,
	} as unknown as AgentsHost;
	registerRuntime(host);
	await handlers.get("session_start")!({}, { sessionManager: { getSessionId: () => id }, shutdown: () => shutdowns++, ui: { notify: (text: string) => notices.push(text) } });
	assert.equal(starts, 0);
	assert.equal(shutdowns, 1);
	assert.equal(host.identity, undefined);
	assert.equal(host.canSpawn, false);
	assert.ok(notices.some(text => text.includes("Legacy managed worker")));
	assert.equal(fs.existsSync(path.join(legacy, "runtime.sqlite")), false);
});
