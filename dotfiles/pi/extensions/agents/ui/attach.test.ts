import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";
import { ATTACH_SCRIPT, attachArgv, TERMINAL_MODES } from "./attach.ts";

describe("attach wrapper", () => {
	it("passes the socket as $1, never interpolated into the script", () => {
		const argv = attachArgv("/tmp/a b/pty.sock");
		assert.deepEqual(argv.slice(0, 2), ["sh", "-c"]);
		assert.equal(argv.at(-1), "/tmp/a b/pty.sock");
	});
	it("replays pi's terminal modes (alt screen, mouse, paste) before attaching", () => {
		const out = execFileSync("sh", ["-c", `printf '${TERMINAL_MODES}'`], { encoding: "utf8" });
		for (const mode of ["?1049h", "?1000h", "?1002h", "?1006h", "?2004h"]) assert.ok(out.includes(`\x1b[${mode}`), mode);
		assert.ok(ATTACH_SCRIPT.indexOf("printf") < ATTACH_SCRIPT.indexOf("exec dtach"));
	});
	it("is valid shell", () => {
		execFileSync("sh", ["-n", "-c", ATTACH_SCRIPT]);
	});
});
