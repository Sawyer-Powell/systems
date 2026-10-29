/** Read-only indexed views plus ordered, explicitly awaited daemon commands. */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { mergeState, openDatabase, runtimeHome } from "./database.ts";
import { RuntimeClient } from "./ipc.ts";
import type { AgentState, Store } from "../store/index.ts";

export class AgentConnection extends RuntimeClient {
	private database?: ReturnType<typeof openDatabase>;
	private writes: Promise<unknown> = Promise.resolve();
	private failed?: Error;
	private pendingStates = new Map<string, AgentState>();
	readonly store: Store;
	constructor(readonly home = runtimeHome()) {
		super();
		// The proxy is only a synchronous read facade. Mutations must be flushed at tool/lifecycle boundaries.
		this.store = new Proxy({} as Store, { get: (_target, key) => {
			if (key === "home") return home;
			if (key === "writeState") return (id: string, patch: Parameters<Store["writeState"]>[1]) => {
				const next = mergeState(this.store.readState(id), patch); this.pendingStates.set(id, next);
				this.queue("state", { id, patch }).then(() => { if (this.pendingStates.get(id) === next) this.pendingStates.delete(id); }).catch(() => {});
				return next;
			};
			if (key === "readState") return (id: string) => this.pendingStates.get(id) ?? this.database?.store.readState(id);
			if (key === "create") return (input: Parameters<Store["create"]>[0]) => { this.queue("create", { input }); };
			if (key === "send") return (partial: Parameters<Store["send"]>[0]) => {
				if (!this.store.canMessage(partial.from, partial.to)) throw new Error("Only ancestors and descendants may be messaged");
				const message = { ...partial, id: partial.id ?? crypto.randomUUID(), ts: partial.ts ?? Date.now() };
				this.queue("send", { message }); return message;
			};
			if (!this.database) throw new Error("Runtime not initialized");
			return this.database.store[key as keyof Store];
		} });
	}
	async start() {
		try { await this.connect(this.home); }
		catch {
			// Multiple clients may race here; the daemon's exclusive lock chooses the sole writer.
			fs.mkdirSync(this.home, { recursive: true, mode: 0o700 });
			const fd = fs.openSync(path.join(this.home, "daemon.log"), "a", 0o600);
			const child = spawn(process.env.PI_AGENTS_NODE ?? "node", ["--experimental-strip-types", path.join(path.dirname(fileURLToPath(import.meta.url)), "daemon.ts")], {
				env: { ...process.env, PI_AGENTS_HOME: this.home }, detached: true, stdio: ["ignore", fd, fd],
			});
			fs.closeSync(fd); child.on("error", () => {}); child.unref();
			let connected = false;
			for (let attempt = 0; attempt < 50; attempt++) {
				await new Promise(resolve => setTimeout(resolve, 100));
				try { await this.connect(this.home); connected = true; break; } catch {}
			}
			if (!connected) throw new Error(`Cannot start agents daemon; see ${path.join(this.home, "daemon.log")}`);
		}
		this.database = openDatabase(this.home);
	}
	queue(op: string, args: unknown): Promise<unknown> {
		const result = this.writes.then(() => { if (this.failed) throw this.failed; return this.request(op, args); });
		this.writes = result.catch(error => { this.failed = error instanceof Error ? error : new Error(String(error)); });
		return result;
	}
	widget(id: string) { if (!this.database) throw new Error("Runtime not initialized"); return this.database.widget(id); }
	async flush() { await this.writes; if (this.failed) throw this.failed; }
	async stop() { await this.flush(); this.close(); this.database?.close(); this.database = undefined; this.pendingStates.clear(); }
}
