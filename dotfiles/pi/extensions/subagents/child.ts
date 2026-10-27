/**
 * A child `pi --mode rpc` process and its JSONL transport.
 *
 * The child reloads this same extension (`-e <dir> --no-extensions`) so it can
 * spawn further children. Its profile arrives as CLI flags; only its depth
 * travels in the environment (`PI_AGENT_DEPTH`).
 */
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { type Profile, toChildArgs } from "./profiles.ts";

export interface Child {
	pid: number | undefined;
	sessionFile: string | undefined;
	readonly lastText: string;
	readonly settled: Promise<{ aborted: boolean }>;
	prompt(message: string): Promise<void>;
	kill(force?: boolean): void;
}

export interface SpawnOptions {
	profile: Profile;
	cwd: string;
	depth: number;
	sessionFile?: string;
}

/** Run the same pi entry point that is hosting this extension. */
function piInvocation(args: string[]): { command: string; args: string[] } {
	const script = process.argv[1];
	if (script && !script.startsWith("/$bunfs/") && fs.existsSync(script)) {
		return { command: process.execPath, args: [script, ...args] };
	}
	if (/^(node|bun)(\.exe)?$/i.test(path.basename(process.execPath))) {
		return { command: "pi", args };
	}
	return { command: process.execPath, args };
}

/** Kill a whole process group. Falls back to the bare pid when the group is gone. */
export function killPid(pid: number, signal: NodeJS.Signals): void {
	if (process.platform === "win32") {
		spawn("taskkill", ["/pid", String(pid), "/T", "/F"]);
		return;
	}
	try {
		process.kill(-pid, signal);
	} catch {
		try {
			process.kill(pid, signal);
		} catch {
			// already gone
		}
	}
}

function killTree(proc: ChildProcess, force?: boolean): void {
	const pid = proc.pid;
	if (pid === undefined) return;
	killPid(pid, "SIGTERM");
	if (force) killPid(pid, "SIGKILL");
	else setTimeout(() => killPid(pid, "SIGKILL"), 5000).unref();
}

function textOf(message: unknown): string {
	const content = (message as { content?: unknown } | undefined)?.content;
	if (Array.isArray(content)) {
		return content
			.filter((part): part is { type: "text"; text: string } => (part as { type?: string }).type === "text")
			.map((part) => part.text)
			.join("");
	}
	return typeof content === "string" ? content : "";
}

function sessionId(): string {
	return `sub_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export async function spawnChild(options: SpawnOptions): Promise<Child> {
	const selfPath = path.dirname(fileURLToPath(import.meta.url));
	const args = toChildArgs(options.profile, selfPath, {
		sessionId: sessionId(),
		sessionFile: options.sessionFile,
	});

	const invocation = piInvocation(args);
	const proc = spawn(invocation.command, invocation.args, {
		cwd: options.cwd,
		detached: process.platform !== "win32",
		stdio: ["pipe", "pipe", "pipe"],
		env: {
			...process.env,
			PI_AGENT_DEPTH: String(options.depth),
		},
	});

	let buffer = "";
	let nextId = 1;
	let dead = false;
	let lastText = "";
	const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
	let settle!: (value: { aborted: boolean }) => void;
	const settled = new Promise<{ aborted: boolean }>((resolve) => (settle = resolve));

	const fail = (error: Error) => {
		if (dead) return;
		dead = true;
		for (const request of pending.values()) request.reject(error);
		pending.clear();
		settle({ aborted: true });
	};

	const handle = (line: string) => {
		let message: Record<string, any>;
		try {
			message = JSON.parse(line);
		} catch {
			return;
		}
		if (message.type === "response" && typeof message.id === "number" && pending.has(message.id)) {
			const request = pending.get(message.id)!;
			pending.delete(message.id);
			message.success ? request.resolve(message.data) : request.reject(new Error(message.error));
		} else if (message.type === "message_end" && message.message?.role === "assistant") {
			lastText = textOf(message.message);
		} else if (message.type === "agent_settled") {
			settle({ aborted: Boolean(message.aborted) });
		}
	};

	proc.on("error", fail);
	proc.on("exit", () => fail(new Error("subagent process exited")));
	proc.stdout!.on("data", (chunk: Buffer) => {
		buffer += chunk.toString("utf8");
		let newline: number;
		while ((newline = buffer.indexOf("\n")) >= 0) {
			handle(buffer.slice(0, newline));
			buffer = buffer.slice(newline + 1);
		}
	});

	const request = (command: Record<string, unknown>): Promise<unknown> => {
		if (dead) return Promise.reject(new Error("subagent process is not running"));
		const id = nextId++;
		return new Promise((resolve, reject) => {
			pending.set(id, { resolve, reject });
			proc.stdin!.write(JSON.stringify({ id, ...command }) + "\n");
		});
	};

	// Learn the persisted session path so this subagent can be resumed later.
	let sessionFile = options.sessionFile;
	try {
		const state = (await request({ type: "get_state" })) as { sessionFile?: string } | undefined;
		sessionFile = state?.sessionFile ?? sessionFile;
	} catch {
		// leave undefined; the subagent still runs, just is not resumable
	}

	return {
		pid: proc.pid,
		sessionFile,
		get lastText() {
			return lastText;
		},
		settled,
		async prompt(message: string) {
			await request({ type: "prompt", message });
		},
		kill(force?: boolean) {
			killTree(proc, force);
		},
	};
}
