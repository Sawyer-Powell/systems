/**
 * Records which zellij session and pane this pi session runs in.
 *
 * Agents are long-lived and detached (`dtach`), so the `ZELLIJ_*` variables they
 * inherited at launch go stale: the user's zellij session may be gone, or the
 * root may have been resumed in another one, or started outside zellij. A pi
 * session therefore writes its current context to a file keyed by its session id
 * (agent id === session id); scripts such as the `show-in-nvim` skill walk up an
 * agent's parents and use the first context whose session is still alive.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface ZellijContext {
	session: string;
	paneId: string;
	pid: number;
	at: number;
}

export function contextDir(env: NodeJS.ProcessEnv = process.env): string {
	return env.PI_ZELLIJ_CONTEXT_DIR?.trim() || path.join(os.homedir(), ".pi", "zellij-context");
}

/** Write this process's zellij context for `sessionId`. No-op outside zellij; never throws. */
export function recordZellijContext(sessionId: string, env: NodeJS.ProcessEnv = process.env): void {
	const session = env.ZELLIJ_SESSION_NAME?.trim();
	const paneId = env.ZELLIJ_PANE_ID?.trim();
	if (!session || !paneId || !/^[\w.-]+$/.test(sessionId)) return;
	try {
		const dir = contextDir(env);
		fs.mkdirSync(dir, { recursive: true });
		const file = path.join(dir, `${sessionId}.json`);
		const context: ZellijContext = { session, paneId, pid: process.pid, at: Date.now() };
		fs.writeFileSync(`${file}.tmp${process.pid}`, JSON.stringify(context));
		fs.renameSync(`${file}.tmp${process.pid}`, file);
	} catch {
		// Best effort: a missing context only means the skill falls back to other discovery.
	}
}
