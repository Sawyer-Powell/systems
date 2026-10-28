import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { insertAtRunPosition } from "./orientation-position.ts";

describe("insertAtRunPosition", () => {
	it("puts the block at the end on the first call of a run and reports that position", () => {
		assert.deepEqual(insertAtRunPosition(["u1", "a1", "u2"], "O", undefined), { messages: ["u1", "a1", "u2", "O"], at: 3 });
	});
	it("keeps the block at the same position as the run grows, so each call extends the previous prefix", () => {
		const first = insertAtRunPosition(["u1", "u2"], "O", undefined);
		const second = insertAtRunPosition(["u1", "u2", "a", "t"], "O", first.at);
		assert.deepEqual(second.messages, ["u1", "u2", "O", "a", "t"]);
		assert.deepEqual(second.messages.slice(0, first.messages.length), first.messages);
	});
	it("clamps when the history shrank (for example after compaction)", () => {
		assert.deepEqual(insertAtRunPosition(["u"], "O", 5), { messages: ["u", "O"], at: 1 });
	});
});
