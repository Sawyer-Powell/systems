/**
 * pi process kind.
 *
 * Launches a second pi instance in a pane or tab, driven over pi's RPC mode.
 * RPC is JSONL on stdin/stdout, and a pane gives us a pty rather than pipes, so
 * the kind puts a tiny shim between them: the shim spawns `pi --mode rpc`, owns
 * a unix socket, and bridges JSONL both ways while painting a live transcript on
 * the pane so the user can watch the child work.
 *
 * One message is one short-lived socket connection, matching nvim's
 * `--remote-expr` model: no long-lived client to babysit.
 *
 * Nothing here lets the model choose a command line. `config` only carries pi's
 * own flags (model, tools, session), and the socket path is kind-owned.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import type { ProcessKind, ProcessMessage, ProcessRecord, SendResult, SpawnSpec } from "../protocol.ts";

const PiConfig = Type.Object({
	prompt: Type.Optional(Type.String({ description: "Initial prompt to send once the process is up." })),
	model: Type.Optional(Type.String({ description: "Model pattern, e.g. 'anthropic/claude-sonnet-4'." })),
	name: Type.Optional(Type.String({ description: "Session display name (also the pane title)." })),
	tools: Type.Optional(Type.String({ description: "Comma-separated tool allowlist for the child." })),
	sessionId: Type.Optional(
		Type.String({ description: "Exact session id to use, created if missing. Defaults to a fresh one." }),
	),
	noSession: Type.Optional(Type.Boolean({ description: "Do not persist a session file." })),
});

const PromptMessage = Type.Object({
	type: Type.Literal("prompt"),
	message: Type.String({ description: "User message to deliver to the pi process." }),
	mode: Type.Optional(
		Type.Union([Type.Literal("steer"), Type.Literal("followUp")], {
			description: "How to queue the message if the process is already running. Omit to require an idle process.",
		}),
	),
	waitSeconds: Type.Optional(
		Type.Number({
			description: "Wait this long for the run to settle and return the reply. Default 60; 0 returns immediately.",
		}),
	),
});

const WaitMessage = Type.Object({
	type: Type.Literal("wait"),
	timeoutSeconds: Type.Optional(
		Type.Number({ description: "How long to wait for the current run to settle. Default 120." }),
	),
});

const AbortMessage = Type.Object({ type: Type.Literal("abort") });
const StateMessage = Type.Object({ type: Type.Literal("state") });
const LastMessage = Type.Object({ type: Type.Literal("last") });

const PiMessage = Type.Union([PromptMessage, WaitMessage, AbortMessage, StateMessage, LastMessage]);

/** Default wait for an accepted prompt to finish before returning control. */
const DEFAULT_WAIT_SECONDS = 60;
const MAX_TEXT = 20_000;

interface PiRuntime {
	/** Control socket. Absent for siblings, which have no channel. */
	socket?: string;
	/** Metadata: the session the child was started with, so it can be resumed. */
	sessionId: string | null;
}

interface RpcRecord {
	type?: string;
	[key: string]: unknown;
}

interface RpcResponse extends RpcRecord {
	success?: boolean;
	error?: string;
	data?: Record<string, unknown>;
}


/**
 * One JSONL control connection to a shim. Records are split on LF only, as the
 * RPC framing requires.
 */
class RpcConnection {
	private buffer = "";
	private failure: Error | undefined;
	private pending: Array<{
		pred: (record: RpcRecord) => boolean;
		resolve: (record: RpcRecord) => void;
		reject: (error: Error) => void;
		timer?: NodeJS.Timeout;
	}> = [];

	private constructor(private readonly socket: net.Socket) {
		socket.setEncoding("utf8");
		socket.on("data", (chunk: string) => this.onData(chunk));
		socket.on("error", (error) => this.fail(error));
		socket.on("close", () => this.fail(new Error("the pi process closed its control socket")));
	}

