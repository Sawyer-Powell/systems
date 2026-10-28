# agents: design spec

Status: implemented. Sections below are the original design; "Implementation notes" at the end records where reality differed.

Replaces the old `subagents` extension. One extension; all state is plain files (see
`store/types.ts`, the contract, and `store/store.ts`). Modules never import each other
except through `host.ts`, `store/`, and the `Supervisor` interface in `supervisor/index.ts`.

## Model

- An **agent** = a pi process + its dir `~/.pi/agents/<id>/{input.json,state.json,inbox/,log,lock,pty.sock}`
  (`PI_AGENTS_HOME` overrides the root; tests must use a temp dir).
- **Agent id = pi session id.** Root = the user's main pi (id = its session id, parent null),
  created at `session_start` for a session with no record. Children are launched by a
  **supervisor** with `--session-id <agent id>` (resume: `--session <file>`), plus env
  `PI_AGENTS_HOME` when set. There is no env/global identity.
- **Interactable** agents (worker, design, ...) run interactive pi under `dtach` so a
  zellij tab can attach/detach without killing them. **Non-interactable** agents
  (scout, SME, task monkeys) run headless `pi -p` with a whole-run timeout (default
  5 min, `DEFAULT_RUN_TIMEOUT_MS`), cannot spawn, cannot `ask_user`.
- **No automatic resume.** A dead agent shows as `lost`; resume is an explicit action.
- Single-writer: `input.json` created once by the creator (`store.create`);
  `state.json` written only by the agent itself (`runtime`), or by whoever holds the
  lock of a dead agent. A parent never writes a child's state.
- Messaging is a durable mailbox: `store.send` writes `inbox/<id>.json`. Only
  parent / ancestors / descendants / `user*` may message (enforced by `store.send`).
  No siblings.
- Liveness: 3 min default step timeout (`input.stepTimeoutMs`), no whole-task budget
  for interactable agents. Detection is `stallOf(record)` (pure, in `store/`); a long step is declared up
  front with the bash tool's `timeout` parameter (becomes `inFlight.deadline`).

## Modules

| Dir | Role |
|---|---|
| `store/` | file store: types, atomic IO, tree, mailbox, liveness, stall checks (no pi imports) |
| `runtime/` | in every agent process (see below) |
| `supervisor/`, `profiles` | profiles, launch, resume, signal, watchdog |
| `tools/` | model-facing tools |
| `ui/` | widget, lineage status, `/agents` picker, attach |
| `index.ts`, `host.ts`, `tool-names.ts` | wiring, shared handle, tool name groups |

`scripts/typecheck.sh` typechecks everything; `scripts/test.sh` runs the unit tests.

## runtime (in every agent process)

On `session_start`:
1. Resolve identity: `store.readInput(sessionId)`. A record with a parent is a child. Otherwise,
   only when `ctx.mode === "tui"` (skip print/rpc/json roots), use the existing root or create one
   (`role "main"`, id = session id, `name` = cwd basename, `interactable true`, `profile` = current
   model, `stepTimeoutMs` default, `forkedFrom` when the session header has a `parentSession` whose
   id is a known agent). Set `host.identity`, `host.ctx`. If no identity, do nothing else.
2. `store.acquireLock`; write state `{status: idle, sessionFile}` (sessionFile from
   `ctx.sessionManager`).
3. Heartbeat timer every `HEARTBEAT_MS`: write `activity.lastSeenAt`.
4. Inbox watcher (`fs.watch` on `inbox/` plus 2 s poll fallback), delivering messages
   with id > `state.lastDelivered`, in order, updating `lastDelivered` after each.
   Delivery: `deliver: "ui"` -> `ctx.ui.notify` only (no turn). `control`:
   `interrupt` -> `ctx.abort()`; `stop` -> clean shutdown (`ctx.shutdown()`), status `stopped`;
   `done` -> see "agent-done" below.
   `deliver: "context"` -> `pi.sendMessage({customType: "agent_message", content: "[from <from> · <kind> · <id>]\n<body>", display: true, details}, {triggerTurn: true, deliverAs: busy ? "steer" : undefined})`;
   a message renderer shows `[from X · kind]` and the body, collapsed when long. A `result` from a child
   also appends an `agents.result` claim entry.
   An `answer` whose `inReplyTo` equals `state.waitingOn.messageId` clears `waitingOn`.
   Must be idempotent across restarts (cursor) and safe if the same file is seen twice.
