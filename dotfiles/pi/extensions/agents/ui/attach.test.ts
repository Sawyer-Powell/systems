import assert from "node:assert/strict";
import { test } from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { attach, attachArgv, attachTabName } from "./attach.ts";
import { mkInput } from "../test-support.ts";
import type { AgentRecord } from "../store/types.ts";

test("managed attachment passes home and identity as separate argv without raw dtach", () => {
	const argv = attachArgv("worker.test.0001", "/tmp/home with spaces");
	assert.deepEqual(argv.slice(0, 2), ["env", "PI_AGENTS_HOME=/tmp/home with spaces"]);
	assert.equal(argv.at(-1), "worker.test.0001");
	assert.match(argv.at(-2)!, /central\/attach\.ts$/);
	assert.ok(!argv.includes("dtach"));
});

test("attach uses bounded lineage labels and passes colons/quotes literally to zellij", async () => {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "agents-attach-name-"));
	const env = { ...process.env };
	const root = { input: mkInput("main.r.0001", null, { name: "parent's space" }) } as AgentRecord;
	const child = { input: mkInput("worker.c.0002", root.input.id, { name: "child" }) } as AgentRecord;
	try {
		// Exercise execFile argv boundaries, without touching the live zellij session.
		fs.writeFileSync(path.join(home, "zellij"), `#!/usr/bin/env node\nconst fs = require('node:fs');\nconst args = process.argv.slice(2);\nif (args.includes('new-tab')) { fs.writeFileSync(process.env.ARGV_LOG, JSON.stringify(args)); console.log('7'); }\nelse console.log(JSON.stringify([{ id: 1, tab_id: 7, is_plugin: false, title: '', exited: false, is_floating: false }]));\n`, { mode: 0o700 });
		process.env.PATH = `${home}:${env.PATH}`;
		process.env.ZELLIJ = "test";
		process.env.ZELLIJ_SESSION_NAME = "test session";
		process.env.ARGV_LOG = path.join(home, "argv.json");
		const result = await attach(child, `${home}/${child.input.id}/pty.sock`, [root]);
		assert.equal(result.opened, true);
		const argv = JSON.parse(fs.readFileSync(process.env.ARGV_LOG, "utf8"));
		assert.equal(argv[argv.indexOf("--name") + 1], "parent's space::child");
		assert.equal(argv.at(-1), child.input.id, "wrapper still addresses the immutable ID");
		assert.ok([...attachTabName({ ...child, input: { ...child.input, name: "x".repeat(150) } }, [root])].length <= 96);
	} finally {
		for (const key of ["PATH", "ZELLIJ", "ZELLIJ_SESSION_NAME", "ARGV_LOG"]) {
			if (env[key] === undefined) delete process.env[key]; else process.env[key] = env[key];
		}
		fs.rmSync(home, { recursive: true, force: true });
	}
});
