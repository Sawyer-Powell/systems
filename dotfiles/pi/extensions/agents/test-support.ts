/** Shared test fixtures. Not a test file: `scripts/test.sh` only runs `*.test.ts`. */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach } from "node:test";
import { type AgentInput, createStore, type Store } from "./store/index.ts";

/** A minimal valid `AgentInput`; the role is the first dot-segment of the id. */
export function mkInput(id: string, parent: string | null, extra: Partial<AgentInput> = {}): AgentInput {
	return {
		id,
		role: id.split(".")[0] ?? "x",
		name: id,
		parent,
		objective: "o",
		profile: { name: "p", modelId: "m", thinking: "low" },
		cwd: "/tmp",
		interactable: true,
		depth: parent ? 1 : 0,
		createdAt: Date.now(),
		...extra,
	};
}

/**
 * Register hooks that give every test a fresh temp home and store (never `~/.pi/agents`).
 * Read `.home` / `.store` inside tests; they are replaced before each one.
 */
export function useTempStore(prefix: string): { readonly home: string; readonly store: Store } {
	let home = "";
	let store: Store | undefined;
	beforeEach(() => {
		home = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
		store = createStore(home);
	});
	afterEach(() => fs.rmSync(home, { recursive: true, force: true }));
	return {
		get home() {
			return home;
		},
		get store() {
			return store!;
		},
	};
}
