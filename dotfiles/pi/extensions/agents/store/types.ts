/** Shared six-state metadata contracts. The daemon owns SQLite writes; native Pi alone
 * writes its conversation. Agent directories hold session JSONL, native PTY socket and log.
 * The historical file-store fixture reuses these types but is not runtime supervision.
 */

/** Resolved launch profile, frozen in agent metadata so a respawn is identical. */
export interface ProfileSnapshot {
	name: string;
	modelId: string;
	provider?: string;
	thinking: string;
	tools?: string[];
	prompt?: string;
}

export interface AgentInput {
	id: string;
	/** `main` for a root agent, otherwise the profile/role name. */
	role: string;
	/** Short human slug, unique-ish within a parent. */
	name: string;
	/** Parent agent id; null for a root. */
	parent: string | null;
	objective: string;
	profile: ProfileSnapshot;
	cwd: string;
	/** Interactable agents run under a PTY holder and may be attached to. */
	interactable: boolean;
	/** Max time any single step may take without events. */
	stepTimeoutMs: number;
	/** Whole-run limit. Only meaningful for non-interactable agents. */
	runTimeoutMs?: number;
	depth: number;
	/** Spawn-time depth configuration, carried into the daemon's CLI tool allowlist. */
	spawnDepthLimit?: number;
	createdAt: number;
	/**
	 * Roots only: the agent (root) owning the pi session this one was forked/cloned from.
	 * Agents owned by it are inherited, read-only: listed, never controllable from here.
	 */
	forkedFrom?: string;
}

export const AGENT_STATUSES = ["working", "idle", "waiting-on-parent", "needs-you", "blocked", "archived"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

/** States that must not autonomously continue; process residency is independent. */
export const TERMINAL_STATUSES: readonly AgentStatus[] = ["blocked", "archived"];

export const isTerminal = (status: AgentStatus | EffectiveStatus): boolean =>
	(TERMINAL_STATUSES as readonly string[]).includes(status);

/** What an agent can be seen to be doing, from the outside. */
export interface InFlight {
	kind: "tool" | "model";
	name: string;
	/** Short, PHI-free description (never raw tool output). */
	summary: string;
	startedAt: number;
	/** Declared deadline for this step; absent means the step timeout applies. */
	deadline?: number;
}

interface Activity {
	/** Last pi lifecycle or streaming event. */
	lastEventAt: number;
	/** Last heartbeat tick; separates a wedged process from a quiet one. */
	lastSeenAt: number;
	inFlight: InFlight | null;
}

export interface AgentState {
	status: AgentStatus;
	/** When `status` last changed. */
	since: number;
	sessionFile?: string;
	/** Latest work/handoff summary. Completion is a message, not a workflow state. */
	summary?: string;
	/** Why a blocked execution cannot safely continue. */
	reason?: string;
	/** Latest addressed handoff, retained independently of process residency. */
	handoff?: { to: "parent" | "user"; recipient: string; messageId: string; at: number };
	/** Explicit human wrap-up request; permits a non-interactable worker to yield to that human. */
	yieldRequested?: boolean;
	/** Message the agent is waiting on an answer to. */
	waitingOn?: { messageId: string };
	/** Highest inbox message id already delivered into the session. */
	lastDelivered?: string;
	/** Start of the current autonomous run; whole-run limits count from here. */
	runStartedAt?: number;
	/** Self-reported one-line progress note (`set_status`), at most NOTE_MAX_CHARS. Model-written free text. */
	note?: string;
	activity: Activity;
}

export type MessageKind =
	| "instruction" // parent/user -> agent: do this
	| "question" // child -> parent or user
	| "answer" // reply to a question
	| "yield" // work-completed handoff; parent delivery always invokes its model
	| "stall" // watchdog -> parent: a child is stuck
	| "control" // interrupt | stop
	| "info"; // anything else, e.g. review comments

export type ControlAction = "interrupt" | "stop" | "request-yield";

export interface AgentMessage {
	/** Sortable: `<13-digit ms timestamp>-<random>`. Also the filename stem. */
	id: string;
	/** Agent id, `user`, or `user:review`. */
	from: string;
	to: string;
	kind: MessageKind;
	body: string;
	inReplyTo?: string;
	control?: ControlAction;
	/** `context` = inject into the model's context; `ui` = show only, no turn. */
	deliver: "context" | "ui";
	ts: number;
}

/** How the outside world sees an agent. */
export type EffectiveStatus = AgentStatus;

export interface AgentRecord {
	input: AgentInput;
	state: AgentState | undefined;
	alive: boolean;
	status: EffectiveStatus;
	/** Independent of task status; parked is expected absence, not lost. */
	residency?: "parked" | "starting" | "live" | "parking" | "blocked";
}

export type StallKind = "stall" | "overrun" | "run-overrun" | "wedged" | "lost";

export interface StallReport {
	kind: StallKind;
	/** Milliseconds beyond the relevant limit (or since last event for `stall`). */
	overMs: number;
	detail: string;
}

/** Longest summary kept in `state.summary`. */
export const SUMMARY_MAX_CHARS = 8000;
/** Longest status note (`set_status`), ellipsis included. */
export const NOTE_MAX_CHARS = 60;
/** Longest error text or question kept in `state.summary`. */
export const ERROR_MAX_CHARS = 500;
export const HEARTBEAT_MS = 15_000;
/** A freshly launched agent has no lock yet; it is "starting", not "lost", for this long. */
export const STARTING_GRACE_MS = 30_000;
/** First-token deadline of a model request, only for thinking levels xhigh/max; cleared on the first stream event. */
export const MODEL_REQUEST_DEADLINE_MS = 600_000;
/** Time given to a tool to die after its declared deadline before it counts as an overrun. */
export const OVERRUN_GRACE_MS = 5_000;
export const DEFAULT_STEP_TIMEOUT_MS = 180_000;
/**
 * A model request with no first-token deadline (thinking below xhigh/max) that has produced no provider
 * event (thinking, text, tool call, or any other stream event) for this long is stalled, even though the
 * step timeout is longer. Thinking arrives in chunks, so this must exceed normal gaps. Tools keep the step timeout.
 */
export const MODEL_SILENCE_MS = 120_000;
/**
 * A model request that has produced no event at all since it started (not even the response headers) is
 * waiting for its first token, which is legitimately minutes on very large prompts. Silence this long is a stall.
 */
export const MODEL_FIRST_EVENT_MS = 600_000;
export const DEFAULT_RUN_TIMEOUT_MS = 300_000;
/** A live process whose heartbeat is older than this is considered wedged. */
export const WEDGED_AFTER_MS = HEARTBEAT_MS * 4;

/** Collapse whitespace, trim, and cap at NOTE_MAX_CHARS (ellipsis included). Empty result means "no note". */
export function normalizeNote(raw: string): string {
	const flat = raw.replace(/\s+/g, " ").trim();
	const chars = [...flat];
	return chars.length > NOTE_MAX_CHARS ? `${chars.slice(0, NOTE_MAX_CHARS - 1).join("")}…` : flat;
}

/** Custom message type for mailbox messages delivered into the model's context. */
export const AGENT_MESSAGE = "agent_message";

/** `details` of a delivered `agent_message` (not sent to the model). */
export interface AgentMessageDetails {
	from: string;
	kind: string;
	id: string;
	inReplyTo?: string;
}

/** The text the model sees for a delivered message: sender and kind, then the body. */
export function agentMessageText(message: Pick<AgentMessage, "from" | "kind" | "id" | "body">): string {
	return `[from ${message.from} · ${message.kind} · ${message.id}]\n${message.body}`;
}
