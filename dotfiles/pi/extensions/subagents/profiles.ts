/**
 * Profiles: a named argv preset for a spawned pi process.
 *
 * A profile compiles 1:1 onto pi's own launch surface (docs/cli.md), and holds
 * nothing that surface cannot express:
 *   model alias + thinking -> --model / --thinking
 *   tools                  -> --tools
 *   body                   -> --append-system-prompt <file>
 *
 * The main agent is not a profile. Pi configures it natively at startup:
 * settings.json (`defaultModel`, `defaultThinkingLevel`, `defaultTools`) and
 * `<agent-dir>/APPEND_SYSTEM.md`. Nothing is applied to a running agent.
 *
 * A profile is a markdown file in `~/.pi/agent/agents/*.md`; `fast` / `deliberate`
 * are model aliases configured under `agents.models` in `~/.pi/agent/settings.json`.
 * Spawn depth comes from `agents.maxDepth`.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";

export type ModelAlias = "fast" | "deliberate";

/** Same values as `pi --thinking`. */
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface ModelTarget {
	/** Explicit pi provider (e.g. "openrouter"). Omit to let pi resolve. */
	provider?: string;
	model: string;
	thinking: ThinkingLevel;
}

/** Fully resolved profile: everything `toChildArgs` needs. */
export interface Profile {
	name: string;
	description: string;
	model: ModelAlias;
	/** Concrete model id the alias resolves to. */
	modelId: string;
	provider?: string;
	thinking: ThinkingLevel;
	tools?: string[];
	prompt?: string;
}

/** Unresolved profile, as written in frontmatter or passed as overrides. */
export interface ProfileInput {
	name?: string;
	description?: string;
	model?: ModelAlias;
	thinking?: string;
	tools?: string[];
	prompt?: string;
	extends?: string[];
}

const DEFAULT_TARGETS: Record<ModelAlias, ModelTarget> = {
	fast: { model: "deepseek/deepseek-v4.1-flash-1017", thinking: "off" },
	deliberate: { model: "deepseek/deepseek-v4.1-flash-1017", thinking: "high" },
};

const DEFAULT_MAX_DEPTH = 3;

interface AgentSettings {
	agents?: {
		models?: Partial<Record<ModelAlias, Partial<ModelTarget>>>;
		maxDepth?: number;
	};
}

function agentSettings(pi: ExtensionAPI): AgentSettings {
	return pi.getSettings() as AgentSettings;
}

export function getTargets(pi: ExtensionAPI): Record<ModelAlias, ModelTarget> {
	const configured = agentSettings(pi).agents?.models ?? {};
	return {
		fast: { ...DEFAULT_TARGETS.fast, ...configured.fast },
		deliberate: { ...DEFAULT_TARGETS.deliberate, ...configured.deliberate },
	};
}

/** How deep subagents may nest. Not a launch flag, so it lives in settings. */
export function maxDepth(pi: ExtensionAPI): number {
	const configured = agentSettings(pi).agents?.maxDepth;
	return typeof configured === "number" && configured >= 0 ? configured : DEFAULT_MAX_DEPTH;
}

// --- Loading markdown profiles ---------------------------------------------

function asString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function asTools(value: unknown): string[] | undefined {
	const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
	const tools = raw.filter((t): t is string => typeof t === "string").map((t) => t.trim()).filter(Boolean);
	return tools.length > 0 ? tools : undefined;
}

function asExtends(value: unknown): string[] | undefined {
	const list = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
	const names = list.filter((n): n is string => typeof n === "string");
	return names.length > 0 ? names : undefined;
}

function fromFrontmatter(frontmatter: Record<string, unknown>, body: string): ProfileInput {
	const text = body.trim();
	return {
		name: asString(frontmatter.name),
		description: asString(frontmatter.description),
		model: frontmatter.model === "fast" || frontmatter.model === "deliberate" ? frontmatter.model : undefined,
		thinking: asString(frontmatter.thinking),
		tools: asTools(frontmatter.tools),
		prompt: text || undefined,
		extends: asExtends(frontmatter.extends),
	};
}

/** Read every profile fresh so edits apply on the next spawn. */
export function loadProfiles(): Map<string, ProfileInput> {
	const dir = path.join(getAgentDir(), "agents");
	const profiles = new Map<string, ProfileInput>();
	if (!fs.existsSync(dir)) return profiles;
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (!entry.name.endsWith(".md")) continue;
		const { frontmatter, body } = parseFrontmatter(fs.readFileSync(path.join(dir, entry.name), "utf-8"));
		const input = fromFrontmatter(frontmatter, body);
		if (input.name) profiles.set(input.name, input);
	}
	return profiles;
}

// --- Resolution -------------------------------------------------------------

function mergeInputs(inputs: ProfileInput[]): ProfileInput {
	const merged: ProfileInput = {};
	for (const input of inputs) {
		for (const [key, value] of Object.entries(input)) {
			if (value !== undefined) (merged as Record<string, unknown>)[key] = value;
		}
	}
	delete merged.extends;
	return merged;
}

function compose(name: string, profiles: Map<string, ProfileInput>, seen: Set<string>): ProfileInput {
	const self = profiles.get(name);
	if (!self) throw new Error(`Unknown profile "${name}". Available: ${[...profiles.keys()].join(", ") || "none"}`);
	if (seen.has(name)) throw new Error(`Profile extends cycle at "${name}"`);
	seen.add(name);
	return mergeInputs([...(self.extends ?? []).map((base) => compose(base, profiles, seen)), self]);
}

export function resolve(pi: ExtensionAPI, inputs: ProfileInput[]): Profile {
	const merged = mergeInputs(inputs);
	const model = merged.model ?? "deliberate";
	const target = getTargets(pi)[model];
	return {
		name: merged.name ?? "main",
		description: merged.description ?? "",
		model,
		modelId: target.model,
		provider: target.provider,
		thinking: (merged.thinking as ThinkingLevel | undefined) ?? target.thinking,
		tools: merged.tools,
		prompt: merged.prompt,
	};
}

export function resolveNamed(pi: ExtensionAPI, name: string): Profile {
	return resolve(pi, [compose(name, loadProfiles(), new Set())]);
}

/** A subagent: its named profile, then inline overrides. Never inherits the parent. */
export function resolveSubagent(pi: ExtensionAPI, override: ProfileInput): Profile {
	const named = override.name ? compose(override.name, loadProfiles(), new Set()) : {};
	return resolve(pi, [named, override]);
}

// --- Child argv -------------------------------------------------------------

export interface ChildSession {
	sessionId: string;
	sessionFile?: string;
}

function writePromptFile(name: string, prompt: string): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-agent-"));
	const file = path.join(dir, `${name.replace(/[^\w.-]+/g, "_")}.md`);
	fs.writeFileSync(file, prompt, { mode: 0o600 });
	return file;
}

/** The child's whole launch spec, as pi's own CLI surface. */
export function toChildArgs(profile: Profile, selfPath: string, session: ChildSession): string[] {
	const args = [
		"--mode", "rpc",
		"--no-extensions", "-e", selfPath,
		"--name", `sub:${profile.name}`,
		...(session.sessionFile ? ["--session", session.sessionFile] : ["--session-id", session.sessionId]),
		...(profile.provider ? ["--provider", profile.provider] : []),
		"--model", profile.modelId,
		"--thinking", profile.thinking,
	];
	if (profile.tools) args.push("--tools", profile.tools.join(","));
	if (profile.prompt) args.push("--append-system-prompt", writePromptFile(profile.name, profile.prompt));
	return args;
}
