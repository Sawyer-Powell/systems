/** SQLite is the runtime authority. Only the daemon opens a writable connection. */
import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentInput, AgentMessage, AgentRecord, AgentState, Store } from "../store/index.ts";

import { runtimeHome } from "../store/store.ts";
export { runtimeHome } from "../store/store.ts";
export type Residency = "parked" | "starting" | "live" | "parking" | "blocked";
export interface Owner { token: string; pid?: number; startedAt?: string; master?: number; settled: boolean }
export interface RuntimeRow { residency: Residency; owner?: Owner }
export function mergeState(current: AgentState | undefined, patch: Parameters<Store["writeState"]>[1]): AgentState {
	const now = Date.now();
	const clean = Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, v === null ? undefined : v]));
	const base = current ?? { status: "idle", since: now, activity: { lastEventAt: now, lastSeenAt: now, inFlight: null } };
	return { ...base, ...clean, since: clean.status && clean.status !== base.status ? now : base.since,
		activity: { ...base.activity, ...patch.activity } } as AgentState;
}
export function openDatabase(home = runtimeHome(), writable = false) {
	if (writable) fs.mkdirSync(home, { recursive: true, mode: 0o700 });
	const db = new DatabaseSync(path.join(home, "runtime.sqlite"), { readOnly: !writable });
	db.exec("PRAGMA busy_timeout=5000");
	if (writable) db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
		CREATE TABLE IF NOT EXISTS agents(id TEXT PRIMARY KEY, parent TEXT, created INTEGER, input TEXT NOT NULL, state TEXT NOT NULL,
		 status TEXT NOT NULL, since INTEGER NOT NULL, residency TEXT NOT NULL DEFAULT 'parked', owner TEXT);
		CREATE INDEX IF NOT EXISTS agents_parent ON agents(parent);
		CREATE INDEX IF NOT EXISTS agents_status ON agents(status,since);
		CREATE INDEX IF NOT EXISTS agents_residency ON agents(residency);
		CREATE TABLE IF NOT EXISTS messages(seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, recipient TEXT NOT NULL,
		 payload TEXT NOT NULL, receipt TEXT);
		CREATE INDEX IF NOT EXISTS messages_pending ON messages(recipient, receipt, seq);
		CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT, agent TEXT, kind TEXT, at INTEGER);
	`);
	const decode = <T>(value: unknown): T | undefined => typeof value === "string" ? JSON.parse(value) : undefined;
	const row = (id: string) => db.prepare("SELECT * FROM agents WHERE id=?").get(id);
	const runtime = (id: string): RuntimeRow | undefined => {
		const r = row(id); return r ? { residency: r.residency as Residency, owner: decode<Owner>(r.owner) } : undefined;
	};
	const record = (r: Record<string, unknown> | undefined): AgentRecord | undefined => {
		if (!r) return undefined;
		const input = decode<AgentInput>(r.input)!;
		const state = decode<AgentState>(r.state)!;
		const residency = r.residency as Residency;
		const alive = residency === "live" || residency === "parking";
		return { input, state, alive, residency,
			status: residency === "blocked" && state.status !== "archived" ? "blocked" : state.status };
	};
	const query = (sql: string, ...args: (string | number)[]) => db.prepare(sql).all(...args).map(r => record(r)!);
	const store: Store = {
		home,
		dir(id) { if (!/^[a-z0-9][a-z0-9._-]*$/.test(id) || id.includes("..")) throw new Error("Invalid agent id"); return path.join(home, id); },
		exists: id => Boolean(row(id)),
		readInput: id => decode<AgentInput>(row(id)?.input),
		readState: id => decode<AgentState>(row(id)?.state),
		record: id => record(row(id)),
		list: () => query("SELECT * FROM agents ORDER BY created"),
		children: id => query("SELECT * FROM agents WHERE parent=? ORDER BY created", id),
		ancestors(id) {
			return query(`WITH RECURSIVE chain AS (SELECT * FROM agents WHERE id=(SELECT parent FROM agents WHERE id=?)
			 UNION ALL SELECT a.* FROM agents a JOIN chain c ON a.id=c.parent) SELECT * FROM chain`, id);
		},
		descendants(id) {
			return query(`WITH RECURSIVE tree AS (SELECT * FROM agents WHERE parent=?
			 UNION ALL SELECT a.* FROM agents a JOIN tree t ON a.parent=t.id) SELECT * FROM tree ORDER BY created`, id);
		},
		breadcrumb(id) { return [...store.ancestors(id)].reverse().map(r => r.input.name).concat(store.readInput(id)?.name ?? id).join(" › "); },
		create(input) {
			if (!writable) throw new Error("Read-only store");
			fs.mkdirSync(store.dir(input.id), { recursive: true, mode: 0o700 });
			const state = mergeState(undefined, { status: "idle", runStartedAt: Date.now() });
			db.prepare("INSERT INTO agents(id,parent,created,input,state,status,since) VALUES(?,?,?,?,?,?,?)").run(input.id, input.parent, input.createdAt, JSON.stringify(input), JSON.stringify(state), state.status, state.since);
		},
		writeState(id, patch) {
			const next = mergeState(store.readState(id), patch);
			db.prepare("UPDATE agents SET state=?,status=?,since=? WHERE id=?").run(JSON.stringify(next), next.status, next.since, id); return next;
		},
		logPath: id => path.join(store.dir(id), "log"),
		ptySocket: id => path.join(store.dir(id), "pty.sock"),
		acquireLock() { throw new Error("Session ownership belongs to the daemon"); },
		releaseLock() { throw new Error("Session ownership belongs to the daemon"); },
		isAlive: id => store.record(id)?.alive ?? false,
		lockPid: id => runtime(id)?.owner?.pid,
		canMessage(from, to) {
			if (!store.exists(to) || from === to) return false;
			return from === "user" || from.startsWith("user:") || store.ancestors(from).some(r => r.input.id === to) || store.ancestors(to).some(r => r.input.id === from);
		},
		send(partial) {
			const userHandoff = partial.kind === "yield" && partial.to === "user" && store.exists(partial.from);
			if (!userHandoff && !store.canMessage(partial.from, partial.to)) throw new Error(`${partial.from} may not message ${partial.to}`);
			const message: AgentMessage = { ...partial, id: partial.id ?? crypto.randomUUID(), ts: partial.ts ?? Date.now() };
			const existing = db.prepare("SELECT payload FROM messages WHERE id=?").get(message.id);
			if (existing) {
				const prior = decode<AgentMessage>(existing.payload)!;
				if ((["to", "body", "from", "kind", "deliver", "control", "inReplyTo"] as const).some(key => prior[key] !== message[key])) throw new Error("Message id conflict");
				return prior;
			}
			db.prepare("INSERT INTO messages(id,recipient,payload) VALUES(?,?,?)").run(message.id, message.to, JSON.stringify(message)); return message;
		},
		readInbox(id) { return db.prepare("SELECT payload FROM messages WHERE recipient=? AND receipt IS NULL ORDER BY seq").all(id).map(r => decode<AgentMessage>(r.payload)!); },
	};
	return { db, store, runtime,
		setRuntime(id: string, residency: Residency, owner?: Owner) { db.prepare("UPDATE agents SET residency=?,owner=? WHERE id=?").run(residency, owner ? JSON.stringify(owner) : null, id); },
		widget(id: string, now = Date.now()) {
			// Rank compact metadata in SQLite; decode only seven candidates per triage group and
			// live runners (whose stall priority is computed by the shared pure UI model).
			const scope = `WITH RECURSIVE tree(id) AS (SELECT id FROM agents WHERE parent=? UNION ALL SELECT a.id FROM agents a JOIN tree t ON a.parent=t.id),
			 scoped AS (SELECT a.*,CASE WHEN residency='blocked' AND status!='archived' THEN 'blocked' ELSE status END AS effective
			 FROM agents a JOIN tree t ON a.id=t.id),
			 ranked AS (SELECT *,CASE effective WHEN 'needs-you' THEN 0 WHEN 'blocked' THEN 1 WHEN 'working' THEN 2
			 WHEN 'waiting-on-parent' THEN 3 ELSE 4 END AS grp FROM scoped WHERE effective!='archived'),
			 visible AS (SELECT * FROM ranked WHERE grp<4 OR since>=? OR residency IN ('live','parking'))`;
			const args = [id, now - 600000] as const;
			// Needs-you/blocked/waiting never decay into idle or disappear because of age.
			const rows = query(`${scope}, numbered AS (SELECT *,ROW_NUMBER() OVER (PARTITION BY grp ORDER BY
			 CASE WHEN grp=4 THEN -since WHEN grp=2 THEN coalesce(json_extract(state,'$.runStartedAt'),since) ELSE since END) AS n FROM visible)
			 SELECT * FROM numbered WHERE n<=7 OR residency IN ('live','parking')`, ...args);
			const total = Number(db.prepare(`${scope} SELECT count(*) AS n FROM visible`).get(...args)?.n ?? 0);
			const parents = new Set(rows.map(r => r.input.parent).filter((v): v is string => Boolean(v)));
			const records = new Map(rows.map(r => [r.input.id, r]));
			for (const parent of parents) for (const r of [store.record(parent), ...store.ancestors(parent)]) if (r) records.set(r.input.id, r);
			const self = store.record(id); if (self) records.set(id, self);
			const counts = db.prepare("SELECT count(*) AS total,coalesce(sum(residency IN ('live','parking')),0) AS live FROM agents WHERE parent=?").get(id)!;
			return { records: [...records.values()], total, children: { total: Number(counts.total), live: Number(counts.live) } };
		},
		page(after = "", limit = 200) { return query("SELECT * FROM agents WHERE id>? ORDER BY id LIMIT ?", after, Math.min(limit, 500)); },
		close: () => db.close(),
	};
}
export type RuntimeDatabase = ReturnType<typeof openDatabase>;
