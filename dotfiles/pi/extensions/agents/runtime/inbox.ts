/**
 * Delivers inbox messages into the running session, in order, at least once.
 * Progress is the `lastDelivered` cursor in `state.json`, so a restart resumes
 * exactly after the last delivered message.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentMessage, Store } from "../store/index.ts";

interface InboxPumpDeps {
	store: Store;
	id: string;
	deliver: (message: AgentMessage) => Promise<void> | void;
	pollMs?: number;
}

export class InboxPump {
	private readonly deps: InboxPumpDeps;
	private watcher: fs.FSWatcher | undefined;
	private timer: ReturnType<typeof setInterval> | undefined;
	private running = false;
	private again = false;
	private stopped = false;

	constructor(deps: InboxPumpDeps) {
		this.deps = deps;
	}

	start(): void {
		this.stopped = false;
		const dir = path.join(this.deps.store.dir(this.deps.id), "inbox");
		try {
			this.watcher = fs.watch(dir, { persistent: false }, () => this.kick());
			this.watcher.on("error", () => {});
		} catch {
			// polling still covers it
		}
		this.timer = setInterval(() => this.kick(), this.deps.pollMs ?? 2000);
		this.timer.unref?.();
		this.kick();
	}

	/** Fire-and-forget pump that can never reject. */
	private kick(): void {
		void this.pump();
	}

	stop(): void {
		this.stopped = true;
		this.watcher?.close();
		this.watcher = undefined;
		if (this.timer) clearInterval(this.timer);
		this.timer = undefined;
	}

	/** Deliver everything pending. Concurrent calls coalesce into one extra pass. */
	async pump(): Promise<void> {
		if (this.running) {
			this.again = true;
			return;
		}
		this.running = true;
		try {
			do {
				this.again = false;
				const { store, id } = this.deps;
				const cursor = store.readState(id)?.lastDelivered;
				for (const message of store.readInbox(id, cursor)) {
					if (this.stopped) return;
					// Control messages advance the cursor first: `stop` may end the process
					// before delivery returns, and it must not fire again after a resume.
					if (message.kind === "control") store.writeState(id, { lastDelivered: message.id });
					try {
						await this.deps.deliver(message);
					} catch (error) {
						process.stderr.write(`[agents] delivery of ${message.id} failed: ${String(error)}\n`);
					}
					store.writeState(id, { lastDelivered: message.id });
				}
			} while (this.again && !this.stopped);
		} catch (error) {
			process.stderr.write(`[agents] inbox pump error: ${String(error)}\n`);
		} finally {
			this.running = false;
		}
	}
}
