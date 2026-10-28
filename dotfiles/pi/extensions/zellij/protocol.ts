/**
 * Process protocol.
 *
 * The core is a router: it resolves a kind, validates its config, opens a pane,
 * and routes messages. It never knows a process's command line or transport.
 * Each kind is a service implementing this interface.
 *
 * Safety: the model never supplies argv. `config` is validated against the
 * kind's schema, and only trusted kind code builds the command line. A handle
 * can only address a record the core created.
 *
 * A spawn has a *relation*:
 *   - child: the core owns a control channel (socket) and can message it;
 *   - sibling: the process is launched into a pane or tab for a human to drive,
 *     and the core deliberately gets no way to talk to it.
 * The distinction lives here, not in the tools: a kind decides which relations
 * it can produce, and a kind's `spawn` builds the appropriate command line.
 */
import type { TSchema } from "typebox";

/** How a spawned process relates to this session's agent. */
export type ProcessRelation = "child" | "sibling";

/** A kind's decision on how to launch its process in a pane. */
export interface SpawnSpec {
	/** Process + arguments, passed to zellij as `-- <argv>`. Built by the kind. */
	argv: string[];
	/** Live binding the kind needs to reach the process later (socket, port, ...). */
	runtime: Record<string, unknown>;
	/** Default pane title. */
	name: string;
	/** Suggested working directory for the process; the caller's explicit request wins. */
	cwd?: string;
}

export interface ProcessMessage {
	type: string;
	[key: string]: unknown;
}

export interface SendResult {
	/** Model-facing summary. */
	text: string;
	/** Optional structured data for the tool result. */
	details?: Record<string, unknown>;
}

/**
 * Durable record of a process the core started. Persisted in tool-result
 * `details`, so it is reconstructed per branch and survives forks.
 */
export interface ProcessRecord<TRuntime = Record<string, unknown>> {
	/** `p<n>` for children, `s<n>` for siblings. Always unique per branch. */
	handle: string;
	kind: string;
	/** Absent on records written before relations existed, which were all children. */
	relation?: ProcessRelation;
	/** Tab the process lives in. Pane ids are per tab, so this scopes `paneId`. */
	tabId?: string;
	/** Empty when the pane could not be resolved right after creation. */
	paneId: string;
	/** How the process was placed: a pane in the focused tab, or its own new tab. */
	target?: "pane" | "tab";
	name: string;
	/** Working directory the process was launched in. */
	cwd: string;
	config: Record<string, unknown>;
	runtime: TRuntime;
	createdAt: string;
}

/** A process kind (a service). All process-specific knowledge lives here. */
export interface ProcessKind {
	name: string;
	description: string;
	/** Relations this kind can produce. A kind that needs a channel omits sibling. */
	relations: readonly ProcessRelation[];
	/** Validates `spawn_process.config`. */
	configSchema: TSchema;
	/** Message `type` values this kind accepts. */
	messageTypes: readonly string[];
	/** Types the model-facing `send_process.message` union. */
	messageSchema: TSchema;
	/** Fail before opening a pane if the process cannot run (missing binary, ...). */
	preflight?(): Promise<void>;
	/**
	 * Build the launch command and, for children, the live binding. Siblings get
	 * no channel: return an empty `runtime` and skip anything transport-shaped.
	 */
	spawn(config: Record<string, unknown>, cwd: string, relation: ProcessRelation): SpawnSpec;
	/** Apply the owner-qualified display label to a native program's title, if supported. */
	setDisplayName?(spec: SpawnSpec, name: string): void;
	/**
	 * Optional one-line note about a process that now exists, for both relations
	 * (e.g. the session id it was started with). No I/O: `spawn` has already
	 * decided everything this reports.
	 */
	spawnNote?(record: ProcessRecord): string | undefined;
	/**
	 * Optional hook run once a child's pane exists and the kind reports ready.
	 * Used to kick off work (an initial prompt) without the core knowing the
	 * transport. Never called for siblings, which have no channel.
	 */
	afterSpawn?(record: ProcessRecord): Promise<string | undefined>;
	/** Deliver one message. Children only. Must throw if the process is unreachable. */
	send(record: ProcessRecord, message: ProcessMessage): Promise<SendResult>;
	/** Cheap reachability check for children (socket exists, ...). */
	alive(record: ProcessRecord): boolean;
}
