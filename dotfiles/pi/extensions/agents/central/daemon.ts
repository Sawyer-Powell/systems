/** One local owner of metadata, durable mail, processes and the next live deadline. */
import * as fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import * as net from "node:net";
import * as path from "node:path";
import * as readline from "node:readline";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openDatabase, runtimeHome, type Owner } from "./database.ts";
import { frames, send, socketPath } from "./ipc.ts";
import { buildChildArgs, killGroup } from "../supervisor/launch.ts";
import { agentToolNames } from "../tool-names.ts";
import { processStartTime, stallOf, deliveryForParent } from "../store/store.ts";
import { LOST_DONE_SUMMARY } from "../store/done.ts";
import { MODEL_FIRST_EVENT_MS, MODEL_SILENCE_MS, OVERRUN_GRACE_MS } from "../store/types.ts";

interface Live {
	id: string; owner: Owner; child?: ChildProcess; bridge?: net.Socket;
	attachments: Set<string>; unknownAttachment: boolean; settled: boolean;
	parkAt?: number; startupAt?: number; runAt?: number; stallAt?: number; stallKey?: string;
	parking: boolean; safeExit: boolean; wakeAfterExit: boolean; delivery?: string;
}
const alive = (pid?: number) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; } };
export async function startDaemon(home = runtimeHome()) {
	fs.mkdirSync(home, { recursive: true, mode: 0o700 });
	// A separate SQLite transaction is a kernel-released singleton lock. Never unlink/reclaim a
	// PID file: concurrent stale-lock reclamation can create two metadata writers.
	const singleton = new DatabaseSync(path.join(home, "daemon-lock.sqlite"));
	try { singleton.exec("PRAGMA busy_timeout=0; BEGIN EXCLUSIVE"); }
	catch { singleton.close(); throw new Error("Runtime daemon already running"); }
	const database = openDatabase(home, true), { db, store } = database;
	const live = new Map<string, Live>();
	const clients = new Set<net.Socket>();
	const subscribers = new Set<net.Socket>();
	const attachments = new Map<string, { socket: net.Socket; agent: string }>();
	const idleMs = Number(process.env.PI_AGENTS_IDLE_MS ?? 60_000);
	const cap = Number(process.env.PI_AGENTS_MAX_LIVE ?? 8);
	if (!Number.isFinite(idleMs) || idleMs < 100 || !Number.isInteger(cap) || cap < 1) throw new Error("Invalid runtime limits");
	let timer: ReturnType<typeof setTimeout> | undefined;
	let closing = false;
	let commandChain = Promise.resolve();
	const managedCount = () => [...live.values()].filter(l => Boolean(store.readInput(l.id)?.parent)).length;
	// Startup is the only store-wide reconciliation. Unknown old ownership is fenced, never replayed.
	for (const r of db.prepare("SELECT id,residency,owner FROM agents WHERE residency!='parked'").all()) {
		const owner: Owner | undefined = r.owner ? JSON.parse(String(r.owner)) : undefined;
		if (!owner && store.readInput(String(r.id))?.parent === null) database.setRuntime(String(r.id), "parked");
		else {
			database.setRuntime(String(r.id), "blocked", owner);
			store.writeState(String(r.id), { summary: "Runtime restarted with an interrupted or ambiguous owner; explicit resume required." });
		}
	}
	function lifecycle(fn: () => void) {
		commandChain = commandChain.then(() => { if (!closing) fn(); }).catch(error => { process.stderr.write(`[agents] lifecycle: ${String(error)}\n`); });
	}
	function changed(id: string, kind = "state") {
		db.prepare("INSERT INTO events(agent,kind,at) VALUES(?,?,?)").run(id, kind, Date.now());
		// Events are invalidations, never token streams or message contents.
		for (const socket of subscribers) { try { send(socket, { event: "changed", data: { id, kind } }); } catch {} }
	}
	function persist(l: Live, residency: "starting" | "live" | "parking") {
		l.owner.settled = l.settled; database.setRuntime(l.id, residency, l.owner); changed(l.id);
	}
	function rawAttached(id: string) {
		try { return Boolean(fs.statSync(store.ptySocket(id)).mode & 0o100); } catch { return false; }
	}
	function schedule() {
		if (timer) clearTimeout(timer); timer = undefined;
		let next = Infinity;
		for (const l of live.values()) for (const at of [l.parkAt, l.startupAt, l.runAt, l.stallAt]) if (at !== undefined) next = Math.min(next, at);
		if (Number.isFinite(next) && !closing) timer = setTimeout(() => lifecycle(deadlines), Math.max(1, next - Date.now()));
	}
	function stallDeadline(l: Live): number | undefined {
		const record = store.record(l.id), state = record?.state;
		if (l.settled || !state || !["working", "starting"].includes(state.status)) return undefined;
		const step = state.activity.inFlight;
		if (step?.deadline !== undefined) return step.deadline + OVERRUN_GRACE_MS + 1;
		const since = Math.max(state.activity.lastEventAt, step?.startedAt ?? 0);
		const modelLimit = state.activity.lastEventAt <= (step?.startedAt ?? 0) ? MODEL_FIRST_EVENT_MS : MODEL_SILENCE_MS;
		const limit = step?.kind === "model" && record!.input.stepTimeoutMs >= MODEL_SILENCE_MS ? modelLimit : record!.input.stepTimeoutMs;
		return since + limit + 1;
	}
	function idle(l: Live) {
		l.parkAt = l.settled && !l.parking && !l.attachments.size && !l.unknownAttachment && !l.delivery && !store.readInbox(l.id).length ? Date.now() + idleMs : undefined;
		schedule();
	}
	function pump(l: Live) {
		if (!l.bridge || l.parking || l.delivery) return;
		const message = store.readInbox(l.id)[0];
		if (!message) { idle(l); return; }
		l.parkAt = undefined; l.delivery = message.id;
		if (message.deliver === "context" && (message.kind !== "control" || message.control === "done")) { l.settled = false; l.stallAt = stallDeadline(l); }
		send(l.bridge, { event: "mail", data: message }); persist(l, "live"); schedule();
	}
	async function reconcile(id: string) {
		const file = store.readState(id)?.sessionFile;
		if (!file || !fs.existsSync(file)) return;
		const pending = new Set(store.readInbox(id).map(m => m.id));
		if (!pending.size) return;
		const receipts: [string, string][] = [];
		const lines = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
		for await (const line of lines) {
			try {
				const entry = JSON.parse(line);
				const messageId = entry.type === "custom_message" && entry.customType === "agent_message" ? entry.details?.id
					: entry.type === "custom" && entry.customType === "agents.receipt" ? entry.data?.id : undefined;
				if (pending.has(messageId)) receipts.push([messageId, entry.id]);
			} catch {} // incomplete final line is not a receipt
		}
		if (!receipts.length) return;
		const fd = fs.openSync(file, "r"); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
		for (const [messageId, entryId] of receipts) db.prepare("UPDATE messages SET receipt=? WHERE id=? AND recipient=?").run(entryId, messageId, id);
	}
	function work() {
		if (closing || managedCount() >= cap) return;
		const ready = db.prepare(`SELECT DISTINCT a.id FROM messages m JOIN agents a ON a.id=m.recipient
		 WHERE m.receipt IS NULL AND a.residency='parked' AND a.parent IS NOT NULL
		 AND json_extract(m.payload,'$.deliver')='context' ORDER BY m.seq LIMIT ?`).all(cap - managedCount());
		for (const row of ready) wake(String(row.id));
	}
	function wake(id: string, foreground = false, explicit = false) {
		const existing = live.get(id);
		if (existing) { if (existing.parking) existing.wakeAfterExit = true; return; }
		const input = store.readInput(id), runtime = database.runtime(id);
		if (!input || !runtime) throw new Error(`Unknown agent ${id}`);
		if (!input.parent) return; // human roots are clients, never managed runners
		if (runtime.residency === "blocked") {
			if (!explicit) throw new Error("Interrupted agent requires explicit resume");
			// Even an explicit resume cannot steal a possibly live session writer/master.
			if (runtime.owner && (alive(runtime.owner.pid) || alive(runtime.owner.master) || !runtime.owner.pid)) throw new Error("Old execution owner is still live or ambiguous; refusing a second writer");
		}
		if (!foreground && managedCount() >= cap) return;
		if (explicit) store.writeState(id, { status: "idle", summary: undefined, note: undefined, waitingOn: undefined, runStartedAt: Date.now(), activity: { lastEventAt: Date.now(), lastSeenAt: Date.now(), inFlight: null } });
		const owner: Owner = { token: crypto.randomUUID(), settled: false };
		const l: Live = { id, owner, settled: false, attachments: new Set(), unknownAttachment: false, parking: false, safeExit: false, wakeAfterExit: false, startupAt: Date.now() + 30_000 };
		live.set(id, l); persist(l, "starting");
		try {
			fs.rmSync(store.ptySocket(id), { force: true });
			const savedSession = store.readState(id)?.sessionFile;
			const args = buildChildArgs(input, input.profile, { message: "", dir: store.dir(id), sessionFile: savedSession && fs.existsSync(savedSession) ? savedSession : undefined,
				headless: false, extraTools: agentToolNames(input.interactable, input.interactable && input.depth < (input.spawnDepthLimit ?? 3)) });
			const command = process.env.PI_AGENTS_PI ?? "pi";
			const fd = fs.openSync(store.logPath(id), "a", 0o600);
			const child = spawn("dtach", ["-N", store.ptySocket(id), "-r", "winch", command, ...args], {
				cwd: input.cwd, env: { ...process.env, PI_AGENTS_HOME: home, PI_AGENTS_OWNER: owner.token, PI_AGENTS_ID: id },
				stdio: ["ignore", fd, fd], detached: true,
			});
			fs.closeSync(fd); l.child = child; owner.master = child.pid; persist(l, "starting");
			child.once("error", error => lifecycle(() => { store.writeState(id, { status: "error", summary: `Launch failed: ${error.message}` }); exited(l); }));
			child.once("exit", () => lifecycle(() => exited(l)));
		} catch (error) { store.writeState(id, { status: "error", summary: String(error) }); exited(l); throw error; }
		schedule();
	}
	function exited(l: Live) {
		if (live.get(l.id) !== l) return;
		live.delete(l.id);
		// A foreground dtach master exited, but a live Pi PID is still ambiguous.
		const safe = l.safeExit && !alive(l.owner.pid);
		database.setRuntime(l.id, safe ? "parked" : "blocked", safe ? undefined : l.owner);
		if (!safe) {
			store.writeState(l.id, { summary: "Execution exited unexpectedly; explicit resume required. No tools were automatically replayed." });
			const parent = store.readInput(l.id)?.parent;
			if (parent) accept({ from: l.id, to: parent, kind: "stall", body: "Execution exited; explicit recovery required. No tools were automatically replayed.", deliver: deliveryForParent(store, parent) });
		}
		changed(l.id, "exit");
		if (safe && (l.wakeAfterExit || store.readInbox(l.id).some(m => m.deliver === "context"))) {
			wake(l.id, l.wakeAfterExit);
			const next = live.get(l.id);
			if (next) { next.attachments = l.attachments; next.unknownAttachment = l.unknownAttachment; }
		}
		work(); schedule();
	}
	function deadlines() {
		const now = Date.now();
		for (const l of live.values()) {
			if (l.startupAt && l.startupAt <= now) {
				l.startupAt = undefined; store.writeState(l.id, { status: "error", summary: "Runner did not complete ownership handshake; ownership is ambiguous. Inspect its log and owner before recovery." }); database.setRuntime(l.id, "blocked", l.owner); changed(l.id);
				// Do not assume a missing bridge proves a missing writer.
			}
			if (l.runAt && l.runAt <= now) {
				l.runAt = undefined; store.writeState(l.id, { status: "timed-out", summary: "Whole-run timeout exceeded" });
				if (l.bridge) send(l.bridge, { event: "stop", data: {} }); changed(l.id);
			}
			if (l.stallAt && l.stallAt <= now) {
				l.stallAt = undefined;
				const record = store.record(l.id)!; const report = stallOf(record, now);
				if (report && report.kind !== l.stallKey) {
					l.stallKey = report.kind;
					if (record.input.parent) accept({ from: l.id, to: record.input.parent, kind: "stall", body: `${report.kind}: ${report.detail}`, deliver: deliveryForParent(store, record.input.parent) });
					changed(l.id, "stall");
				}
			}
			if (l.parkAt && l.parkAt <= now) {
				l.parkAt = undefined;
				if (rawAttached(l.id)) { l.unknownAttachment = true; continue; }
				if (l.settled && !l.attachments.size && !l.unknownAttachment && !l.delivery && !store.readInbox(l.id).length && l.bridge) {
					l.parking = true; persist(l, "parking"); send(l.bridge, { event: "park", data: {} });
				}
			}
		}
		schedule();
	}
	function accept(partial: Parameters<typeof store.send>[0]) {
		const message = store.send(partial); changed(message.to, "mail");
		const l = live.get(message.to);
		if (l) { if (l.parking && message.deliver === "context") l.wakeAfterExit = true; else pump(l); }
		else if (message.deliver === "context" && database.runtime(message.to)?.residency === "parked") wake(message.to);
		return message;
	}
	const server = net.createServer(socket => {
		clients.add(socket); subscribers.add(socket);
		let identity: string | undefined;
		let peerEnded = false;
		socket.on("end", () => { peerEnded = true; });
		frames(socket, frame => {
			commandChain = commandChain.then(async () => {
				try {
					const a = frame.args ?? {}; let result: unknown;
					switch (frame.op) {
						case "ping": result = { live: live.size, timer: Boolean(timer) }; break;
						case "create": store.create(a.input); changed(a.input.id); break;
						case "state": {
							if (identity && (identity !== a.id || live.get(identity)?.bridge !== socket)) throw new Error("May not write another live runner's state");
							result = store.writeState(a.id, a.patch);
							const l = live.get(a.id);
							if (l) { l.stallKey = undefined; l.stallAt = stallDeadline(l); }
							changed(a.id); schedule(); break;
						}
						case "mark-done": {
							const input = store.readInput(a.id), owner = database.runtime(a.id)?.owner;
							if (!input?.parent || live.has(a.id) || (owner && !owner.pid) || alive(owner?.pid) || alive(owner?.master)) throw new Error("Execution owner is live or ambiguous; cannot mark done");
							store.writeState(a.id, { status: "done", summary: LOST_DONE_SUMMARY, waitingOn: undefined, note: undefined });
							accept({ from: a.id, to: input.parent, kind: "result", body: `MARKED DONE by the user: ${LOST_DONE_SUMMARY}`, deliver: deliveryForParent(store, input.parent) });
							changed(a.id); break;
						}
						case "send": result = accept(a.message); break;
						case "spawn": store.create(a.input); accept({ from: "user", to: a.input.id, kind: "instruction", body: a.input.objective, deliver: "context", id: `initial:${a.input.id}` }); result = a.input; break;
						case "resume": {
							if (live.has(a.id)) throw new Error("Agent is already running or starting");
							wake(a.id, true, true);
							if (a.instruction) accept({ from: "user", to: a.id, kind: "instruction", body: a.instruction, deliver: "context" }); break;
						}
						case "hello": {
							identity = a.id;
							let l = live.get(a.id); const input = store.readInput(a.id);
							if (!input) throw new Error("Unknown agent");
							if (input.parent && (!l || l.owner.token !== a.token || (l.bridge && l.owner.pid !== a.pid))) throw new Error("Invalid or duplicate session owner");
							if (!input.parent) {
								const previous = database.runtime(a.id)?.owner;
								if ((l && l.owner.pid !== a.pid) || (previous?.pid !== a.pid && alive(previous?.pid))) throw new Error("Root session already has a live writer");
								l = { id: a.id, owner: { token: crypto.randomUUID(), pid: a.pid, settled: true }, settled: true, attachments: new Set(["human-root"]), unknownAttachment: false, parking: false, safeExit: false, wakeAfterExit: false };
								live.set(a.id, l);
							}
							l!.bridge = socket; l!.settled = true; l!.owner.pid = a.pid; l!.owner.startedAt = processStartTime(a.pid); l!.startupAt = undefined;
							store.writeState(a.id, { sessionFile: a.sessionFile, ...(!input.parent ? { status: "idle" as const } : {}) });
							await reconcile(a.id);
							if (live.get(a.id) !== l || l!.bridge !== socket) throw new Error("Execution owner changed during handshake");
							if (!store.readInbox(a.id).some(m => m.id === l!.delivery)) l!.delivery = undefined;
							persist(l!, "live");
							const runMs = input.runTimeoutMs; if (runMs) l!.runAt = Date.now() + runMs;
							pump(l!); break;
						}
						case "receipt": {
							if (identity !== a.id) throw new Error("Receipt owner mismatch");
							await reconcile(a.id); const l = live.get(a.id);
							if (l?.bridge === socket && !store.readInbox(a.id).some(m => m.id === l.delivery)) { l.delivery = undefined; pump(l); }
							break;
						}
						case "activity": {
							const l = live.get(identity!); if (!l || l.bridge !== socket) throw new Error("Not an owner");
							if (a.busy) { l.settled = false; l.parkAt = undefined; l.stallAt = stallDeadline(l); const runMs = store.readInput(l.id)?.runTimeoutMs; if (runMs && !l.runAt) l.runAt = Date.now() + runMs; }
							else { await reconcile(l.id); if (live.get(l.id) !== l || l.bridge !== socket) throw new Error("Execution owner changed during settlement"); l.settled = true; l.runAt = undefined; l.stallAt = undefined; if (!store.readInbox(l.id).some(m => m.id === l.delivery)) l.delivery = undefined; pump(l); }
							persist(l, l.parking ? "parking" : "live"); idle(l); work(); break;
						}
						case "park-declined": {
							const l = live.get(identity!); if (l?.bridge !== socket) throw new Error("Not the execution owner");
							l.parking = false; l.settled = false; l.parkAt = undefined; persist(l, "live"); pump(l); schedule(); break;
						}
						case "park-ready": {
							const l = live.get(identity!);
							if (!l?.parking || !l.settled || l.attachments.size || l.unknownAttachment || rawAttached(l.id)) {
								if (l) { l.parking = false; l.unknownAttachment ||= rawAttached(l.id); persist(l, "live"); pump(l); }
								result = false; break;
							}
							await reconcile(l.id);
							if (live.get(l.id) !== l || l.bridge !== socket) throw new Error("Execution owner changed during parking");
							l.safeExit = true; result = true; break;
						}
						case "attach": {
							// This connection is an inherited lease, not a UI subscriber. A surviving
							// dtach fd3 does not consume events after its wrapper dies.
							subscribers.delete(socket);
							const input = store.readInput(a.id); if (!input?.interactable || !input.parent) throw new Error("Not an attachable managed agent");
							wake(a.id, true); const l = live.get(a.id)!;
							const lease = crypto.randomUUID(); l.attachments.add(lease); l.parkAt = undefined;
							attachments.set(lease, { socket, agent: a.id });
							if (l.parking) l.wakeAfterExit = true;
							result = { lease }; schedule(); break;
						}
						case "attach-ready": {
							const lease = attachments.get(a.lease); if (lease?.socket !== socket) throw new Error("Unknown attachment lease");
							const l = live.get(lease.agent); result = l?.bridge && !l.parking ? { socket: store.ptySocket(lease.agent) } : null; break;
						}
						case "kill": {
							const l = live.get(a.id); if (!l?.owner.pid) throw new Error("No supervised owner to kill");
							const child = l.child;
							if (!child) throw new Error("Cannot kill a human root session");
							void new Promise<void>(resolve => {
								const force = setTimeout(() => { if (live.get(l.id) === l) { try { killGroup(l.owner.pid!, "SIGKILL"); } catch {} } }, 5000);
								child.once("exit", () => { clearTimeout(force); resolve(); });
								killGroup(l.owner.pid!, "SIGTERM");
							}).then(() => { try { send(socket, { request: frame.request, result: true }); } catch {} });
							return;
						}
						case "page": result = database.page(a.after, a.limit); break;
						default: throw new Error("Unknown runtime operation");
					}
					send(socket, { request: frame.request, result });
				} catch (error) { try { send(socket, { request: frame.request, error: String(error instanceof Error ? error.message : error) }); } catch {} }
			}).catch(() => { socket.destroy(); });
		});
		socket.on("error", () => {});
		socket.on("close", () => lifecycle(() => {
			clients.delete(socket); subscribers.delete(socket);
			for (const [lease, entry] of attachments) if (entry.socket === socket) {
				attachments.delete(lease); const l = live.get(entry.agent);
				// The managed wrapper transfers this connection into the actual dtach client as fd3.
				// EOF proves both wrapper and client closed it, including wrapper-crash/suspend cases.
				if (l) {
					l.attachments.delete(lease);
					if (!peerEnded) l.unknownAttachment = true; // local close/error is NOT peer EOF
					idle(l);
				}
			}
			const l = identity && live.get(identity);
			if (l && l.bridge === socket) {
				l.bridge = undefined;
				if (!store.readInput(l.id)?.parent) { live.delete(l.id); store.writeState(l.id, { status: "dormant" }); database.setRuntime(l.id, "parked", l.owner); changed(l.id); }
				else if (!l.safeExit) { l.parkAt = undefined; store.writeState(l.id, { summary: "Runner bridge disconnected; ownership remains fenced until process exit." }); changed(l.id); }
			}
			schedule();
		}));
	});
	fs.rmSync(socketPath(home), { force: true });
	await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(socketPath(home), resolve); });
	fs.chmodSync(socketPath(home), 0o600); work();
	return { database, server, live, async close() {
		closing = true; if (timer) clearTimeout(timer);
		for (const socket of clients) socket.destroy();
		await new Promise<void>(resolve => server.close(() => resolve()));
		await commandChain;
		database.close(); fs.rmSync(socketPath(home), { force: true }); singleton.close();
	} };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	startDaemon().then(runtime => {
		for (const signal of ["SIGTERM", "SIGINT"] as const) process.once(signal, () => void runtime.close().then(() => process.exit(0)));
	}).catch(error => { process.stderr.write(`[agents daemon] ${String(error)}\n`); process.exitCode = 1; });
}
