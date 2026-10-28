import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import { mkInput, useTempStore } from "../test-support.ts";
import { forkedFromOf } from "./identity.ts";

const t = useTempStore("agents-identity-");

describe("forkedFromOf", () => {
	const sessionFile = (id: string) => {
		const file = path.join(t.home, `${id}.jsonl`);
		fs.writeFileSync(file, `${JSON.stringify({ type: "session", version: 3, id, cwd: "/x" })}\n{"type":"message"}\n`);
		return file;
	};
	it("resolves the parent session's id when the store has that agent", () => {
		t.store.create(mkInput("main.parent.0001", null));
		assert.equal(forkedFromOf(t.store, sessionFile("main.parent.0001")), "main.parent.0001");
	});
	it("is undefined for no parent, an unknown agent, or an unreadable file", () => {
		assert.equal(forkedFromOf(t.store, undefined), undefined);
		assert.equal(forkedFromOf(t.store, sessionFile("main.unknown.0002")), undefined);
		assert.equal(forkedFromOf(t.store, path.join(t.home, "missing.jsonl")), undefined);
		fs.writeFileSync(path.join(t.home, "bad.jsonl"), "not json\n");
		assert.equal(forkedFromOf(t.store, path.join(t.home, "bad.jsonl")), undefined);
	});
});
