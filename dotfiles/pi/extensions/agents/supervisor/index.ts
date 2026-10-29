/**
 * The supervisor: creating, launching, resuming and signalling agents on behalf
 * of this process's agent (or of the user, through the UI). Never writes a live
 * agent's state; a dead agent's state may be reset by whoever resumes it.
 */
import type { AgentsHost } from "../host.ts";
import { maxDepth, selfId } from "../host.ts";
import {
	type AgentInput,
	DEFAULT_RUN_TIMEOUT_MS,
	DEFAULT_STEP_TIMEOUT_MS,
	newId,
} from "../store/index.ts";
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

	const command = async (op: string, args: unknown) => {
		if (!host.connection) throw new Error("Central runtime connection required");
		await host.connection.flush();
		return host.connection.request(op, args);
	};

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
				spawnDepthLimit: host.identity?.spawnDepthLimit ?? maxDepth(host.pi),
				createdAt: Date.now(),
			};
			await command("spawn", { input });
			return input;
		},

		async resume(id, instruction) {
			const input = store.readInput(id);
			if (!input) throw new Error(`Unknown agent ${id}.`);
			if (input.role === "main") throw new Error("A root session cannot be resumed; start a new pi instead.");
			const record = store.record(id);
			const message = record?.residency === "parked" ? instruction : resumeMessage(input, record?.status ?? "lost", record?.state?.summary, instruction);
			await command("resume", { id, instruction: message });
		},

		async signal(id, signal) {
			if (!store.exists(id)) throw new Error(`Unknown agent ${id}.`);
			if (signal === "kill") {
				await command("kill", { id });
				return;
			}
			const from = host.identity && store.canMessage(host.identity.id, id) ? host.identity.id : "user";
			store.send({ from, to: id, kind: "control", control: signal, body: signal, deliver: "context" });
			await host.connection?.flush();
		},

		async redrive(id, note) {
			await this.signal(id, "kill").catch(() => {});
			await this.resume(id, `The previous run was stopped because it stalled. ${note}`);
		},

		profiles: () => describeProfiles(loadProfiles()),
	};
}
