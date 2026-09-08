/**
 * Contracts for the agent store: plain files under `~/.pi/agents/<id>/`.
 *
 *   input.json   immutable; created once, exclusively, by the creator
 *   state.json   mutable; written only by the agent itself (or by whoever holds
 *                the lock of a dead agent)
 *   inbox/       one JSON file per message, named `<message id>.json`
 *   log          stdout/stderr of the agent process
 *   lock         pid + process start time; presence of a live owner = liveness
 *   pty.sock     dtach socket (interactable agents only)
 */

/** Resolved launch profile, frozen into `input.json` so a respawn is identical. */
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
	createdAt: number;
}

export type AgentStatus =
	| "starting"
	| "idle" // alive, no run in progress, waiting for messages
	| "working"
	| "waiting-on-parent"
	| "waiting-on-user"
	| "done"
	| "stopped"
	| "error"
	| "timed-out";

/** Statuses after which the process is expected to be gone. */
export const TERMINAL_STATUSES: readonly AgentStatus[] = ["done", "stopped", "error", "timed-out"];

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
	/** Final or latest summary, set on `report_done`. */
	summary?: string;
	/** Message the agent is waiting on an answer to. */
	waitingOn?: { messageId: string };
	/** Highest inbox message id already delivered into the session. */
	lastDelivered?: string;
	/** Start of the current process run (launch or resume); whole-run limits count from here. */
	runStartedAt?: number;
	/** Self-reported one-line progress note (`set_status`), at most NOTE_MAX_CHARS. Model-written free text. */
	note?: string;
	activity: Activity;
}

export type MessageKind =
	| "instruction" // parent/user -> agent: do this
	| "question" // child -> parent or user
	| "answer" // reply to a question
	| "result" // child -> parent: finished
	| "stall" // watchdog -> parent: a child is stuck
	| "control" // interrupt | stop
	| "info"; // anything else, e.g. review comments

export type ControlAction = "interrupt" | "stop";

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
export type EffectiveStatus = AgentStatus | "lost";

export interface AgentRecord {
	input: AgentInput;
	state: AgentState | undefined;
	alive: boolean;
	status: EffectiveStatus;
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
/** A model request legitimately goes quiet while the model thinks; it gets a long fixed deadline. */
export const MODEL_REQUEST_DEADLINE_MS = 600_000;
/** Time given to a tool to die after its declared deadline before it counts as an overrun. */
export const OVERRUN_GRACE_MS = 5_000;
export const DEFAULT_STEP_TIMEOUT_MS = 180_000;
export const DEFAULT_RUN_TIMEOUT_MS = 300_000;
/** A live process whose heartbeat is older than this is considered wedged. */
export const WEDGED_AFTER_MS = HEARTBEAT_MS * 4;

/** Collapse whitespace, trim, and cap at NOTE_MAX_CHARS (ellipsis included). Empty result means "no note". */
export function normalizeNote(raw: string): string {
	const flat = raw.replace(/\s+/g, " ").trim();
	const chars = [...flat];
	return chars.length > NOTE_MAX_CHARS ? `${chars.slice(0, NOTE_MAX_CHARS - 1).join("")}…` : flat;
}
