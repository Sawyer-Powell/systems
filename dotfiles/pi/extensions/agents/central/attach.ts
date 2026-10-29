/** Native dtach attachment, with a lease inherited by the actual client (fd3). No chat UI. */
import { spawn, execFileSync } from "node:child_process";
import { RuntimeClient } from "./ipc.ts";
const id = process.argv[2];
if (!id || !process.stdin.isTTY) throw new Error("Usage: node --experimental-strip-types central/attach.ts <agent-id> (in a terminal)");
const client = new RuntimeClient();
await client.connect();
const { lease } = await client.request("attach", { id });
let socket: string | undefined;
const deadline = Date.now() + 35_000;
while (!socket && Date.now() < deadline) {
	const ready = await client.request("attach-ready", { lease });
	socket = ready?.socket;
	if (!socket) await new Promise(resolve => setTimeout(resolve, 50));
}
if (!socket) { process.stderr.write("Agent did not become attachable; inspect /agents details.\n"); process.exit(1); }
process.stdout.write("\x1b[?1049h\x1b[?7l\x1b[?1000h\x1b[?1002h\x1b[?1004h\x1b[?1006h\x1b[?2004h");
const child = spawn("dtach", ["-a", socket, "-r", "winch"], { stdio: ["inherit", "inherit", "inherit", client.leaseSocket()] });
// A wrapper crash does NOT close the lease: the actual dtach client owns fd3 too.
// Never send explicit release or socket.end(): shutdown affects both copies.
child.once("error", error => { process.stderr.write(`${error.message}\n`); process.exit(1); });
child.once("exit", code => process.exit(code ?? 0));
const cols = process.stdout.columns;
if (cols > 2) setTimeout(() => {
	try {
		execFileSync("stty", ["cols", String(cols - 1)], { stdio: "inherit" });
		setTimeout(() => { try { execFileSync("stty", ["cols", String(cols)], { stdio: "inherit" }); } catch {} }, 150);
	} catch {}
}, 300);
