# agents

Durable, nestable agents with the **native Pi UI**, supervised by one local daemon.
There is no replacement chat TUI. See [SPEC.md](SPEC.md) for ownership and crash boundaries.

## Lifecycle

- Human interactive roots are clients. They are never automatically parked.
- Managed runners use native interactive Pi under `dtach -N`. Profiles still control
  tool/spawn/ask-user capabilities; non-interactable profiles finish/report after their
  first settled run and cannot attach. All managed runners use the same native process path.
- Detached, fully settled idle/waiting/done runners park after `PI_AGENTS_IDLE_MS`
  (default **60000**). Parking closes the process, not its persisted conversation.
  Silent model requests, tools, retries and compaction are not settlement.
- A context message or managed attachment wakes the **same saved session**. Parked is
  residency, not task completion or loss. Attached clients prevent parking.
- Unexpected exits are fenced as `blocked`; unfinished work appears lost and requires
  explicit Resume (or the UI's explicit recovery-before-Attach). Nothing blindly replays tools.
  A possibly live/unknown old writer is never replaced, even on explicit Resume.

One daemon owns `runtime.sqlite` (metadata, ordered mail, receipts, compact events),
process launch, supervision and one nearest-deadline timer. Pi alone writes its session.
Parked records have no process, watcher, timer, PID polling or loaded transcript.
Clients use a read-only SQLite view and Unix-socket requests/subscriptions, not mailbox
polling, file heartbeats or parent-owned watchdogs.

## UI and tools

- `/agents` or **alt+a**: existing universal fuzzy picker. Tab switches all/subtree;
  ctrl+v switches triage/tree; ctrl+t includes finished agents. Needs-you/working/completed
  grouping, breadcrumbs, action menus, widget and lineage footer are retained.
- Actions: native Attach, Message, Interrupt, Kill, Resume, Details, Mark done.
  `/agent-done [id|name]` still asks the agent to wrap up and report itself done.
- Existing tools: `spawn_agent`, `resume_agent`, `interrupt_agent`, `kill_agent`,
  `redrive_agent`, `list_agents`, `send_message`, `ask_parent`, `ask_user`, `set_status`,
  `report_done`. Profiles, ancestry permissions, questions/results, branch claims,
  orientation, model errors and configured spawn depth retain their existing semantics.
- Widget updates are scoped invalidations with bounded SQL-ranked candidates/counts;
  the universal picker loads metadata on demand. Token streams never traverse the bus.

## Attach safely

Use the **Attach action**. It opens a zellij tab using the managed wrapper; outside
zellij it prints the equivalent command. No zellij is needed for manual attachment:

```sh
PI_AGENTS_HOME=/absolute/runtime/home node --experimental-strip-types \
  /absolute/path/to/agents/central/attach.ts <agent-id>
```

The wrapper reserves attachment before starting dtach and passes its connected lease
as **fd3 to the actual dtach client**. Wrapper death alone cannot release that lease.
Ctrl-\\ detaches. Closing the terminal also detaches without aborting agent work.
A suspended dtach client retains its lease until it exits, even if its socket appears detached.
Only positive peer EOF releases it; a daemon-local connection close/error conservatively pins it.

**Raw `dtach -a`, `dtach -A`, `dtach -p`, and other untracked input routes are unsupported
for auto-parked sessions. Do not use them.** The socket's execute bit provides an extra
conservative veto, not atomic ownership. An observed unknown/raw attachment pins that
runner until it exits; the daemon does not guess that a user has detached.
Never call `end()`/`shutdown()` or explicitly release the inherited lease while its
native client lives. Managed attachment is the only supported route.

## Requirements and isolation

- Node **22.23+** with `node:sqlite` and TypeScript stripping; Pi with `agent_settled`
  (local proof used installed **Pi 1.4.0**); dtach **0.9** with `-N` and inherited fd support.
- `PI_AGENTS_HOME` defaults to `~/.pi/agents`; use a **fresh temporary directory** for
  development. No migration or compatibility with the old live file-store runtime.
- `PI_AGENTS_MAX_LIVE` defaults to **8** detached background admissions. Attach/explicit
  recovery bypasses this cap; existing active or attached sessions are never killed to
  enforce it. A single central queue admits durable pending work as slots free.
- `PI_AGENTS_NODE` selects Node for daemon/attach launch; `PI_AGENTS_PI` selects the native
  Pi executable (useful for an isolated offline fixture). All clients sharing a home
  share the first daemon's environment/limits. Keep the home private (0700).
- Model tiers/fallback/maxDepth and markdown profiles retain the existing settings.
- To start explicitly: `PI_AGENTS_HOME=... node --experimental-strip-types central/daemon.ts`.
  Otherwise the first session starts it. `daemon.log` and per-agent `log` support diagnosis.
  Do not remove `daemon-lock.sqlite` while a daemon lives: its dedicated exclusive
  transaction is the singleton lock, released by the OS on exit/crash.

## Delivery and recovery limits

Acceptance commits a stable-ID message before replying. Delivery remains pending until
its native session contains the matching custom message/receipt and that file has been
fsynced. `sendMessage()` returning is **not** an acknowledgement. Startup reconciles
pending receipts from disk, in recipient acceptance order. Side effects are **not** exactly-once.

Daemon loss aborts/shuts down managed writers, including attached ones, as interrupted
work—not normal parking. Human root sessions stay open with a warning; reload to reconnect
controls. Restart fences every uncertain execution owner. Resume refuses live PIDs/masters
or missing ownership proof. A runner that never completed hello may require manual inspection
of its owned processes/log before repair; deleting metadata is not a safe recovery procedure.

Detached arbitrary shell/background jobs are not made independently durable by parking;
agent wrap-up must still stop/report jobs it started. Kill retains the prior process-group
signal/backstop behavior; it cannot promise to collect processes that deliberately escaped it.
Session transcripts and metadata have no garbage-collection/retention policy yet.

## Verification

```sh
scripts/typecheck.sh
# CI owns scripts/test.sh (full suite); do not run the full suite during local task work.
node --experimental-strip-types --test --test-name-pattern='durable receipts and singleton fencing' central/daemon.test.ts
```

The focused daemon test covers accepted-but-unpersisted mail, real persisted receipt,
singleton contention and conservative restart fencing. Native attachment/park/wake must
also be proved with actual Pi + dtach in a controlling pseudo-terminal and an offline
provider, never merely mocked dtach. Full UI matrices, failure injection/power loss and
platform variants remain CI/manual acceptance responsibilities, not implied by typechecking.

Layout: `central/` (daemon, SQLite, client, IPC, attachment), `runtime/` (Pi bridge/lifecycle),
`supervisor/` (profiles and client commands), `tools/`, `ui/`, `store/` (shared contracts/pure
helpers; the former file-store and pump/watchdog fixtures are not wired into the extension).
