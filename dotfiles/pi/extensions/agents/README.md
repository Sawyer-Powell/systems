# agents

Durable, nestable, attachable agents for pi. Replaces the old `subagents`
extension. Design and contracts: [SPEC.md](SPEC.md); file formats: `store/types.ts`.

## Model

- Every agent is a pi process plus a directory `~/.pi/agents/<id>/`:
  `input.json` (immutable, written once by the creator), `state.json` (written
  only by the agent), `inbox/` (one JSON file per message), `lock` (pid + start
  time), `log`, `pty.sock`.
- **The agent id is the pi session id.** The user's interactive pi is a root agent, created
  at `session_start` for a session with no record. Children are launched with
  `--session-id <agent id>`. So `/resume`, `--continue` and `/reload` reattach to the same
  agent and tree; `/new`, `/fork` and `/clone` start a new root. A root whose session is not
  loaded in any pi is `dormant` (not stopped, not lost): its mailbox keeps accumulating and is
  delivered when the session is resumed. A fork records `forkedFrom`; the agents of the
  session it came from are listed (and shown in orientation) as inherited, read-only.
  Parent/child is `input.parent`; the tree is derived by scan.
- **Session = what this conversation did and knows; file store = what is true now.** Session
  entries follow pi's branch semantics (copied by fork/clone, rewound by `/tree`): the
  `agents.spawn` / `agents.result` claims log which children this branch started and what they
  reported. Claims never decide liveness; the store does.
- **Interactable** agents (profile `interactable: true`, e.g. `worker`) run
  interactive pi under `dtach`. Closing a zellij tab only detaches; the agent
  keeps running. **Non-interactable** agents (e.g. `scout`) run headless `pi -p`
  with a whole-run timeout (5 min default) and cannot spawn or `ask_user`.
- **Messaging** is a durable mailbox. Only parent, ancestors, descendants and the
  user may message; siblings may not. Delivery is at-least-once with a cursor
  (`state.lastDelivered`; the cursor advances once a message is handed to pi, so a crash in that window can drop a context message: at-most-once in practice). A `context` message enters the session as an `agent_message`
  custom message (transcript shows `[from X · kind]`, not a fake user turn), reaches the
  model and wakes an idle agent.
- **Orientation**: before each run an `## Agents` block (a 2-line header, at most 12 lines, then
  `...N more`) is computed and shown to the model as the last message of each LLM call in that run.
  It is not persisted and not in the system prompt, so the cached prompt prefix is stable and text
  written by other agents is never given system authority (the header labels it data, not
  instructions). Content: children needing attention first (waiting on you, stalled, lost), live
  children, children finished in the last 10 minutes, claims whose record is gone, inherited
  agents. Nothing is added when there is nothing to say. PHI note: only ids, roles, statuses,
  notes, 80-char objectives, 60-char summaries and the text of a question a child is
  waiting on (160 chars, also already delivered as a message) appear; never tool output, logs
  or full summaries.
- **A child's session is its identity**: `/new`, `/resume`, `/fork` and `/clone` are refused inside an
  agent's own pi (they would orphan it); only roots can switch sessions.
- **Status note**: `state.note`, a self-reported one-liner set by `set_status`. It is free
  text written by the model; the tool description forbids data values and patient/customer
  information, but it is shown in the `/agents` list and widget and in `list_agents`
  output, so treat it like other model-written text. Cleared at the start of a run, by
  `report_done` and on resume; kept while idle.
