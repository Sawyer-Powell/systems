/**
 * The supervisor: creating, launching, resuming and signalling agents on behalf
 * of this process's agent (or of the user, through the UI). Never writes a live
 * agent's state; a dead agent's state may be reset by whoever resumes it.
 */
import * as fs from "node:fs";
import type { AgentsHost } from "../host.ts";
import { maxDepth, selfId } from "../host.ts";
import {
	type AgentInput,
	DEFAULT_RUN_TIMEOUT_MS,
	DEFAULT_STEP_TIMEOUT_MS,
	isTerminal,
	newId,
	STARTING_GRACE_MS,
} from "../store/index.ts";
import { agentToolNames } from "../tool-names.ts";
import { buildChildArgs, killGroup, onPath, planLaunch, spawnDetached } from "./launch.ts";
import { describeProfiles, loadProfiles, resolveProfile } from "./profiles.ts";

interface SpawnRequest {
	/** Profile name from `~/.pi/agent/agents/*.md`. */
	profile: string;
	/** Short slug for the id and display name. */
	name?: string;
	objective: string;
	stepTimeoutMs?: number;
	/** Only honoured for non-interactable profiles. */
	runTimeoutMs?: number;
}

type Signal = "interrupt" | "stop" | "kill";

export interface Supervisor {
	spawn(request: SpawnRequest): Promise<AgentInput>;
	resume(id: string, instruction?: string): Promise<void>;
	signal(id: string, signal: Signal): Promise<void>;
	redrive(id: string, note: string): Promise<void>;
	profiles(): Array<{ name: string; description: string; interactable: boolean }>;
}

const KILL_GRACE_MS = 5000;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function resumeMessage(input: AgentInput, previousStatus: string, summary: string | undefined, instruction?: string): string {
	return [
		`You are resuming a previously interrupted task: ${input.objective}`,
		`Your previous run ended as "${previousStatus}"${summary ? ` (${summary.slice(0, 200)})` : ""}. ` +
			"A step that was in flight when you stopped may have been lost: re-check the current state (files, `jj st`) before acting.",
		instruction ? `New instruction: ${instruction}` : "Continue where you left off.",
	].join("\n\n");
}

export function createSupervisor(host: AgentsHost): Supervisor {
	const { store } = host;

	async function launch(input: AgentInput, message: string, sessionFile?: string): Promise<void> {
		if (input.interactable && !onPath("dtach")) {
			throw new Error("dtach is not on PATH. Install it (nix: add `dtach` to home.packages) to run attachable agents.");
		}
		const childCanSpawn = input.interactable && input.depth < maxDepth(host.pi);
		// A dead dtach master leaves its socket behind and `dtach -n` refuses to reuse it.
		if (input.interactable) fs.rmSync(store.ptySocket(input.id), { force: true });
		const args = buildChildArgs(input, input.profile, {
			message,
			dir: store.dir(input.id),
			sessionFile: sessionFile && fs.existsSync(sessionFile) ? sessionFile : undefined,
			headless: !input.interactable,
			extraTools: agentToolNames(input.interactable, childCanSpawn),
		});
		const plan = planLaunch(input, args, { home: store.home, ptySocket: store.ptySocket(input.id) });
		await spawnDetached(plan, store.logPath(input.id), input.interactable);
	}

	async function waitDead(id: string, ms: number): Promise<boolean> {
		const deadline = Date.now() + ms;
		while (Date.now() < deadline) {
			if (!store.isAlive(id)) return true;
			await sleep(100);
		}
		return !store.isAlive(id);
	}

	return {
		async spawn(request) {
			if (!host.canSpawn) throw new Error("This agent may not spawn agents (not interactable, or at maximum depth).");
			const parent = selfId(host);
			const ctx = host.ctx;
			if (!ctx) throw new Error("Cannot spawn before session_start.");
			const { role, interactable, timeoutMs, ...snapshot } = resolveProfile(host.pi, ctx, request.profile);
			const name = request.name ?? request.objective.slice(0, 24);
			const id = newId(role, name);
			const input: AgentInput = {
				id,
				role,
				name: id.split(".")[1] ?? name,
				parent,
				objective: request.objective,
				profile: snapshot,
				cwd: host.identity?.cwd ?? ctx.cwd,
				interactable,
				stepTimeoutMs: request.stepTimeoutMs ?? DEFAULT_STEP_TIMEOUT_MS,
				...(interactable ? {} : { runTimeoutMs: request.runTimeoutMs ?? timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS }),
				depth: (host.identity?.depth ?? 0) + 1,
				createdAt: Date.now(),
			};
			store.create(input);
			try {
				await launch(input, request.objective);
			} catch (error) {
				store.writeState(id, { status: "error", summary: `launch failed: ${String(error).slice(0, 300)}` });
				throw error;
			}
			return input;
		},

		async resume(id, instruction) {
			const input = store.readInput(id);
			if (!input) throw new Error(`Unknown agent ${id}.`);
			if (input.role === "main") throw new Error("A root session cannot be resumed; start a new pi instead.");
			if (store.isAlive(id)) throw new Error(`Agent ${id} is already running.`);
			const state = store.readState(id);
			if (state?.status === "starting" && Date.now() - state.since < STARTING_GRACE_MS) {
				throw new Error(`Agent ${id} is already starting.`);
			}
			const message = resumeMessage(input, store.record(id)?.status ?? "lost", state?.summary, instruction);
			const now = Date.now();
			store.writeState(id, {
				status: "starting",
				summary: undefined,
				waitingOn: undefined,
				note: undefined,
				runStartedAt: now,
				activity: { lastEventAt: now, lastSeenAt: now, inFlight: null },
			});
			try {
				await launch(input, message, state?.sessionFile);
			} catch (error) {
				store.writeState(id, { status: "error", summary: `resume failed: ${String(error).slice(0, 300)}` });
				throw error;
			}
		},

		async signal(id, signal) {
			if (!store.exists(id)) throw new Error(`Unknown agent ${id}.`);
			if (signal === "kill") {
				const pid = store.lockPid(id);
				if (pid === undefined || !store.isAlive(id)) throw new Error(`Agent ${id} is not running.`);
				killGroup(pid, "SIGTERM");
				if (!(await waitDead(id, KILL_GRACE_MS))) {
					killGroup(pid, "SIGKILL");
					await waitDead(id, 2000);
				}
				const status = store.readState(id)?.status;
				if (status && !isTerminal(status) && !store.isAlive(id)) {
					store.writeState(id, { status: "stopped", summary: "killed" });
				}
				return;
			}
			const from = host.identity && store.canMessage(host.identity.id, id) ? host.identity.id : "user";
			store.send({ from, to: id, kind: "control", control: signal, body: signal, deliver: "context" });
		},

		async redrive(id, note) {
			await this.signal(id, "kill").catch(() => {});
			await this.resume(id, `The previous run was stopped because it stalled. ${note}`);
		},

		profiles: () => describeProfiles(loadProfiles()),
	};
}
