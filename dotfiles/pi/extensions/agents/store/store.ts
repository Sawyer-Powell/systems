/**
 * The agent store: every read and write of `~/.pi/agents`.
 *
 * Pure Node (no pi imports) so it is unit-testable and usable from a CLI.
 * Writers follow the single-writer rule documented in `types.ts`.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	type AgentInput,
	type AgentMessage,
	type AgentRecord,
	type AgentState,
	type EffectiveStatus,
	OVERRUN_GRACE_MS,
	STARTING_GRACE_MS,
	type StallReport,
	isTerminal,
	WEDGED_AFTER_MS,
} from "./types.ts";

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

/** `<role>.<slug>.<4 chars>`; safe as a directory name and in a zellij tab title. */
export function newId(role: string, slug: string): string {
	const clean = (value: string, max: number) =>
		value
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, max) || "x";
	const rand = Math.random().toString(36).slice(2, 6).padEnd(4, "0");
	return `${clean(role, 16)}.${clean(slug, 24)}.${rand}`;
}

function newMessageId(now = Date.now()): string {
	return `${String(now).padStart(13, "0")}-${Math.random().toString(36).slice(2, 8)}`;
}

function assertId(id: string): void {
	if (!ID_PATTERN.test(id) || id.includes("..")) throw new Error(`Invalid agent id: ${JSON.stringify(id)}`);
}

/** Write via a temp file in the same directory, then rename: readers never see a partial file. */
function writeJsonAtomic(file: string, value: unknown): void {
	const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
	fs.renameSync(tmp, file);
}

function readJson<T>(file: string): T | undefined {
	try {
		return JSON.parse(fs.readFileSync(file, "utf8")) as T;
	} catch {
		return undefined;
	}
}

const START_TIME_TTL_MS = 30_000;
const startTimeCache = new Map<number, { value: string | undefined; at: number }>();

/**
 * Process start time, used with the pid so a recycled pid is not mistaken for the
 * owner. A pid's start time cannot change while it lives, so results are cached for a
 * short TTL: liveness checks run on every UI refresh and must not spawn `ps` each time.
 */
export function processStartTime(pid: number): string | undefined {
	const now = Date.now();
	const cached = startTimeCache.get(pid);
	if (cached && now - cached.at < START_TIME_TTL_MS) return cached.value;
	let value: string | undefined;
	try {
		value =
			execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
				timeout: 2000,
			}).trim() || undefined;
	} catch {
		value = undefined;
	}
	startTimeCache.set(pid, { value, at: now });
	return value;
}

interface LockFile {
	pid: number;
	startedAt: string;
}

export interface Store {
	readonly home: string;
	dir(id: string): string;
	exists(id: string): boolean;

	// identity and tree
	readInput(id: string): AgentInput | undefined;
	readState(id: string): AgentState | undefined;
	record(id: string): AgentRecord | undefined;
	list(): AgentRecord[];
	children(id: string): AgentRecord[];
	ancestors(id: string): AgentRecord[];
	descendants(id: string): AgentRecord[];
	/** `root › parent › agent`, using each agent's name. */
	breadcrumb(id: string): string;

	// writes
	/** Exclusive create: throws if the id exists. Also writes the initial `starting` state. */
	create(input: AgentInput): void;
	/** Shallow-merge `patch` (activity merged one level deeper). Stamps `since` on status change. */
	writeState(id: string, patch: Partial<Omit<AgentState, "activity">> & { activity?: Partial<AgentState["activity"]> }): AgentState;
	logPath(id: string): string;
	ptySocket(id: string): string;

	// liveness
	/** Take the lock for the current process. Throws if another live process owns it. */
	acquireLock(id: string, pid?: number): void;
	releaseLock(id: string, pid?: number): void;
	isAlive(id: string): boolean;
	lockPid(id: string): number | undefined;

	// messaging
	canMessage(from: string, to: string): boolean;
	/** Throws if `canMessage` is false. Returns the stored message. */
	send(message: Omit<AgentMessage, "id" | "ts"> & { id?: string; ts?: number }): AgentMessage;
	/** Messages with id strictly greater than `after`, in order. */
	readInbox(id: string, after?: string): AgentMessage[];
}