- **Liveness**: every step has an activity timeout (3 min default). A long step
  declares its own deadline up front (bash `timeout`). The parent's watchdog sends a
  `stall` message; interventions are explicit (`send_message` -> `interrupt_agent` ->
  `kill_agent` -> `redrive_agent`). Model requests have no special deadline (so a request with no event for the step
  timeout is a stall), except at thinking `xhigh`/`max`, which get a 10 minute first-output deadline
  (thinking can be silent); it is cleared on the first real output (a text or tool-call start, not
  the response headers or thinking), after which a stream silent for the step timeout counts as a hang.
  A stall deeper than a root's direct children is also shown to the user as a warning notification
  (UI only, never in a model's context). Provider hangs: pi's own `httpIdleTimeoutMs` (120000 in pi's
  `settings.json`) bounds how long pi waits on the HTTP request (at least until the response headers;
  whether it also covers a stalled body depends on the provider SDK), then this stall detection,
  then manual recovery (`interrupt_agent` or the `/agents` Interrupt action). Do not rely on the
  first line alone for a hang after the stream has started.
- **Nothing resumes automatically.** A dead agent shows as `lost`; resume is an
  explicit action.

## Use

- Tools: `spawn_agent`, `resume_agent`, `interrupt_agent`, `kill_agent`,
  `redrive_agent`, `list_agents` (agents that may spawn); `send_message`;
  `ask_parent`, `report_done`, `set_status`, `ask_user` (children). Child and spawn tools are
  registered on `session_start`, once identity is known. `set_status` sets a
  one-line progress note (max 60 chars) in `state.note`; it never changes status or sends
  a message. `ask_user` is only for decisions the agent cannot make.
- `/agent-done [id|name]`: tell an agent to wrap up and mark itself done. Alone, inside an agent's own pi, it
  marks that agent; with an argument, in a root or any parent, it marks that descendant (also **Mark done** in the
  `/agents` action menu). A live agent finishes its current run, stops what it started, reports (never deletes)
  jj workspaces/panes, runs `jj st`, and calls `report_done` itself. A lost agent is marked done as is; stopped,
  timed-out and dead agents must be resumed first. See SPEC.md "agent-done".
- `/agents` (or `alt+a`): universal fuzzy search across every agent, with actions
  attach / message / interrupt / kill / resume / details. `tab` toggles "my subtree",
  `ctrl+v` switches between the **triage** view (default) and the depth-first **tree**,
  `ctrl+t` shows finished agents (triage: all of COMPLETED, not just the last 24 h).
  Typing filters; headers disappear and matches are one flat ranked list.
- **Triage view**: a flat list in three groups, each under a non-selectable header; user
  sessions (`main` role / no parent) are never rows. No read/unread state is kept.
  1. `NEEDS YOU`, longest waiting first: `waiting-on-user`; `waiting-on-parent` whose parent is
     a user session, gone or not running; any stall, overrun, wedge or loss reported by
     `stallOf`; an `error` that finished less than 24 h ago. Errors and lost agents older than
     24 h fall into COMPLETED so nothing sticks forever.
  2. `WORKING` (working or starting, not stalled), longest running first.
  3. `COMPLETED`, most recent first: everything else (done, stopped, timed out, idle, dormant,
     decayed error/lost; a done agent that is still attachable is here too). Only the last
     24 h unless `ctrl+t`.
  The parent's name is a dim trailing column when the width allows; the breadcrumb is under the list.
- Widget under the editor lists this agent's subtree in the same order (NEEDS YOU, WORKING,
  COMPLETED from the last 10 minutes), no headers, at most 6 lines plus `… N more (/agents)`;
  the footer shows lineage.

## Requirements

- `dtach` on PATH (`home.packages` in `home/sawyer/default.nix`).
- Model tiers in `settings.json` under `agents.models.{fast,deliberate}`, optional
  `agents.fallback: [{provider, model}]`, `agents.maxDepth`.

## Develop

```
scripts/typecheck.sh     # typecheck against the installed pi
scripts/test.sh          # unit tests (node:test, *.test.ts): store, runtime, supervisor, tools, ui
```

Tests never touch `~/.pi/agents`; set `PI_AGENTS_HOME` to a temp dir for manual
runs. Pi auto-loads every directory in `extensions/`, so develop risky changes behind an
env gate rather than in a half-working tree: a live pi reloads this code.

Layout: `store/` (files, tree, messaging, stall checks; no pi imports), `runtime/`
(in every agent: lock, state, heartbeat, inbox delivery, control, step guard),
`supervisor/` (profiles, launch, resume, signal, watchdog), `tools/`, `ui/`.
