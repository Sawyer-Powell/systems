import assert from "node:assert/strict";
import { test } from "node:test";
import { attachArgv } from "./attach.ts";

test("managed attachment passes home and identity as separate argv without raw dtach", () => {
	const argv = attachArgv("worker.test.0001", "/tmp/home with spaces");
	assert.deepEqual(argv.slice(0, 2), ["env", "PI_AGENTS_HOME=/tmp/home with spaces"]);
	assert.equal(argv.at(-1), "worker.test.0001");
	assert.match(argv.at(-2)!, /central\/attach\.ts$/);
	assert.ok(!argv.includes("dtach"));
});
