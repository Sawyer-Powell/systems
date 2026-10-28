import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import processes from "../../zellij/index.ts";

test("spawn_process qualifies pi tab/session names without changing handles or positional prompts", async () => {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "agents-process-name-"));
	const env = { ...process.env };
	const tools = new Map<string, any>();
	const entries: any[] = [];
	try {
		fs.writeFileSync(path.join(home, "zellij"), `#!/usr/bin/env node\nconst fs = require('node:fs');\nconst args = process.argv.slice(2);\nif (args.includes('new-tab')) { fs.writeFileSync(process.env.ARGV_LOG, JSON.stringify(args)); console.log('7'); }\nelse console.log(JSON.stringify([{ id: 1, tab_id: 7, is_plugin: false, title: '', exited: false, is_floating: false }]));\n`, { mode: 0o700 });
		process.env.PATH = `${home}:${env.PATH}`;
		process.env.ZELLIJ = "test";
		process.env.ZELLIJ_SESSION_NAME = "test session";
		process.env.ARGV_LOG = path.join(home, "argv.json");
		processes({ on() {}, registerTool(tool: any) { tools.set(tool.name, tool); }, appendEntry(_type: string, data: any) { entries.push(data); } } as never);
		const ctx = { cwd: home, sessionManager: { getSessionName: () => "parent::child" } };
		await tools.get("spawn_process").execute("call", { kind: "pi", relation: "sibling", target: "tab", config: { prompt: "--name" } }, undefined, undefined, ctx);
		const record = entries[0].record;
		assert.equal(record.handle, "s1");
		assert.equal(record.name, `parent::child::pi: ${path.basename(home)}`);
		const argv: string[] = JSON.parse(fs.readFileSync(process.env.ARGV_LOG, "utf8"));
		assert.equal(argv[argv.indexOf("--name") + 1], record.name);
		assert.equal(argv.at(-1), "--name", "positional prompt remains literal");
		assert.equal(argv[argv.lastIndexOf("--") - 1], record.name, "session-name flag precedes positional separator");
	} finally {
		for (const key of ["PATH", "ZELLIJ", "ZELLIJ_SESSION_NAME", "ARGV_LOG"]) {
			if (env[key] === undefined) delete process.env[key]; else process.env[key] = env[key];
		}
		fs.rmSync(home, { recursive: true, force: true });
	}
});
