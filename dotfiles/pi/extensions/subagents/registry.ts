/**
 * The subagent registry: durable records plus live process handles.
 *
 * Durable records are appended to the parent session, so a restart can rebuild
 * the list from the branch and mark anything still "running" as "lost".
 * Live handles are never persisted.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { killPid, spawnChild, type Child } from "./child.ts";
import type { Profile } from "./profiles.ts";

export type SubagentStatus = "running" | "done" | "killed" | "lost" | "error";

export interface SubagentRecord {
	id: string;
	task: string;
	profile: Profile;
	pid?: number;
	sessionFile?: string;
	status: SubagentStatus;
	summary?: string;
	updatedAt: number;
}

export interface StartOptions {
	profile: Profile;
	message: string;
	cwd: string;
	depth: number;
	/** Reuse an existing id when resuming. */
	id?: string;
	/** Reopen this session when resuming. */
	sessionFile?: string;
}

export interface RegistryHooks {
	/** A run reached a terminal state; inject the result into the parent. */
	onComplete(record: SubagentRecord): void;
	/** Records changed; refresh human-visible status. */
	onChange(records: SubagentRecord[], context: ExtensionContext | undefined): void;
}

const CUSTOM_TYPE = "subagent";
const MAX_SUMMARY = 8000;

export function createRegistry(pi: ExtensionAPI, hooks: RegistryHooks) {
	const records = new Map<string, SubagentRecord>();
	const live = new Map<string, Child>();
	let context: ExtensionContext | undefined;

	function persist(record: SubagentRecord): void {
		records.set(record.id, record);
		pi.appendEntry(CUSTOM_TYPE, record);
		hooks.onChange([...records.values()], context);
	}

	/** Rebuild from the session branch; kill orphaned children, then mark them lost. */
	function restore(ctx: ExtensionContext): void {
		context = ctx;
		const latest = new Map<string, SubagentRecord>();
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type === "custom" && entry.customType === CUSTOM_TYPE && entry.data) {
				const record = entry.data as SubagentRecord;
				latest.set(record.id, record);
			}
		}
		for (const record of latest.values()) {
			if (record.status === "running") {
				// A child survives a hard parent crash via a detached process group;
				// kill the recorded group before declaring the record resumable.
				if (record.pid !== undefined) killPid(record.pid, "SIGKILL");
				record.status = "lost";
				record.updatedAt = Date.now();
			}
			records.set(record.id, record);
		}
		hooks.onChange([...records.values()], context);
	}

	async function start(options: StartOptions): Promise<SubagentRecord> {
		const existing = options.id ? records.get(options.id) : undefined;
		const id = options.id ?? `sub_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
		const record: SubagentRecord = {
			id,
			task: existing?.task ?? options.message,
			profile: options.profile,
			status: "running",
			updatedAt: Date.now(),
		};
		persist(record);

		let child: Child;
		try {
			child = await spawnChild({
				profile: options.profile,
				cwd: options.cwd,
				depth: options.depth,
				sessionFile: options.sessionFile,
			});
		} catch (error) {
			record.status = "error";
			record.summary = String(error);
			record.updatedAt = Date.now();
			persist(record);
			throw error;
		}

		record.pid = child.pid;
		record.sessionFile = child.sessionFile;
		persist(record);
		live.set(id, child);

		child.settled
			.then(({ aborted }) => {
				live.delete(id);
				const current = records.get(id);
				if (!current || current.status !== "running") return;
				current.status = aborted ? "killed" : "done";
				current.summary = child.lastText.slice(0, MAX_SUMMARY) || undefined;
				current.updatedAt = Date.now();
				persist(current);
				child.kill(false);
				hooks.onComplete(current);
			})
			.catch(() => {});

		await child.prompt(options.message);
		return record;
	}

	/** Fully terminate a running subagent. The live process is killed; the record is kept. */
	function kill(id: string, force?: boolean): boolean {
		const child = live.get(id);
		const record = records.get(id);
		if (!child || !record) return false;
		record.status = "killed";
		record.updatedAt = Date.now();
		persist(record);
		child.kill(force);
		return true;
	}

	function shutdown(): void {
		for (const child of live.values()) child.kill(true);
		live.clear();
	}

	return {
		restore,
		start,
		kill,
		shutdown,
		list: () => [...records.values()],
	};
}
