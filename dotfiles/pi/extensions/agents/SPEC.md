# agents: design spec

Status: implemented. Sections below are the original design; "Implementation notes" at the end records where reality differed.

Replaces the old `subagents` extension. One extension; all state is plain files (see
`store/types.ts`, the contract, and `store/store.ts`). Modules never import each other
except through `host.ts`, `store/`, and the `Supervisor` interface in `supervisor/index.ts`.

## Model

- An **agent** = a pi process + its dir `~/.pi/agents/<id>/{input.json,state.json,inbox/,log,lock,pty.sock}`
  (`PI_AGENTS_HOME` overrides the root; tests must use a temp dir).
- Root = the user's main pi (id `main.<cwd-slug>.<rand>`, parent null). Children are
  launched by a **supervisor** with env `PI_AGENT_ID=<id>` (+ `PI_AGENTS_HOME` when set).
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
1. Resolve identity: `host.launched` if set; else, only when `ctx.mode === "tui"`
   (skip print/rpc/json roots), create a root agent
   (`role "main"`, `name` = cwd basename, `interactable true`, `profile` = current model,
   `stepTimeoutMs` default). Set `host.identity`, `host.ctx`. If no identity, do nothing else.
2. `store.acquireLock`; write state `{status: idle, sessionFile}` (sessionFile from
   `ctx.sessionManager`).
3. Heartbeat timer every `HEARTBEAT_MS`: write `activity.lastSeenAt`.
4. Inbox watcher (`fs.watch` on `inbox/` plus 2 s poll fallback), delivering messages
   with id > `state.lastDelivered`, in order, updating `lastDelivered` after each.
   Delivery: `deliver: "ui"` -> `ctx.ui.notify` only (no turn). `control`:
   `interrupt` -> `ctx.abort()`; `stop` -> clean shutdown (`ctx.shutdown()`), status `stopped`.
   `deliver: "context"` -> `pi.sendUserMessage("[from <from> · <kind> · <id>]\n<body>", {deliverAs: busy ? "steer" : undefined})`.
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
7. Non-interactable (`!host.interactable`): after the first `agent_settled`, write
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
8. `session_shutdown`: stop timers/watchers; if status not terminal, set `stopped`
   (or `done` for a settled non-interactable); release lock. Idempotent.
Never throw out of an event handler; log to stderr instead.

## supervisor (launching; parent side)

`createSupervisor(host)`, `profiles.ts` (profile markdown files, with
the tier resolution `resolveTarget` that falls back to `agents.fallback` then the
parent model; add frontmatter `interactable` (default false), `timeout` (minutes,
whole-run limit, non-interactable only), `role`).
- `spawn`: check `host.canSpawn`; resolve profile -> `ProfileSnapshot`; id =
  `newId(role, name)`; `store.create({... parent: selfId, depth+1})`;
  launch.
- Launch interactable: `dtach -n <pty.sock> -r winch <pi cmd...>`, env `PI_AGENT_ID`,
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
  Do not take any action automatically.

## tools (model-facing; `typebox` schemas)

`host.canSpawn` gates: `spawn_agent`, `resume_agent`, `interrupt_agent`,
`kill_agent`, `redrive_agent`, `list_agents` (own descendants). Always:
`send_message(to, body, kind?)`, `ask_parent(question)`, `report_done(summary)`,
`set_status(note)`.
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
- Tool results are short strings. Never echo message bodies from other agents
  beyond what the model asked for. All gating via registration (do not register
  tools the agent must not have).
- There is deliberately no `extend_step_timeout`: a long step is declared up front.

## ui (human-facing)

- Widget `agents` under the editor: one line per agent in this agent's **tree**
  (self + descendants) as aligned columns `glyph name | role | status | activity`
  (`idle 4m`, `running pytest 23m`), hidden when there are none. Refresh via a 2 s timer
  from `session_start` (stop on shutdown) and on demand; glyph `?` for waiting-on-*, `!`
  for a stall/lost/overrun (`stallOf`).
- `setStatus` line for this agent's lineage: `child of <breadcrumb>` and
  `N agents (M live)` (live = has a running process); nothing for a childless root.
- `/agents` command + shortcut: **universal** picker over `store.list()` across all
  roots (default scope "everything", `tab` toggles "my subtree"), tree-indented with
  breadcrumbs, fuzzy filtering, status glyphs. Use `ctx.ui.custom` with pi-tui
  `SelectList`/`Input` if practical, else `ctx.ui.select` with a typed filter.
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
- Identity of a launched child: `PI_AGENT_ID` is read once and deleted from `process.env`
  (so a pi started from an agent's bash cannot adopt it), then kept in
  `globalThis.__piAgents.id` so it survives `/reload`.
- Identity of a root follows its pi **session**: the root id is stored in the session as an
  `agents.root` custom entry. Resuming a session (`/resume`, `--continue`, fork) reattaches to
  that session's root and therefore its agents. `/new` has no entry yet, so it keeps the
  process's previous root (agents carry forward) and records it in the new session. A root
  another live process holds is never taken. Roots are only registered in `tui` mode.
  `/reload` and `/new` keep the root's status; quit, resume and fork mark it `stopped`.
- Agent sessions live in `<agent dir>/sessions` (`--session-dir`), never in the project's
  session folder, so they do not appear in the user's `/resume` list or `pi --continue`.
- `state.runStartedAt` is set at create and on every resume; whole-run limits count from
  it, not from `input.createdAt`.
- A freshly launched agent is `starting` (not `lost`) for 30 s, both in `record.status` and in
  `stallOf` (which reads `record.status`, so a `starting` agent with no lock yet is not reported lost).
- The root session is never limited: only agents with a parent get the default bash
  timeout. Root sessions cannot be resumed.
- The objective/resume text reaches the child through a 0600 `@file` in the agent
  directory, not argv. Tool summaries record only the executable or file basename.
- A model request in flight gets a fixed 10-minute deadline (silent thinking is not a stall).
- `dtach -n` forks and returns; the supervisor waits for its exit code and removes a stale
  `pty.sock` before relaunching.
- Known gaps: duplicate stall reports after `/reload` (dedupe set is in memory); a message
  whose id sorts below the cursor but is written late can be skipped; grandchildren are not
  killed with their parent; the worker does not yet get a dedicated jj workspace.
- Status note (`state.note`, `set_status`): free text written by the model. The tool
  description forbids data values and patient/customer information, but nothing enforces it,
  and the note is shown in the `/agents` list/widget and in `list_agents` output: treat it
  like other model-written text. `ask_user` is described as for blocking decisions only; and a
  `tool_execution_start` of any tool other than `ask_user`/`ask_parent` while the agent is
  `waiting-on-*` sets it back to `working` (`resumedFromWaiting`), so a model that carries
  on after asking does not keep a "needs you" badge.
