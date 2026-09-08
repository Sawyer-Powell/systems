/**
 * Profiles: markdown files in `~/.pi/agent/agents/*.md` that describe a kind of
 * agent, with `interactable`, `timeout` (minutes, whole-run limit for non-interactable
 * agents) and `role`.
 *
 * Model tiers (`fast` / `deliberate`) resolve per machine to the first model with
 * configured auth among: `agents.models.<tier>`, each `agents.fallback` entry, then
 * the parent's current model. Nothing is hardcoded.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import type { ProfileSnapshot } from "../store/index.ts";

type ModelAlias = "fast" | "deliberate";
type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

interface ModelRef {
	provider: string;
	model: string;
}

interface ModelTarget {
	provider?: string;
	model: string;
	thinking: ThinkingLevel;
}

interface ProfileInput {
	name?: string;
	description?: string;
	model?: ModelAlias;
	thinking?: string;
	tools?: string[];
	prompt?: string;
	extends?: string[];
	interactable?: boolean;
	/** Whole-run limit in minutes. */
	timeoutMinutes?: number;
	role?: string;
}

interface ResolvedProfile extends ProfileSnapshot {
	role: string;
	interactable: boolean;
	timeoutMs?: number;
}

const DEFAULT_THINKING: Record<ModelAlias, ThinkingLevel> = { fast: "low", deliberate: "high" };

interface AgentSettings {
	agents?: {
		models?: Partial<Record<ModelAlias, Partial<ModelTarget>>>;
		fallback?: ModelRef[];
	};
}

/** First model with configured auth wins; the parent's own model is the last resort. */
function resolveTarget(pi: ExtensionAPI, ctx: ExtensionContext, alias: ModelAlias): ModelTarget {
	const settings = (pi.getSettings() as AgentSettings).agents;
	const tier = settings?.models?.[alias] ?? {};
	const thinking = tier.thinking ?? DEFAULT_THINKING[alias];
	const candidates: Partial<ModelRef>[] = [
		...(tier.model ? [{ provider: tier.provider, model: tier.model }] : []),
		...(settings?.fallback ?? []),
	];
	for (const { provider, model } of candidates) {
		if (!model) continue;
		const found = provider
			? ctx.modelRegistry.find(provider, model)
			: ctx.modelRegistry.getAvailable().find((m) => m.id === model);
		if (found && ctx.modelRegistry.hasConfiguredAuth(found)) {
			return { provider: found.provider, model: found.id, thinking };
		}
	}
	if (ctx.model) return { provider: ctx.model.provider, model: ctx.model.id, thinking };
	throw new Error(
		`No usable model for tier "${alias}": none of its configured/fallback models have auth, and the parent has no model. ` +
			`Run /login or set agents.models.${alias} / agents.fallback in settings.json.`,
	);
}

const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

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

function asBool(value: unknown): boolean | undefined {
	if (typeof value === "boolean") return value;
	if (value === "true") return true;
	if (value === "false") return false;
	return undefined;
}

function asNumber(value: unknown): number | undefined {
	const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
	return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function fromFrontmatter(frontmatter: Record<string, unknown>, body: string): ProfileInput {
	const text = body.trim();
	return {
		name: str(frontmatter.name),
		description: str(frontmatter.description),
		model: frontmatter.model === "fast" || frontmatter.model === "deliberate" ? frontmatter.model : undefined,
		thinking: str(frontmatter.thinking),
		tools: asTools(frontmatter.tools),
		prompt: text || undefined,
		extends: asExtends(frontmatter.extends),
		interactable: asBool(frontmatter.interactable),
		timeoutMinutes: asNumber(frontmatter.timeout),
		role: str(frontmatter.role),
	};
}

export function loadProfiles(dir = path.join(getAgentDir(), "agents")): Map<string, ProfileInput> {
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

function mergeInputs(inputs: ProfileInput[]): ProfileInput {
	const merged: Record<string, unknown> = {};
	for (const input of inputs) {
		for (const [key, value] of Object.entries(input)) if (value !== undefined) merged[key] = value;
	}
	delete merged.extends;
	return merged as ProfileInput;
}

export function compose(name: string, profiles: Map<string, ProfileInput>, seen = new Set<string>()): ProfileInput {
	const self = profiles.get(name);
	if (!self) throw new Error(`Unknown profile "${name}". Available: ${[...profiles.keys()].join(", ") || "none"}`);
	if (seen.has(name)) throw new Error(`Profile extends cycle at "${name}"`);
	seen.add(name);
	return mergeInputs([...(self.extends ?? []).map((base) => compose(base, profiles, seen)), self]);
}

export function resolveProfile(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	name: string,
	profiles: Map<string, ProfileInput> = loadProfiles(),
): ResolvedProfile {
	const merged = compose(name, profiles);
	const alias = merged.model ?? "deliberate";
	const target = resolveTarget(pi, ctx, alias);
	return {
		name: merged.name ?? name,
		role: merged.role ?? merged.name ?? name,
		modelId: target.model,
		provider: target.provider,
		thinking: (merged.thinking as ThinkingLevel | undefined) ?? target.thinking,
		tools: merged.tools,
		prompt: merged.prompt,
		interactable: merged.interactable ?? false,
		timeoutMs: merged.timeoutMinutes !== undefined ? merged.timeoutMinutes * 60_000 : undefined,
	};
}

export function describeProfiles(
	profiles: Map<string, ProfileInput>,
): Array<{ name: string; description: string; interactable: boolean }> {
	return [...profiles.keys()].map((name) => {
		const merged = compose(name, profiles);
		return { name, description: merged.description ?? "", interactable: merged.interactable ?? false };
	});
}
