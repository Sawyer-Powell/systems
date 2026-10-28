/**
 * Parent-side liveness: scan direct children, report stalls to this agent's
 * inbox. Detection only; interventions are explicit tool calls.
 */
import type { AgentsHost } from "../host.ts";
import { type AgentRecord, deliveryForParent, type StallKind, type StallReport, stallOf, type Store } from "../store/index.ts";

const SCAN_MS = 15_000;

interface NewStall {
	record: AgentRecord;
	report: StallReport;
}

/**
 * The stalls among `records` that have not been reported yet, marking them reported. `reported`
 * dedupes `id:kind` until the agent recovers (no report any more), which resets its keys. Pure
 * apart from `reported`.
 */
export function newStalls(records: AgentRecord[], reported: Set<string>, now: number): NewStall[] {
	const fresh: NewStall[] = [];
	for (const record of records) {
		const report = stallOf(record, now);
		const prefix = `${record.input.id}:`;
		if (!report) {
			for (const key of [...reported]) if (key.startsWith(prefix)) reported.delete(key);
			continue;
		}
		const key = `${prefix}${report.kind satisfies StallKind}`;
		if (reported.has(key)) continue;
		reported.add(key);
		fresh.push({ record, report });
	}
	return fresh;
}

/**
 * Text of a stall message. It names the stalled child first and says it is about the child: the
 * recipient (a parent that may itself be mid-request) is not the one that stalled. A model request
 * in flight cannot take a message until it ends, and an interrupt discards it, so waiting is the
 * default; only a silence of several minutes (or kind other than "stall") warrants intervening.
 */
export function stallBody(child: AgentRecord, report: StallReport): string {
	const head = `STALLED CHILD ${child.input.name} (${child.input.id}): ${report.kind}, ${report.detail}. This is about your child, not about you.`;
	const hint =
		report.kind === "stall"
			? " A model request in flight does not receive messages until it ends, and an interrupt discards it; prefer waiting unless the silence keeps growing."
			: "";
	return head + hint;
}

/** One scan pass; exported for tests. Sends each new stall of a direct child to its parent's inbox. */
export function scan(store: Store, selfId: string, reported: Set<string>, now = Date.now()): string[] {
	const sent: string[] = [];
	for (const { record: child, report } of newStalls(store.children(selfId), reported, now)) {
		try {
			store.send({
				from: child.input.id,
				to: selfId,
				kind: "stall",
				body: stallBody(child, report),
				deliver: deliveryForParent(store, selfId),
			});
			sent.push(`${child.input.id}:${report.kind}`);
		} catch {
			// parent gone or not permitted; nothing to do
		}
	}
	return sent;
}

/** What the user sees for a stall anywhere in the root's tree. */
export const stallNotice = ({ record, report }: NewStall): string =>
	`${record.input.name}·${record.input.id.slice(-4)} (${record.input.role}): ${report.kind}, ${report.detail}. Open /agents to ${report.kind === "lost" ? "resume" : "interrupt"}.`;

/**
 * Root only: stalls deeper in the tree than its direct children, as one-line UI notices. The
 * parent of a grandchild may be an LLM busy elsewhere, so the human must see it. Direct children
 * are skipped: their stall message already reaches the root's UI (`deliver: "ui"`). Never a
 * store message, never model context.
 */
export function treeNotices(store: Store, rootId: string, reported: Set<string>, now = Date.now()): string[] {
	const deeper = store.descendants(rootId).filter((record) => record.input.parent !== rootId);
	return newStalls(deeper, reported, now).map(stallNotice);
}

export function startWatchdog(host: AgentsHost): () => void {
	const reported = new Set<string>();
	const reportedForUser = new Set<string>();
	const timer = setInterval(() => {
		try {
			const self = host.identity;
			if (!self) return;
			scan(host.store, self.id, reported);
			if (self.parent === null && host.ctx?.hasUI) {
				for (const line of treeNotices(host.store, self.id, reportedForUser)) host.ctx.ui.notify(line, "warning");
			}
		} catch (error) {
			process.stderr.write(`[agents] watchdog scan failed: ${String(error)}\n`);
		}
	}, SCAN_MS);
	timer.unref?.();
	return () => clearInterval(timer);
}
