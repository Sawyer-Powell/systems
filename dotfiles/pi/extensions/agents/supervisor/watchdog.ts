/**
 * Parent-side liveness: scan direct children, report stalls to this agent's
 * inbox. Detection only; interventions are explicit tool calls.
 */
import type { AgentsHost } from "../host.ts";
import { deliveryForParent, type StallKind, stallOf, type Store } from "../store/index.ts";

const SCAN_MS = 15_000;

/** One scan pass; exported for tests. `reported` dedupes `child:kind` until the child recovers. */
export function scan(store: Store, selfId: string, reported: Set<string>, now = Date.now()): string[] {
	const sent: string[] = [];
	for (const child of store.children(selfId)) {
		const report = stallOf(child, now);
		const prefix = `${child.input.id}:`;
		if (!report) {
			for (const key of [...reported]) if (key.startsWith(prefix)) reported.delete(key);
			continue;
		}
		const key = `${prefix}${report.kind satisfies StallKind}`;
		if (reported.has(key)) continue;
		reported.add(key);
		try {
			store.send({
				from: child.input.id,
				to: selfId,
				kind: "stall",
				body: `${child.input.name} (${child.input.id}): ${report.kind} — ${report.detail}`,
				deliver: deliveryForParent(store, selfId),
			});
			sent.push(key);
		} catch {
			// parent gone or not permitted; nothing to do
		}
	}
	return sent;
}

export function startWatchdog(host: AgentsHost): () => void {
	const reported = new Set<string>();
	const timer = setInterval(() => {
		try {
			if (host.identity) scan(host.store, host.identity.id, reported);
		} catch (error) {
			process.stderr.write(`[agents] watchdog scan failed: ${String(error)}\n`);
		}
	}, SCAN_MS);
	timer.unref?.();
	return () => clearInterval(timer);
}