	static open(socketPath: string, timeoutMs = 3000): Promise<RpcConnection> {
		return new Promise((resolve, reject) => {
			const socket = net.createConnection({ path: socketPath });
			const timer = setTimeout(() => {
				socket.destroy();
				reject(new Error(`timed out connecting to ${socketPath}`));
			}, timeoutMs);
			socket.once("connect", () => {
				clearTimeout(timer);
				resolve(new RpcConnection(socket));
			});
			socket.once("error", (error) => {
				clearTimeout(timer);
				reject(error);
			});
		});
	}

	send(command: Record<string, unknown>): void {
		if (this.failure) throw this.failure;
		this.socket.write(`${JSON.stringify(command)}\n`);
	}

	/** Resolves with the first matching record, or `null` on timeout. */
	wait(pred: (record: RpcRecord) => boolean, timeoutMs?: number): Promise<RpcRecord | null> {
		if (this.failure) return Promise.reject(this.failure);
		return new Promise((resolve, reject) => {
			const entry = { pred, resolve, reject, timer: undefined as NodeJS.Timeout | undefined };
			if (timeoutMs !== undefined) {
				entry.timer = setTimeout(() => {
					this.pending = this.pending.filter((item) => item !== entry);
					resolve(null);
				}, timeoutMs);
			}
			this.pending.push(entry);
		});
	}

	close(): void {
		this.socket.destroy();
	}

	private onData(chunk: string): void {
		this.buffer += chunk;
		let index: number;
		while ((index = this.buffer.indexOf("\n")) !== -1) {
			const line = this.buffer.slice(0, index).replace(/\r$/, "");
			this.buffer = this.buffer.slice(index + 1);
			if (!line.trim()) continue;
			let record: RpcRecord;
			try {
				record = JSON.parse(line) as RpcRecord;
			} catch {
				continue;
			}
			this.dispatch(record);
		}
	}

	private dispatch(record: RpcRecord): void {
		for (const entry of [...this.pending]) {
			if (!entry.pred(record)) continue;
			if (entry.timer) clearTimeout(entry.timer);
			this.pending = this.pending.filter((item) => item !== entry);
			entry.resolve(record);
		}
	}

	private fail(error: Error): void {
		this.failure ??= error;
		for (const entry of this.pending) {
			if (entry.timer) clearTimeout(entry.timer);
			entry.reject(this.failure);
		}
		this.pending = [];
	}
}

function socketOf(record: ProcessRecord): string {
	const socket = record.runtime.socket;
	if (typeof socket !== "string" || socket.length === 0) {
		throw new Error(`pi: process ${record.handle} has no control socket`);
	}
	return socket;
}

function sessionOf(record: ProcessRecord): string | null {
	const sessionId = record.runtime.sessionId;
	return typeof sessionId === "string" && sessionId.length > 0 ? sessionId : null;
}

/** The pane-side bridge script, shipped beside this file. */
function shimPath(): string {
	return path.join(path.dirname(fileURLToPath(import.meta.url)), "pi-shim.mjs");
}

/** The JS runtime for the shim: the one running pi, unless pi is a standalone binary. */
function shimRuntime(): string {
	const name = path.basename(process.execPath).toLowerCase();
	return /^(node|bun)(\.exe)?$/.test(name) ? process.execPath : "node";
}

/** Invoke the same pi the host is running, falling back to PATH. */
function piInvocation(): string[] {
	const script = process.argv[1];
	if (script && !script.startsWith("/$bunfs/") && /\.(m?js|cjs)$/.test(script) && existsSync(script)) {
		return [process.execPath, script];
	}
	return ["pi"];
}

async function command(
	conn: RpcConnection,
	type: string,
	extra: Record<string, unknown> = {},
	timeoutMs = 15_000,
): Promise<RpcResponse> {
	const id = randomBytes(4).toString("hex");
	conn.send({ id, type, ...extra });
	const record = await conn.wait((entry) => entry.type === "response" && entry.id === id, timeoutMs);
	if (!record) throw new Error(`pi did not answer "${type}" within ${Math.round(timeoutMs / 1000)}s`);
	return record as RpcResponse;
}

