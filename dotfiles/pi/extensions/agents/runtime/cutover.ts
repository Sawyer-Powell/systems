/** Startup-only legacy marker check; never imports state, starts processes or changes locks. */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export function legacyStartupRefusal(sessionId: string, home: string, legacyHome = path.join(os.homedir(), ".pi", "agents")): string | undefined {
	const managedId = process.env.PI_AGENTS_ID;
	const owner = process.env.PI_AGENTS_OWNER;
	if (managedId || owner) return managedId === sessionId && owner ? undefined : "Managed session identity/token missing or mismatched; refusing startup.";
	if (!/^[a-z0-9][a-z0-9._-]*$/.test(sessionId) || sessionId.includes("..")) return "Invalid session identity; refusing startup.";
	const read = (file: string): unknown => {
		try { return JSON.parse(fs.readFileSync(file, "utf8")); }
		catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
	};
	for (const candidate of new Set([legacyHome, home])) {
		try {
			const dir = path.join(candidate, sessionId);
			const input = read(path.join(dir, "input.json"));
			if (input !== undefined) {
				if (!input || typeof input !== "object" || !("parent" in input)) throw new Error("Unknown legacy input");
				if (input.parent !== null) return "Legacy managed worker cannot load the new agents runtime. Do not reload legacy workers; start a fresh normal Pi session. No legacy state was imported.";
			}
			const lock = read(path.join(dir, "lock"));
			if (lock === undefined) continue;
			if (!lock || typeof lock !== "object" || !("pid" in lock) || !Number.isInteger(lock.pid) || (lock.pid as number) <= 0) throw new Error("Unknown legacy lock");
			if (lock.pid === process.pid && input !== undefined) continue; // same human writer may reload
			try { process.kill(lock.pid as number, 0); }
			catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") continue; throw error; }
			return "Legacy session has a live owner; refusing a second writer. Leave that session alone and start a fresh Pi session instead.";
		} catch {
			return "Cannot verify legacy session ownership; refusing startup without changing legacy state. Start a fresh Pi session instead.";
		}
	}
	return undefined;
}
