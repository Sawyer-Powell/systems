import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentRecord } from "./index.ts";
import { claimsFromBranch, reconcileClaims, RESULT_ENTRY, resultClaim, SPAWN_ENTRY, spawnClaim } from "./index.ts";
import { mkInput } from "../test-support.ts";

const entry = (customType: string, data: unknown, type = "custom") => ({ type, customType, data });
const record = (id: string): AgentRecord => ({ input: mkInput(id, "main.root.0001"), state: undefined, alive: false, status: "idle" });

describe("claims", () => {
	it("caps objective and summary", () => {
		assert.equal(spawnClaim(mkInput("worker.a.0001", null, { objective: "x".repeat(500) }), 1).objective.length, 200);
		assert.equal(resultClaim("worker.a.0001", "done", "y".repeat(500), 1).summary.length, 300);
	});
	it("collects spawns and pairs results, latest result wins, ignores unrelated and orphaned entries", () => {
		const a = spawnClaim(mkInput("worker.a.0001", null), 1);
		const b = spawnClaim(mkInput("scout.b.0002", null), 2);
		const claims = claimsFromBranch([
			entry(SPAWN_ENTRY, a),
			{ type: "message" },
			entry(SPAWN_ENTRY, b),
			entry(RESULT_ENTRY, resultClaim("worker.a.0001", "error", "first", 3)),
			entry(RESULT_ENTRY, resultClaim("worker.a.0001", "done", "second", 4)),
			entry(RESULT_ENTRY, resultClaim("ghost.c.0003", "done", "no spawn on this branch", 5)),
			entry("other", { id: "worker.a.0001" }),
			entry(SPAWN_ENTRY, { id: 42 }),
			entry(SPAWN_ENTRY, a, "message"),
		]);
		assert.deepEqual([...claims.keys()], ["worker.a.0001", "scout.b.0002"]);
		assert.equal(claims.get("worker.a.0001")?.result?.summary, "second");
		assert.equal(claims.get("scout.b.0002")?.result, undefined);
	});
	it("reconciles with the store: claims without a record are unknown, store children without a claim are another branch", () => {
		const claims = claimsFromBranch([
			entry(SPAWN_ENTRY, spawnClaim(mkInput("worker.a.0001", null), 1)),
			entry(SPAWN_ENTRY, spawnClaim(mkInput("worker.gone.0002", null), 2)),
			entry(SPAWN_ENTRY, spawnClaim(mkInput("worker.fin.0003", null), 3)),
			entry(RESULT_ENTRY, resultClaim("worker.fin.0003", "done", "ok", 4)),
		]);
		const { unknown, otherBranch } = reconcileClaims(claims, [record("worker.a.0001"), record("worker.elsewhere.0009")], (id) => id !== "worker.gone.0002");
		assert.deepEqual(unknown.map((c) => c.spawn.id), ["worker.gone.0002"]); // a finished claim whose record is gone is not news
		assert.deepEqual([...otherBranch], ["worker.elsewhere.0009"]);
	});
});
