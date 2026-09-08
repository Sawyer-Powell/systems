# agents

Durable, nestable, attachable agents for pi. Replaces the old `subagents`
extension. Design and contracts: [SPEC.md](SPEC.md); file formats: `store/types.ts`.

## Model

- Every agent is a pi process plus a directory `~/.pi/agents/<id>/`:
  `input.json` (immutable, written once by the creator), `state.json` (written
  only by the agent), `inbox/` (one JSON file per message), `lock` (pid + start
  time), `log`, `pty.sock`.
- The user's interactive pi is a root agent, tied to its pi session: resuming a session shows its agents. Children are launched with
  `PI_AGENT_ID` set. Parent/child is `input.parent`; the tree is derived by scan.
- **Interactable** agents (profile `interactable: true`, e.g. `worker`) run
  interactive pi under `dtach`. Closing a zellij tab only detaches; the agent
  keeps running. **Non-interactable** agents (e.g. `scout`) run headless `pi -p`
  with a whole-run timeout (5 min default) and cannot spawn or `ask_user`.
- **Messaging** is a durable mailbox. Only parent, ancestors, descendants and the
  user may message; siblings may not. Delivery is at-least-once with a cursor
  (`state.lastDelivered`).
- **Status note**: `state.note`, a self-reported one-liner set by `set_status`. It is free
  text written by the model; the tool description forbids data values and patient/customer
  information, but it is shown in the `/agents` list and widget and in `list_agents`
  output, so treat it like other model-written text. Cleared at the start of a run, by
  `report_done` and on resume; kept while idle.
- **Liveness**: every step has an activity timeout (3 min default). A long step
  declares its own deadline up front (bash `timeout`). The parent's watchdog sends a
  `stall` message; interventions are explicit (`send_message` -> `interrupt_agent` ->
  `kill_agent` -> `redrive_agent`).
- **Nothing resumes automatically.** A dead agent shows as `lost`; resume is an
  explicit action.

## Use

- Tools: `spawn_agent`, `resume_agent`, `interrupt_agent`, `kill_agent`,
  `redrive_agent`, `list_agents` (agents that may spawn); `send_message`;
  `ask_parent`, `report_done`, `set_status`, `ask_user` (children). `set_status` sets a
  one-line progress note (max 60 chars) in `state.note`; it never changes status or sends
  a message. `ask_user` is only for decisions the agent cannot make.
- `/agents` (or `alt+a`): universal fuzzy search across every agent, with actions
  attach / message / interrupt / kill / resume / details. `tab` toggles "my subtree".
- Widget under the editor lists this agent's tree; the footer shows lineage.

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