function requireSuccess(response: RpcResponse, what: string, handle: string): Record<string, unknown> {
	if (response.success) return (response.data ?? {}) as Record<string, unknown>;
	throw new Error(`pi ${handle}: ${what} failed: ${response.error ?? "unknown error"}`);
}

function trim(text: string): string {
	return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}\n[truncated ${text.length - MAX_TEXT} characters]` : text;
}

async function lastAssistantText(conn: RpcConnection, handle: string): Promise<string | null> {
	const response = await command(conn, "get_last_assistant_text");
	const data = requireSuccess(response, "get_last_assistant_text", handle);
	return typeof data.text === "string" ? data.text : null;
}

/** Wait for the current run to settle, then collect the reply. */
async function settleAndCollect(
	conn: RpcConnection,
	handle: string,
	timeoutSeconds: number,
	prefix: string,
): Promise<SendResult> {
	const settled = await conn.wait((record) => record.type === "agent_settled", timeoutSeconds * 1000);
	if (!settled) {
		return {
			text: `${prefix} still running after ${timeoutSeconds}s; send { type: "wait" } to collect the reply.`,
			details: { handle, settled: false, waiting: true },
		};
	}
	const text = await lastAssistantText(conn, handle);
	if (!text) {
		return { text: `${prefix} settled with no assistant text.`, details: { handle, settled: true, text: null } };
	}
	return { text: `${prefix} reply:\n${trim(text)}`, details: { handle, settled: true, text } };
}

function describeState(data: Record<string, unknown>): string {
	const model = data.model as { id?: string } | undefined;
	const parts = [
		`model=${model?.id ?? "none"}`,
		`thinking=${String(data.thinkingLevel ?? "?")}`,
		`streaming=${data.isStreaming === true ? "yes" : "no"}`,
		`messages=${String(data.messageCount ?? "?")}`,
	];
	if (Number(data.pendingMessageCount ?? 0) > 0) parts.push(`pending=${String(data.pendingMessageCount)}`);
	if (typeof data.sessionId === "string") parts.push(`session=${data.sessionId}`);
	return parts.join(" ");
}

export function createPiKind(): ProcessKind {
	return {
		name: "pi",
		description:
			"A second pi agent in its own pane or tab. As a child it is driven over RPC (messages: prompt, wait, abort, state, last); as a sibling it runs the normal interactive TUI for you to drive.",
		relations: ["child", "sibling"],
		configSchema: PiConfig,
		messageTypes: ["prompt", "wait", "abort", "state", "last"],
		messageSchema: PiMessage,

		spawn(config, cwd, relation): SpawnSpec {
			const sessionId = config.noSession === true ? null : String(config.sessionId ?? randomUUID());
			const args = relation === "child" ? ["--mode", "rpc"] : [];
			if (sessionId) args.push("--session-id", sessionId);
			else args.push("--no-session");
			if (config.model !== undefined) args.push("--model", String(config.model));
			if (config.name !== undefined) args.push("--name", String(config.name));
			if (config.tools !== undefined) args.push("--tools", String(config.tools));
			if (relation === "sibling" && typeof config.prompt === "string" && config.prompt.length > 0) {
				// An interactive pi takes the opening message positionally.
				args.push("--", config.prompt);
			}

			const [command, ...commandArgs] = piInvocation();
			const label = config.name === undefined ? path.basename(cwd) : String(config.name);
			if (relation === "sibling") {
				// No shim, no socket: the pane runs pi's own TUI. The session id is
				// metadata only, so the user (or a later agent) can resume it.
				return {
					argv: [command, ...commandArgs, ...args],
					runtime: { sessionId } satisfies PiRuntime,
					name: `pi: ${label}`,
					cwd,
				};
			}
			const socket = `/tmp/pi-pane-${randomBytes(6).toString("hex")}.sock`;
			const argv = [shimRuntime(), shimPath(), socket, command, ...commandArgs, ...args];
			return {
				argv,
				runtime: { socket, sessionId } satisfies PiRuntime,
				name: `pi: ${label}`,
				cwd,
			};
		},

		spawnNote(record: ProcessRecord): string {
			const sessionId = sessionOf(record);
			return sessionId ? `Session ${sessionId}.` : "Ephemeral session (no session file).";
		},

		async afterSpawn(record: ProcessRecord): Promise<string | undefined> {
			const prompt = record.config.prompt;
			if (typeof prompt !== "string" || prompt.length === 0) return undefined;

			const conn = await RpcConnection.open(socketOf(record));
			try {
				const response = await command(conn, "prompt", { message: prompt });
				const data = requireSuccess(response, "prompt", record.handle);
				return `Initial prompt accepted (${String(data.disposition ?? "started")}).`;
			} finally {
				conn.close();
			}
		},

		async send(record: ProcessRecord, message: ProcessMessage): Promise<SendResult> {
			const handle = record.handle;
			const socket = socketOf(record);
			const conn = await RpcConnection.open(socket).catch((error: unknown) => {
				const detail = error instanceof Error ? error.message : String(error);
				throw new Error(`pi ${handle}: cannot reach the process on ${socket}: ${detail}`);
			});
			try {
				if (message.type === "prompt") {
					const extra: Record<string, unknown> = { message: String(message.message) };
					if (message.mode !== undefined) extra.streamingBehavior = message.mode;
					const response = await command(conn, "prompt", extra);
					if (!response.success) {
						const error = response.error ?? "prompt rejected";
						const hint = /stream/i.test(error)
							? ' It is already running; pass mode: "steer" to queue the message.'
							: "";
						throw new Error(`pi ${handle}: prompt failed: ${error}.${hint}`);
					}
					const data = (response.data ?? {}) as Record<string, unknown>;
					const disposition = String(data.disposition ?? "started");
					const prefix = `pi ${handle}: prompt accepted (${disposition}).`;
					const waitSeconds =
						message.waitSeconds === undefined ? DEFAULT_WAIT_SECONDS : Math.max(0, Number(message.waitSeconds));
					if (disposition === "handled" || waitSeconds === 0) {
						return { text: prefix, details: { handle, disposition, waiting: disposition !== "handled" } };
					}
					return await settleAndCollect(conn, handle, waitSeconds, prefix);
				}

				if (message.type === "wait") {
					const timeoutSeconds =
						message.timeoutSeconds === undefined ? 120 : Math.max(0, Number(message.timeoutSeconds));
					const state = await command(conn, "get_state");
					const data = requireSuccess(state, "get_state", handle);
					if (data.isStreaming !== true) {
						const text = await lastAssistantText(conn, handle);
						const body = text ? `last reply:\n${trim(text)}` : "idle, no assistant text yet.";
						return { text: `pi ${handle}: ${body}`, details: { handle, settled: true, text } };
					}
					return await settleAndCollect(conn, handle, timeoutSeconds, `pi ${handle}:`);
				}

				if (message.type === "abort") {
					requireSuccess(await command(conn, "abort", {}, 60_000), "abort", handle);
					return { text: `pi ${handle}: aborted.`, details: { handle } };
				}

				if (message.type === "state") {
					const data = requireSuccess(await command(conn, "get_state"), "get_state", handle);
					return {
						text: `pi ${handle}: ${describeState(data)}`,
						details: { handle, state: data },
					};
				}

				if (message.type === "last") {
					const text = await lastAssistantText(conn, handle);
					return {
						text: text ? `pi ${handle}: last reply:\n${trim(text)}` : `pi ${handle}: no assistant text yet.`,
						details: { handle, text },
					};
				}

				throw new Error(`pi: unsupported message "${message.type}"`);
			} finally {
				conn.close();
			}
		},

		alive(record): boolean {
			const socket = record.runtime.socket;
			return typeof socket === "string" && existsSync(socket);
		},
	};
}
