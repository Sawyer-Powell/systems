import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkInput } from "../test-support.ts";
import { resumeMessage } from "./index.ts";
import { DEFAULT_REPORTING, SIGNALING_RULES, withReporting } from "./signaling.ts";

describe("parent signaling contract", () => {
	it("defaults omitted/blank policies to quiet without replacing the objective", () => {
		for (const reporting of [undefined, "", "  \n "]) {
			const objective = withReporting("Inspect files; do not edit.", reporting);
			assert.ok(objective.startsWith("Inspect files; do not edit.\n\n"));
			assert.ok(objective.includes(SIGNALING_RULES));
			assert.ok(objective.includes(DEFAULT_REPORTING));
			assert.match(objective, /Unless the objective explicitly specifies otherwise/);
			assert.match(objective, /at most 200 words/);
		}
	});
	it("carries explicit triggers and final format without adding a conflicting quiet default", () => {
		const reporting = "Notify once if benchmark regresses >10%. Final: three bullets, <=100 words.";
		const objective = withReporting("Build benchmark", `  ${reporting}\n`);
		assert.ok(objective.endsWith(reporting));
		assert.ok(!objective.includes(DEFAULT_REPORTING));
		assert.ok(objective.includes(SIGNALING_RULES));
		assert.match(objective, /one message per requested trigger/);
	});
	it("retains the encoded policy in interrupted-task resume instructions", () => {
		const objective = withReporting("Inspect files", "Blocking only; final: paths and evidence.");
		const input = mkInput("worker.a.0001", "main.r.0002", { objective });
		const resumed = resumeMessage(input, "blocked", undefined);
		assert.ok(resumed.includes(objective));
	});
});