export function createStore(home: string = process.env.PI_AGENTS_HOME?.trim() || path.join(os.homedir(), ".pi", "agents")): Store {
	const dirOf = (id: string) => {
		assertId(id);
		return path.join(home, id);
	};
	const inputFile = (id: string) => path.join(dirOf(id), "input.json");
	const stateFile = (id: string) => path.join(dirOf(id), "state.json");
	const lockFile = (id: string) => path.join(dirOf(id), "lock");
	const inboxDir = (id: string) => path.join(dirOf(id), "inbox");

	const store: Store = {
		home,
		dir: dirOf,
		exists: (id) => fs.existsSync(inputFile(id)),

		readInput: (id) => readJson<AgentInput>(inputFile(id)),
		readState: (id) => readJson<AgentState>(stateFile(id)),

		record(id) {
			const input = store.readInput(id);
			if (!input) return undefined;
			const state = store.readState(id);
			const alive = store.isAlive(id);
			return { input, state, alive, status: statusOf(state, alive) };
		},

		list() {
			let names: string[];
			try {
				names = fs.readdirSync(home);
			} catch {
				return [];
			}
			const records: AgentRecord[] = [];
			for (const name of names) {
				if (!ID_PATTERN.test(name)) continue;
				const record = store.record(name);
				if (record) records.push(record);
			}
			return records.sort((a, b) => a.input.createdAt - b.input.createdAt);
		},

		children: (id) => store.list().filter((record) => record.input.parent === id),

		ancestors(id) {
			const chain: AgentRecord[] = [];
			const seen = new Set<string>([id]);
			let current = store.readInput(id)?.parent ?? null;
			while (current && !seen.has(current)) {
				seen.add(current);
				const record = store.record(current);
				if (!record) break;
				chain.push(record);
				current = record.input.parent;
			}
			return chain;
		},

		descendants(id) {
			const all = store.list();
			const byParent = new Map<string, AgentRecord[]>();
			for (const record of all) {
				const key = record.input.parent;
				if (key) byParent.set(key, [...(byParent.get(key) ?? []), record]);
			}
			const out: AgentRecord[] = [];
			const walk = (parent: string, seen: Set<string>) => {
				for (const child of byParent.get(parent) ?? []) {
					if (seen.has(child.input.id)) continue;
					seen.add(child.input.id);
					out.push(child);
					walk(child.input.id, seen);
				}
			};
			walk(id, new Set([id]));
			return out;
		},

		breadcrumb(id) {
			const self = store.readInput(id);
			if (!self) return id;
			const chain = [...store.ancestors(id)].reverse().map((record) => record.input.name);
			return [...chain, self.name].join(" › ");
		},

		create(input) {
			assertId(input.id);
			fs.mkdirSync(home, { recursive: true, mode: 0o700 });
			fs.mkdirSync(dirOf(input.id), { mode: 0o700 }); // throws EEXIST
			fs.mkdirSync(inboxDir(input.id), { mode: 0o700 });
			fs.writeFileSync(inputFile(input.id), JSON.stringify(input, null, 2) + "\n", { flag: "wx", mode: 0o600 });
			const now = Date.now();
			writeJsonAtomic(stateFile(input.id), {
				status: "starting",
				since: now,
				runStartedAt: now,
				activity: { lastEventAt: now, lastSeenAt: now, inFlight: null },
			} satisfies AgentState);
		},

		writeState(id, patch) {
			const now = Date.now();
			const current = store.readState(id) ?? {
				status: "starting" as const,
				since: now,
				activity: { lastEventAt: now, lastSeenAt: now, inFlight: null },
			};
			const next: AgentState = {
				...current,
				...patch,
				activity: { ...current.activity, ...patch.activity },
			};
			if (patch.status && patch.status !== current.status) next.since = now;
			writeJsonAtomic(stateFile(id), next);
			return next;
		},

		logPath: (id) => path.join(dirOf(id), "log"),
		ptySocket: (id) => path.join(dirOf(id), "pty.sock"),

		acquireLock(id, pid = process.pid) {
			const file = lockFile(id);
			const mine: LockFile = { pid, startedAt: processStartTime(pid) ?? "" };
			for (let attempt = 0; attempt < 2; attempt++) {
				try {
					fs.writeFileSync(file, JSON.stringify(mine), { flag: "wx", mode: 0o600 });
					// Another process may have removed our fresh file as "stale" and written its own.
					if (readJson<LockFile>(file)?.pid !== pid) throw new Error(`Agent ${id} was claimed by another process.`);
					return;
				} catch (error) {
					if ((error as Error).message.includes("was claimed")) throw error;
					if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
					const existing = readJson<LockFile>(file);
					if (existing && existing.pid !== pid && lockOwnerAlive(existing)) {
						throw new Error(`Agent ${id} is already running (pid ${existing.pid}).`);
					}
					fs.rmSync(file, { force: true }); // stale or ours; retry once
				}
			}
			throw new Error(`Could not acquire lock for ${id}.`);
		},

		releaseLock(id, pid = process.pid) {
			const existing = readJson<LockFile>(lockFile(id));
			if (existing && existing.pid === pid) fs.rmSync(lockFile(id), { force: true });
		},

		isAlive(id) {
			const existing = readJson<LockFile>(lockFile(id));
			return existing ? lockOwnerAlive(existing) : false;
		},

		lockPid: (id) => readJson<LockFile>(lockFile(id))?.pid,

		canMessage(from, to) {
			if (from === to) return false;
			if (from === "user" || from.startsWith("user:")) return store.exists(to);
			if (!store.exists(from) || !store.exists(to)) return false;
			if (store.ancestors(from).some((record) => record.input.id === to)) return true;
			return store.descendants(from).some((record) => record.input.id === to);
		},

		send(partial) {
			if (!store.canMessage(partial.from, partial.to)) {
				throw new Error(`${partial.from} may not message ${partial.to} (parent, ancestors and descendants only).`);
			}
			const ts = partial.ts ?? Date.now();
			const message: AgentMessage = { ...partial, id: partial.id ?? newMessageId(ts), ts };
			const dir = inboxDir(partial.to);
			fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
			writeJsonAtomic(path.join(dir, `${message.id}.json`), message);
			return message;
		},

		readInbox(id, after) {
			let names: string[];
			try {
				names = fs.readdirSync(inboxDir(id));
			} catch {
				return [];
			}
			return names
				.filter((name) => name.endsWith(".json") && !name.includes(".tmp"))
				.map((name) => name.slice(0, -".json".length))
				.filter((messageId) => after === undefined || messageId > after)
				.sort()
				.flatMap((messageId) => {
					const message = readJson<AgentMessage>(path.join(inboxDir(id), `${messageId}.json`));
					return message ? [message] : [];
				});
		},
	};
	return store;
}

