/**
 * Process launching: argv construction (pure, tested) and detached spawning.
 *
 * Interactable agents run interactive pi inside `dtach` so a zellij tab can
 * attach and detach without killing them. Non-interactable agents run headless
 * `pi -p` and exit when done. Nothing here inherits the parent's session.
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentInput, ProfileSnapshot } from "../store/index.ts";

/** Directory of this extension (what `-e` loads in the child). */
const EXTENSION_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** unix socket paths are capped at ~104 bytes on macOS. */
const MAX_SOCKET_PATH = 100;

interface ChildArgsOptions {
	/** First user message. Passed through a 0600 file, never argv (argv is visible to `ps`). */
	message: string;
	/** Agent directory: prompt files live (and die) there. */
	dir: string;
	/** Reopen this session instead of starting a fresh one. */
	sessionFile?: string;
	headless: boolean;
	extensionDir?: string;
	/** Tools this extension registers for the child; pi's `--tools` allowlist would otherwise hide them. */
	extraTools?: string[];
}

function writePromptFile(name: string, prompt: string, dir: string): string {
	const file = path.join(dir, `${name.replace(/[^\w.-]+/g, "_")}.md`);
	fs.writeFileSync(file, prompt, { mode: 0o600 });
	return file;
}

/** pi's own launch surface, nothing proprietary. The message is last so it is never parsed as a flag value. */
export function buildChildArgs(
	input: Pick<AgentInput, "id">,
	profile: ProfileSnapshot,
	options: ChildArgsOptions,
	writePrompt: (name: string, prompt: string) => string = (name, prompt) => writePromptFile(name, prompt, options.dir),
): string[] {
	const args = [
		"--no-extensions",
		"-e",
		options.extensionDir ?? EXTENSION_DIR,
		"--name",
		`agent:${input.id}`,
		// Agent sessions live in the agent's own directory so they never mix into the user's
		// `/resume` list or `pi --continue` for this project.
		"--session-dir",
		path.join(options.dir, "sessions"),
		...(options.sessionFile ? ["--session", options.sessionFile] : ["--session-id", input.id]),
		...(profile.provider ? ["--provider", profile.provider] : []),
		"--model",
		profile.modelId,
		"--thinking",
		profile.thinking,
	];
	const extra = options.extraTools ?? [];
	if (profile.tools) args.push("--tools", [...profile.tools, ...extra].join(","));
	else if (extra.length > 0) args.push("--tools", extra.map((name) => `+${name}`).join(","));
	if (profile.prompt) args.push("--append-system-prompt", writePrompt(`system-${profile.name}`, profile.prompt));
	if (options.headless) args.push("-p");
	if (options.message) args.push("--", `@${writePrompt(`message-${Date.now()}`, options.message)}`);
	return args;
}

/** Run the same pi entry point that is hosting this extension. */
function piInvocation(args: string[]): { command: string; args: string[] } {
	const script = process.argv[1];
	if (script && !script.startsWith("/$bunfs/") && fs.existsSync(script)) {
		return { command: process.execPath, args: [script, ...args] };
	}
	if (/^(node|bun)(\.exe)?$/i.test(path.basename(process.execPath))) return { command: "pi", args };
	return { command: process.execPath, args };
}

interface LaunchPlan {
	command: string;
	args: string[];
	env: NodeJS.ProcessEnv;
	cwd: string;
}

export function childEnv(base: NodeJS.ProcessEnv, home: string): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...base, PI_AGENTS_HOME: home };
	delete env.PI_SESSION_ID;
	delete env.PI_SESSION_FILE;
	return env;
}

export function planLaunch(
	input: AgentInput,
	args: string[],
	opts: { home: string; ptySocket: string; baseEnv?: NodeJS.ProcessEnv; dtach?: string },
): LaunchPlan {
	const pi = piInvocation(args);
	const env = childEnv(opts.baseEnv ?? process.env, opts.home);
	if (!input.interactable) return { command: pi.command, args: pi.args, env, cwd: input.cwd };
	if (opts.ptySocket.length > MAX_SOCKET_PATH) {
		throw new Error(`PTY socket path too long (${opts.ptySocket.length} > ${MAX_SOCKET_PATH}): ${opts.ptySocket}`);
	}
	return {
		command: opts.dtach ?? "dtach",
		args: ["-n", opts.ptySocket, "-r", "winch", pi.command, ...pi.args],
		env,
		cwd: input.cwd,
	};
}

/** True when `name` resolves on PATH. */
export function onPath(name: string, envPath = process.env.PATH ?? ""): boolean {
	return envPath.split(path.delimiter).some((dir) => {
		try {
			fs.accessSync(path.join(dir, name), fs.constants.X_OK);
			return true;
		} catch {
			return false;
		}
	});
}

/**
 * Spawn detached (own process group), stdio to the log. Resolves once
 * the process has started. With `waitForExit` (used for `dtach -n`, which forks and
 * returns) it instead waits for the launcher to exit and rejects on a non-zero code.
 */
export function spawnDetached(plan: LaunchPlan, logPath: string, waitForExit = false): Promise<void> {
	return new Promise((resolve, reject) => {
		const logFd = fs.openSync(logPath, "a", 0o600);
		const child = spawn(plan.command, plan.args, {
			cwd: plan.cwd,
			env: plan.env,
			detached: process.platform !== "win32",
			stdio: ["ignore", logFd, logFd],
		});
		child.once("error", (error) => {
			fs.closeSync(logFd);
			reject(error);
		});
		if (waitForExit) {
			child.once("exit", (code) => {
				fs.closeSync(logFd);
				if (code === 0) resolve();
				else reject(new Error(`${plan.command} exited with code ${code}; see ${logPath}`));
			});
			return;
		}
		child.once("spawn", () => {
			fs.closeSync(logFd);
			child.unref();
			resolve();
		});
	});
}

/** Kill a whole process group; fall back to the pid. Ignores "already gone". */
export function killGroup(pid: number, signal: NodeJS.Signals): void {
	for (const target of [-pid, pid]) {
		try {
			process.kill(target, signal);
			return;
		} catch {
			// try the next form
		}
	}
}
