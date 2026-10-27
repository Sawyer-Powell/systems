/**
 * Pane-side bridge for the pi process kind.
 *
 * pi's RPC mode speaks JSONL on stdin/stdout, but a zellij pane gives the
 * process a pty. This shim owns both: it spawns `pi --mode rpc`, listens on a
 * unix socket, forwards socket lines to the child's stdin and the child's
 * stdout to every connected client, and paints a live transcript on the pane so
 * a human can watch the child work.
 *
 * Usage: node pi-shim.mjs <socket-path> <command> [args...]
 *
 * Each client connection is independent; the kind opens one per message. When
 * no client is connected the child's output is still rendered to the pane, so
 * nothing is lost visually, only from the protocol stream.
 */
import net from "node:net";
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";

const argv = process.argv.slice(2);
const socketPath = argv[0];
const command = argv[1];
const commandArgs = argv.slice(2);
if (!socketPath || !command) {
	process.stderr.write("pi-shim: usage: <socket-path> <command> [args...]\n");
	process.exit(2);
}

// The child is a fresh session: never let it inherit the host's session identity.
const env = { ...process.env };
delete env.PI_SESSION_ID;
delete env.PI_SESSION_FILE;

const child = spawn(command, commandArgs, { stdio: ["pipe", "pipe", "pipe"], env });
const clients = new Set();
let outBuffer = "";

function pane(text) {
	process.stdout.write(text);
}

/** Minimal transcript: assistant text and tool activity, no raw JSON. */
function render(record) {
	const type = record && record.type;
	if (type === "message_update") {
		const event = record.assistantMessageEvent || {};
		if (event.type === "text_delta" && typeof event.delta === "string") pane(event.delta);
		return;
	}
	if (type === "message_end" && record.message && record.message.role === "assistant") {
		pane("\n");
		return;
	}
	if (type === "tool_execution_start") {
		pane("\n[tool] " + record.toolName + "\n");
		return;
	}
	if (type === "agent_settled") {
		pane("\n");
		return;
	}
	if (type === "compaction_start") {
		pane("\n[compacting]\n");
		return;
	}
	if (type === "retry_scheduled") {
		pane("\n[retrying]\n");
	}
}

function broadcast(text) {
	for (const client of clients) {
		try {
			client.write(text);
		} catch {}
	}
}

function finish(code) {
	for (const client of clients) {
		try {
			client.end();
		} catch {}
	}
	try {
		server.close();
	} catch {}
	try {
		rmSync(socketPath, { force: true });
	} catch {}
	process.exit(code);
}

const server = net.createServer((client) => {
	clients.add(client);
	client.setEncoding("utf8");
	let inbound = "";
	client.on("data", (chunk) => {
		inbound += chunk;
		let index;
		while ((index = inbound.indexOf("\n")) !== -1) {
			const line = inbound.slice(0, index);
			inbound = inbound.slice(index + 1);
			if (!line.trim()) continue;
			try {
				const record = JSON.parse(line);
				if (record.type === "prompt" || record.type === "steer" || record.type === "follow_up") {
					pane("\n> " + String(record.message).replace(/\n/g, "\n  ") + "\n\n");
				}
			} catch {}
			try {
				child.stdin.write(line + "\n");
			} catch {}
		}
	});
	client.on("error", () => clients.delete(client));
	client.on("close", () => clients.delete(client));
});

child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
	broadcast(chunk);
	outBuffer += chunk;
	let index;
	while ((index = outBuffer.indexOf("\n")) !== -1) {
		const line = outBuffer.slice(0, index);
		outBuffer = outBuffer.slice(index + 1);
		if (!line.trim()) continue;
		try {
			render(JSON.parse(line));
		} catch {}
	}
});
child.stderr.on("data", (chunk) => process.stderr.write(chunk));
child.on("error", (error) => {
	process.stderr.write("pi-shim: " + error.message + "\n");
	finish(1);
});
child.on("exit", (code, signal) => {
	pane("\n[pi exited" + (signal ? " on " + signal : " with code " + code) + "]\n");
	finish(code || 0);
});

try {
	rmSync(socketPath, { force: true });
} catch {}
server.on("error", (error) => {
	process.stderr.write("pi-shim: socket error: " + error.message + "\n");
	finish(1);
});
server.listen(socketPath, () => pane("pi (rpc) ready\n\n"));

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
	process.on(signal, () => {
		try {
			child.kill(signal);
		} catch {}
	});
}