/**
 * Whether an agent needs attention, from a record already loaded by `Store.record`.
 * Pure: the caller supplies the clock. Terminal agents and agents with no state are never reported.
 */
export function stallOf(record: AgentRecord, now = Date.now()): StallReport | undefined {
	const { input, state, status } = record;
	if (!state || isTerminal(status)) return undefined;
	if (status === "lost") {
		return { kind: "lost", overMs: now - state.activity.lastSeenAt, detail: `process gone while ${state.status}` };
	}

	const runStart = state.runStartedAt ?? input.createdAt;
	if (input.runTimeoutMs !== undefined && now - runStart > input.runTimeoutMs) {
		return {
			kind: "run-overrun",
			overMs: now - runStart - input.runTimeoutMs,
			detail: `whole-run limit ${input.runTimeoutMs}ms exceeded`,
		};
	}

	if (now - state.activity.lastSeenAt > WEDGED_AFTER_MS) {
		return {
			kind: "wedged",
			overMs: now - state.activity.lastSeenAt - WEDGED_AFTER_MS,
			detail: "heartbeat stopped while the process is alive",
		};
	}

	// Only a working agent can stall; idle and waiting agents are expected to be quiet.
	if (state.status !== "working" && state.status !== "starting") return undefined;

	const { inFlight, lastEventAt } = state.activity;
	if (inFlight?.deadline !== undefined && now > inFlight.deadline + OVERRUN_GRACE_MS) {
		return {
			kind: "overrun",
			overMs: now - inFlight.deadline - OVERRUN_GRACE_MS,
			detail: `${inFlight.kind} ${inFlight.name} past its declared deadline`,
		};
	}
	if (inFlight?.deadline === undefined) {
		const since = Math.max(lastEventAt, inFlight?.startedAt ?? 0);
		if (now - since > input.stepTimeoutMs) {
			return {
				kind: "stall",
				overMs: now - since - input.stepTimeoutMs,
				detail: inFlight
					? `${inFlight.kind} ${inFlight.name} running ${Math.round((now - inFlight.startedAt) / 1000)}s with no events`
					: `no events for ${Math.round((now - lastEventAt) / 1000)}s`,
			};
		}
	}
	return undefined;
}

/** Dead and not terminal means lost, except just after launch when the lock does not exist yet. */
function statusOf(state: AgentState | undefined, alive: boolean, now = Date.now()): EffectiveStatus {
	if (!state) return "lost";
	if (isTerminal(state.status)) return state.status;
	if (alive) return state.status;
	if (state.status === "starting" && now - state.since < STARTING_GRACE_MS) return "starting";
	return "lost";
}

function lockOwnerAlive(lock: LockFile): boolean {
	try {
		process.kill(lock.pid, 0);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EPERM") return false;
	}
	if (!lock.startedAt) return true;
	const started = processStartTime(lock.pid);
	return started === undefined || started === lock.startedAt;
}

/**
 * How a child's `result`/`stall` message should reach its parent: a root parent
 * (the user's main agent) only gets a UI notification so it does not narrate;
 * a non-root parent is an agent that must act on it, so it enters its context.
 */
export function deliveryForParent(store: Store, parentId: string): "ui" | "context" {
	const parent = store.readInput(parentId);
	return parent && parent.parent === null ? "ui" : "context";
}
