/**
 * Tracks what the agent is doing and mirrors it into `state.activity`, throttled
 * so streaming does not hammer the disk. Transitions of `inFlight` always flush.
 */
import { type InFlight, MODEL_REQUEST_DEADLINE_MS, type Store } from "../store/index.ts";

const THROTTLE_MS = 1000;
const SUMMARY_MAX = 80;
/** Thinking levels whose first token may legitimately take minutes. */
const SLOW_THINKING: readonly string[] = ["xhigh", "max"];

interface ActivityDeps {
	store: Store;
	id: string;
	now?: () => number;
}

/**
 * A short, content-free hint of what a tool is doing: the tool name plus the
 * executable (bash) or file basename. Command arguments and patterns can carry
 * data, so they are never recorded.
 */
export function summarize(toolName: string, args: unknown): string {
	const a = (args ?? {}) as Record<string, unknown>;
	let hint = "";
	if (typeof a.command === "string") {
		hint = a.command.trim().split(/\s+/)[0] ?? "";
		hint = hint.split("/").pop() ?? hint;
	} else {
		const target = [a.path, a.file_path].find((v) => typeof v === "string") as string | undefined;
		if (target) hint = target.split("/").filter(Boolean).pop() ?? "";
	}
	hint = hint.slice(0, SUMMARY_MAX);
	return hint ? `${toolName}: ${hint}` : toolName;
}

export class ActivityTracker {
	private readonly store: Store;
	private readonly id: string;
	private readonly now: () => number;
	private tools = new Map<string, InFlight>();
	private model: InFlight | null = null;
	private streaming = false;
	private deadlines = new Map<string, number>();
	private lastEventAt: number;
	private lastFlush = 0;

	constructor(deps: ActivityDeps) {
		this.store = deps.store;
		this.id = deps.id;
		this.now = deps.now ?? Date.now;
		this.lastEventAt = this.now();
	}

	/** Any pi event: refreshes the liveness clock. Cheap; flushes at most once per THROTTLE_MS. */
	touch(): void {
		this.lastEventAt = this.now();
		if (this.lastEventAt - this.lastFlush >= THROTTLE_MS) this.flush();
	}

	/** Remember a declared deadline for a tool call that has not started executing yet. */
	declareDeadline(toolCallId: string, deadlineMs: number): void {
		this.deadlines.set(toolCallId, deadlineMs);
	}

	toolStart(toolCallId: string, toolName: string, args: unknown): void {
		const startedAt = this.now();
		const deadline = this.deadlines.get(toolCallId);
		this.deadlines.delete(toolCallId);
		this.tools.set(toolCallId, {
			kind: "tool",
			name: toolName,
			summary: summarize(toolName, args),
			startedAt,
			...(deadline !== undefined ? { deadline } : {}),
		});
		this.event(startedAt);
	}

	toolEnd(toolCallId: string): void {
		this.tools.delete(toolCallId);
		this.deadlines.delete(toolCallId);
		this.event(this.now());
	}

	/**
	 * A model request began. Only the slowest thinking levels get a long first-token deadline
	 * (silent thinking is legitimate there). Nothing else has a deadline unless the caller requested
	 * an explicit step timeout, so a slow first token is otherwise never treated as a hang. The
	 * deadline is dropped on the first real output (`streamStart`).
	 */
	modelStart(thinking?: string): void {
		const startedAt = this.now();
		this.streaming = false;
		this.model = {
			kind: "model",
			name: "request",
			summary: "model request",
			startedAt,
			...(thinking !== undefined && SLOW_THINKING.includes(thinking) ? { deadline: startedAt + MODEL_REQUEST_DEADLINE_MS } : {}),
		};
		this.event(startedAt);
	}

	/**
	 * The first real output (text or a tool call; not thinking, and not the response headers that
	 * open the stream): from here on only an explicitly requested step timeout can call the silence
	 * a hang. Clears the first-token deadline and always flushes.
	 */
	streamStart(): void {
		if (this.streaming || !this.model) return;
		this.streaming = true;
		const { deadline: _dropped, ...rest } = this.model;
		this.model = rest;
		this.event(this.now());
	}

	modelEnd(): void {
		this.model = null;
		this.streaming = false;
		this.event(this.now());
	}

	/** Run ended or session replaced: nothing can be in flight any more. */
	reset(): void {
		this.tools.clear();
		this.deadlines.clear();
		this.model = null;
		this.streaming = false;
		this.flush();
	}

	/** The longest-running tool wins; otherwise the model request; otherwise nothing. */
	current(): InFlight | null {
		let oldest: InFlight | null = null;
		for (const step of this.tools.values()) if (!oldest || step.startedAt < oldest.startedAt) oldest = step;
		return oldest ?? this.model;
	}

	/** An in-flight transition: stamp the event time and write immediately. */
	private event(at: number): void {
		this.lastEventAt = at;
		this.flush();
	}

	flush(extra: { lastSeenAt?: number } = {}): void {
		this.lastFlush = this.now();
		try {
			this.store.writeState(this.id, {
				activity: { ...extra, lastEventAt: this.lastEventAt, inFlight: this.current() },
			});
		} catch (error) {
			process.stderr.write(`[agents] activity write failed: ${String(error)}\n`);
		}
	}

	/** Heartbeat tick: prove the process is alive and responsive. Also flushes pending activity. */
	heartbeat(): void {
		this.flush({ lastSeenAt: this.now() });
	}
}