5. Activity: on `agent_start` status `working`; `agent_settled` -> `idle` (do not
   override `waiting-on-*` or terminal statuses); every lifecycle/stream event
   (`turn_start/end`, `message_update` throttled to ~1/s, `tool_execution_*`)
   writes `activity.lastEventAt`. Track `inFlight` for tools (`kind "tool"`,
   `summary` = tool name + first 80 chars of a command/path argument, never output)
   and for the model request (`kind "model"`); clear on end. Throttle writes
   (at most ~1/s) but never lose `inFlight` start/end transitions.
6. Step-timeout guard: `tool_call` for the `bash` tool: if `input.timeout` is
   absent, set it to `ceil(stepTimeoutMs/1000)` by mutating `event.input`; record
   `inFlight.deadline = startedAt + timeout*1000` (`timeout` is the bash tool's parameter, in seconds).
7. Non-interactable (`!host.identity.interactable`): after the first `agent_settled`, write
   `{status: done, summary: <last assistant text, <= 8000 chars>}`, send a `result`
   message (`deliver: "ui"`) to the parent, release lock, shut down. Also a self
   timer at `input.runTimeoutMs`: status `timed-out`, `result` message flagged timed
   out, shut down.
   **Errors must surface.** If a run ends with an assistant message whose
   `stopReason` is `"error"` (e.g. a provider 400 such as `model_not_available`), do
   not treat it as success: for a non-interactable agent set `status: error`,
   `summary: <errorMessage, <= 500 chars>`, and send the parent a `result` message that
   says it failed; for an interactable agent set `status: error` with the same
   summary (it stays attachable/resumable). Never report "done (no output)".
8. `session_shutdown`: stop timers/watchers; unless the reason is `reload`, a root becomes `dormant`
   and a child that is not terminal becomes `stopped`; release lock. Idempotent.
9. `before_agent_start` computes the orientation block (`store/orientation.ts`); the `context` event appends
   it as the last (non-persisted) custom message of each LLM call in the run. It is deliberately not in the
   system prompt: that would churn the prompt cache and give other agents' text system authority.
10. `session_before_switch` / `session_before_fork` are cancelled when this agent is a child.
Never throw out of an event handler; log to stderr instead.

## supervisor (launching; parent side)

`createSupervisor(host)`, `profiles.ts` (profile markdown files, with
the tier resolution `resolveTarget` that falls back to `agents.fallback` then the
parent model; add frontmatter `interactable` (default false), `timeout` (minutes,
whole-run limit, non-interactable only), `role`).
- `spawn`: check `host.canSpawn`; resolve profile -> `ProfileSnapshot`; id =
  `newId(role, name)`; `store.create({... parent: selfId, depth+1})`;
  launch.
- Launch interactable: `dtach -n <pty.sock> -r winch <pi cmd...>`, env
  `PI_AGENTS_HOME`, in `input.cwd`, detached, stdout/stderr to `log`. Require `dtach`
  on PATH or error with install hint. Launch non-interactable: `pi -p <objective>`
  detached to `log`. Children get `--no-extensions -e <this extension dir>`, the profile's
  `--model/--provider/--thinking/--tools/--append-system-prompt`, and the objective as the
  first message.
- `resume(id, instruction)`: refuse if `store.isAlive(id)`; reuse `input.json`; pass
  `--session <state.sessionFile>`; first message = a resume note naming the task,
  the previous end state, and `instruction`. Same launch as above.
- `signal`: `interrupt`/`stop` -> `store.send({from: selfId, to: id, kind:"control", control})`;
  `kill` -> SIGTERM the process group (`-pid` of `store.lockPid`), SIGKILL after 5 s.
- `redrive`: kill, wait until not alive, resume with the note.
- Pi invocation: re-run the pi entry point that hosts this extension (`piInvocation` in `launch.ts`).
- `watchdog`: every 15 s, for each of this agent's **descendants whose parent is this
  agent** (direct children): `stallOf(child)`; on a report not already reported
  (dedupe by `child id + kind`, reset when the child recovers) send the parent a
  `stall` message to the parent (`from: <child id>`, which `store.send` allows;
  `deliver: "context"` when the parent is a non-root agent, `"ui"` when it is a root).
  Do not take any action automatically. In a **root** with a UI, `treeNotices` additionally scans
  the deeper descendants (grandchildren and below; a direct child's stall message already reaches the root's UI)
  and shows each new stall as one `ctx.ui.notify(..., "warning")` line, "`<name> (<role>): <kind>, <detail>.
  Open /agents to interrupt.`" Same dedupe (`newStalls`, pure). UI only: no store message, no model context.

## tools (model-facing; `typebox` schemas)

`host.canSpawn` gates: `spawn_agent`, `resume_agent`, `interrupt_agent`,
`kill_agent`, `redrive_agent`, `list_agents` (own descendants). Always (any agent session):
`send_message(to, body, kind?)`. Children only: `ask_parent(question)`, `report_done(summary)`,
`set_status(note)`. `spawn_agent` appends an `agents.spawn` claim entry.
Interactable only: `ask_user(question)`.
- `ask_parent`: `store.send` question to the parent, then
  `store.writeState(self, {status:"waiting-on-parent", waitingOn:{messageId}})`.
  Non-blocking: tool result says "Question sent. End your turn now; the answer will arrive as a message."
- `ask_user`: `user` has no inbox, so write `state` `{status:"waiting-on-user", summary: <the question>}`;
  the UI badge surfaces it. Result text: "The user has been flagged. End your turn."
- `set_status`: children only. Normalises `note` (whitespace collapsed, trimmed, at most
  `NOTE_MAX_CHARS` = 60 chars: longer text is cut to 59 plus `…`; empty clears) and writes
  `state.note`. Never changes status and never sends a message. Result text: "Status set."
  The note is cleared at `agent_start`, by `report_done` and by supervisor resume, and kept
  after `agent_settled`. The UI shows it as the activity of a working agent, and after the
  duration (`4m · note`) for idle/waiting agents; `list_agents` includes it.
- `report_done`: state `{status: done, summary}`, `result` message to parent
  (`deliver: "ui"` for a root parent, else `"context"`).

## agent-done (the user tells an agent to finish)

Without it an interactable agent only reaches `done` when its model calls `report_done` (it otherwise goes
`idle` at `agent_settled`); a non-interactable one reaches `done` at its first settle. `/agent-done` is the
user's way to say "you are finished".

- **Invoke** (human only; no model tool, so a model cannot mark another agent done): `/agent-done` inside an
  agent's own pi marks that agent; `/agent-done <id|name>` in any agent's pi (typically the root) marks one of
  its **descendants** (exact id, exact name, then unique id/name prefix; ambiguity is an error); `/agent-done` in
  a root with no argument lists the open descendants. The `/agents` action menu has **Mark done** for the same
  cases (any agent shown, like Message).
- **Mechanism**: `control: "done"` (extends `ControlAction`), sent `from: "user"` so it also works to oneself.
  The pump advances the cursor first (like `stop`) and a done sent before the process started is dropped.
  The runtime (`requestDone`) sets `pendingDone` and injects an `agent_message` (`[from user · control · id]`,
  body = `wrapUpText()`) with `triggerTurn`, steered when busy: the agent finishes its current step/run, then
  stops background processes it started, reports (does not delete) jj workspaces/panes it made, runs `jj st`, lists
  child agents, and calls `report_done`, which writes its own `done` state and sends the `result` to its parent.
  Nothing is aborted; to cut a run short interrupt first.
- **Backstop** (`settleDone`, pure): when the run carrying the request settles, `reported` (status already `done`)
  does nothing; `finish` (wrap-up ended without `report_done`) makes the runtime write `done` with the last
  assistant text as summary and send the `result`; `cancelled` (run aborted), `asked` (agent went
  `waiting-on-*`) and `failed` (model error: the normal `error` path) drop the request, status unchanged.
- **Per state** (`planDone`, pure): `working`/`idle`/`waiting-on-*` (alive) and an alive `error`: send (waiting
  agents get a turn; the question is superseded). `done`: no-op. `starting`: refused (its runtime would drop the
  control). `lost`: no process to ask, so the UI writes `done` with `LOST_DONE_SUMMARY` (as `kill` writes
  `stopped` for a dead agent) and sends the parent a `result` from the child. `stopped`/`timed-out`/dead `error`/
  `dormant`/roots: refused (resume first). `done` is left again by any later message/instruction, as before.
- Not done by the mechanism: killing processes (the agent is asked to), deleting workspaces, committing or
  discarding work, or marking grandchildren done.
- Tool results are short strings. Never echo message bodies from other agents
  beyond what the model asked for. All gating via registration (do not register
  tools the agent must not have).
- There is deliberately no `extend_step_timeout`: a long step is declared up front.

## ui (human-facing)

- Widget `agents` under the editor: this agent's **subtree** (descendants, user sessions
  excluded) in triage order (see below), as aligned columns `glyph name | role | status |
  activity or age`, no headers, at most 6 lines plus `… N more (/agents)`; COMPLETED rows only
  from the last 10 minutes; hidden when there are none. Refresh via a 2 s timer from
  `session_start` (stop on shutdown) and on demand; glyph `?` for waiting-on-*, `!` for a
  stall/overrun/wedge (`stallOf`).
- `setStatus` line for this agent's lineage: `child of <breadcrumb>` and
  `N agents (M live)` (live = has a running process); nothing for a childless root.
- `/agents` command + shortcut: **universal** picker over `store.list()` across all
  roots (default scope "everything", `tab` toggles "my subtree"), fuzzy filtering, status
  glyphs. `ctrl+v` toggles two views, named in the title: **triage** (default) and **tree**
  (depth-first, breadcrumbs, `ctrl+t` un-hides finished trees). Uses `ctx.ui.custom`.
- **Triage** (`ui/model.ts` `triage`, pure; no per-user marker or other persistent state).
  Roots (`parent === null` or role `main`) are never rows. Groups, each with a non-selectable
  header (movement skips it, enter ignores it, typing a query hides it), empty groups skipped:
  1. NEEDS YOU, by wait start ascending (`state.since`; stalls `activity.lastEventAt`):
     `waiting-on-user`; `waiting-on-parent` with a root, missing or not-alive parent;
     any `stallOf` report; `error` with `state.since` < 24 h ago. A `lost` report counts only
     while the last heartbeat is < 24 h old.
  2. WORKING (`working`/`starting`, not in 1) by `runStartedAt ?? since` ascending.
  3. COMPLETED, everything else, by `state.since` descending; only the last 24 h unless
     `ctrl+t` (the widget uses 10 minutes). A record with no readable state counts as completed
     at time 0 (show-all only).
- Per-agent actions menu: attach (interactable & alive, or resume first if `lost`),
  message (prompt for text, `store.send({from:"user", ...})`), kill, resume, show
  details (input, state, breadcrumb, last log lines).
- Attach = new zellij tab running `dtach -a <pty.sock> -r winch` using the
  primitives in `../../zellij/panes.ts` (import `newTab`, `insideZellij`); tab name =
  agent id. Without zellij, show the command to run.
- Receiving `deliver: "ui"` messages is handled by `runtime`; the UI only reads state.

## Acceptance (whole feature)

- `scripts/typecheck.sh` clean; all `*.test.ts` pass.
- Smoke (manual): spawn a worker under dtach, attach/detach, kill the parent
  pi, restart, see the worker in `/agents`; stall detection fires on a sleeping tool.

## Implementation notes (differences from the design above)

- `host.canSpawn` is false until `session_start`: pi settings cannot be read while the
  extension factory runs, so spawn tools register on `session_start`.
- Identity is the pi **session id** (`ctx.sessionManager.getSessionId()`), known only at
  `session_start`, so `send_message`, the child-only tools (`ask_parent`, `ask_user`, `set_status`,
  `report_done`) and the spawn tools register on `session_start`, once per runtime (verified to be
  honoured by a child's `--tools` allowlist). `host.canSpawn` is false until then.
  The same session id is the same agent: `/resume`, `--continue` and `/reload` reattach to the same
  agent and tree; `/new`, `/fork`, `/clone` create a new root. Roots are only registered in `tui` mode.
- `dormant` (root only, not terminal, never `lost`, never reported as stalled): written at
  `session_shutdown` for every reason except `reload`; `session_start` writes `idle`. The inbox cursor
  delivers what accumulated meanwhile. The UI hides a dormant root's tree like a finished one unless a
  child is unfinished.
- `forkedFrom` (root `input.json`, optional): the parent session's id, when the store has that agent.
  Its agents are inherited, read-only: listed, in Details and in orientation, never controllable from the
  fork (`owned()` and `canMessage` still mean ancestors/descendants only).
- Claims (`agents.spawn`, `agents.result` session custom entries; `store/claims.ts`) are what this
  branch says it did. Orientation reconciles them with the store on every run (not only at
  `session_start`, so `/tree` rewinds are honoured): a spawn claim with no result and no store record is
  `unknown (store lost)`; a store child not claimed on this branch is tagged `[other branch]`.
- Mailbox messages are `agent_message` custom messages, not user messages. `display: true`; details
  carry `from`, `kind`, `id`, `inReplyTo`. `triggerTurn: true` wakes an idle agent; while busy the message
  is steered. The cursor advances when the message is handed to pi (`sendMessage` is fire-and-forget), so a
  context message is at-most-once in practice if the process dies before pi records it.
- A child cannot switch sessions (`session_before_switch`/`fork` cancelled); `/new`, `/fork`, `/clone` start a
  new root only in a root's pi.
- Orientation is a non-persisted `context` message, not a system-prompt section (cache stability; child text
  must not gain system authority).
- Agent sessions live in `<agent dir>/sessions` (`--session-dir`), never in the project's
  session folder, so they do not appear in the user's `/resume` list or `pi --continue`.
- `state.runStartedAt` is set at create and on every resume; whole-run limits count from
  it, not from `input.createdAt`.
- A freshly launched agent is `starting` (not `lost`) for 30 s, both in `record.status` and in
  `stallOf` (which reads `record.status`, so a `starting` agent with no lock yet is not reported lost).
- The root session is never limited: only agents with a parent get the default bash
  timeout. A root cannot be resumed by a tool: resume its pi session instead.
- The objective/resume text reaches the child through a 0600 `@file` in the agent
  directory, not argv. Tool summaries record only the executable or file basename.
- Model requests: `modelStart(pi.getThinkingLevel())` sets a 10-minute first-output deadline only for thinking
  `xhigh`/`max`; otherwise there is no deadline and the plain step timeout applies from the request start.
  `streamStart` clears the deadline (and always flushes) on the first real output: a `message_update` whose
  `assistantMessageEvent` is `text_start` or `toolcall_start`. An assistant `message_start` is only the response
  headers and thinking events are not output, so neither clears it. `provider_stream_event` refreshes
  `lastEventAt` (throttled). A model request with no deadline whose provider stream has been silent for
  `MODEL_SILENCE_MS` (120 s, capped by a shorter step timeout) is reported as a `stall`; a request that has produced no event at all since it started (waiting for the first token) gets `MODEL_FIRST_EVENT_MS` (10 min); tools keep the step timeout. Provider hangs: pi's `httpIdleTimeoutMs` (120000 in pi's `settings.json`) bounds
  the HTTP wait, at least to the response headers (body coverage depends on the provider SDK); stall detection is
  the second line and the only one for a hang after the stream started; recovery beyond pi's retry stays manual
  (`interrupt_agent` / the `/agents` Interrupt action).
- `dtach -n` forks and returns; the supervisor waits for its exit code and removes a stale
  `pty.sock` before relaunching.
- Known gaps: context messages are not confirmed before the cursor advances (at-most-once on a crash); a resumed
  agent receives its whole backlog, including stale `stall` messages; the runtime handlers have no unit-test harness;
  `forkedFrom` covers one hop; roots are never garbage-collected, and agents from before the identity change are orphaned; duplicate stall reports after `/reload` (dedupe set is in memory); a message
  whose id sorts below the cursor but is written late can be skipped; grandchildren are not
  killed with their parent; the worker does not yet get a dedicated jj workspace.
- Status note (`state.note`, `set_status`): free text written by the model. The tool
  description forbids data values and patient/customer information, but nothing enforces it,
  and the note is shown in the `/agents` list/widget and in `list_agents` output: treat it
  like other model-written text. `ask_user` is described as for blocking decisions only; and a
  `tool_execution_start` of any tool other than `ask_user`/`ask_parent` while the agent is
  `waiting-on-*` sets it back to `working` (`resumedFromWaiting`), so a model that carries
  on after asking does not keep a "needs you" badge.
