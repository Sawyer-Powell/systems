# agents

Durable, nestable agents with **native Pi**, one local daemon and idle parking.
No replacement chat TUI. Ownership/crash contract: [SPEC.md](SPEC.md).

## Six workflow states

| State | Meaning |
|---|---|
| working | Executing a run |
| idle | Available; nobody needs to respond |
| waiting-on-parent | Asked the parent a genuine question |
| needs-you | Human should review, decide or converse |
| blocked | Cannot safely continue; inspect the displayed reason |
| archived | Explicitly retired by user/owning parent; conversation retained |

Residency (parked/starting/live/parking/blocked ownership) is independent. A missing parked
process is not failure. Startup, provider failure, crash and timeout are execution details
or blocked reasons, not extra workflow states. There is no model-controlled done state.

## Handoffs and retirement

- One tool: `yield(to: "parent" | "user", message: string)`. Call it alone as the final tool.
  The tool requests a handoff; runtime durably accepts it **after the current tool batch
  finishes**, not while parallel work remains. A crash before that boundary is interrupted
  work, not an accepted completion. Yield must be the **only tool in the finalized assistant
  batch**. Mixed/nested calls are refused before intent/acceptance: finish the other tools,
  then retry yield alone. Siblings finish normally. A valid sole call uses native `terminate`
  without aborting the run; queued explicit instructions may continue on an un-aborted turn.
- Parent yield is a special **work-completed message**, always context/model delivery,
  **including interactive human roots**. Child becomes **idle**, not waiting/done/archived.
  An unavailable human root is not daemon-launched; its durable handoff waits for reconnect.
- User yield becomes **needs-you** and a durable user-addressed handoff, without waking the
  parent's model. It can request review or conversation, not just ask a blocking question.
- `ask_parent` remains a genuine question, distinct from completion. Non-interactable
  completion uses the same parent yield. Such profiles may yield to the user only when
  explicitly requested by that human.
- `/agent-yield [id|name]` / **Request yield to you** asks an owned session to wrap up safely,
  then hand work to the human. It never fabricates a result for a dead/unknown worker.
  No `/agent-done`, Mark done, `report_done` or `ask_user` aliases.
- `/agent-archive <id|name>` / **Archive**, and parent `archive_agent`, retire explicitly.
  Simplest safe policy: archive requires an already detached, settled, safely **parked**
  session. Busy, attached, starting, blocked or ambiguous ownership is refused with a reason;
  nothing is silently interrupted. Detach and let ordinary idle parking finish first.
- Archived agents are hidden by default. Messages are accepted durably but **deferred**;
  neither ordinary messages, Resume nor Attach silently restores them. **Restore**,
  `/agent-restore`, parent `restore_agent`, or labeled **Restore and attach** explicitly
  makes the agent available and releases queued work. Children are never archived/killed
  as a side effect. A child may complete to an archived parent; that handoff waits too.

Archive is not self-declared success. Completion is handoff content; retirement is an
owner/user decision; resource residency is a third independent concern.

## Existing UI, clearer ownership

`/agents` / **alt+a** retains fuzzy search, scope, depth-first tree, native attachment,
message, interrupt, kill, explicit recovery, details, widget and lineage footer.
Default triage: NEEDS YOU → BLOCKED → WORKING → WAITING ON PARENT → IDLE.
Each bucket has explicit **Parent: name** headings; parent groups are ranked by their
oldest/most urgent child, rows predictably ordered. Duplicate parent names include ID tails.
Names are prominent first-column **parent::child::subchild** paths, derived from immutable
lineage without changing IDs. Duplicate qualified names get only the ID tail needed to
separate them. Names take width priority over secondary columns (no34-character cap);
selected detail wraps the complete name on narrow terminals. Headers are never selectable.
Search flattens matches but keeps full qualified ownership visible. Leaf names, qualified
`::` paths, hyphenated names and full dotted IDs all use the same normalized matcher.
Tab toggles all/subtree, ctrl+v triage/tree, ctrl+t **include archived**. Only explicit
archive hides ordinary list records; old blocked/attention records do not silently decay.

Widget reads SQL-ranked bounded candidates/counts, not all parked metadata on every event.
Needs-you/blocked/parent-question priorities never age away; compact idle rows use a ten-minute
window. Universal picker metadata loads on demand. No periodic Pi store scans or UI polling.

## Native attach and parking

Human roots are clients, never automatically parked/launched. Managed sessions use native
interactive Pi under `dtach -N`; profiles still gate capabilities. Detached **fully settled**
sessions park after `PI_AGENTS_IDLE_MS` (default60000), exiting the process but preserving
its session. Model/tools/retries/compaction are not idle. Messages or managed Attach reopen
that same saved session, with one fenced Pi writer. Unexpected exits become blocked with
explicit recovery, never blind tool replay. Archived work is excluded from wake scheduling.

Use **Attach** in `/agents`, or its printed managed command outside zellij:

```sh
PI_AGENTS_HOME=/absolute/runtime/home node --experimental-strip-types \
  /absolute/path/to/agents/central/attach.ts <agent-id>
```

The wrapper reserves before dtach, passes its connected lease as **fd3 to the actual client**,
restores terminal modes and nudges resize. Ctrl-\\ detaches. A suspended native client retains
its lease. Only positive peer EOF releases it; local close/error pins unknown ownership.
Wrapper death alone is not detach. All open sockets remain tracked for daemon shutdown.

**Raw dtach -a/-A/-p or other untracked input routes are unsupported for auto-parked agents.**
The socket execute bit is only an extra conservative veto, not atomic attach authorization.
Do not end()/shutdown() the inherited lease while its client lives.

## Isolation and requirements

- Node22.23+ (`node:sqlite`, TypeScript stripping), Pi with `agent_settled` and tool `terminate`
  (local host Pi1.4.0), dtach0.9 `-N` and inherited descriptor behavior.
- `PI_AGENTS_HOME`: private runtime home, default~/.pi/agents. **Use a new temporary home**
  for this revised six-state runtime. No migration/compatibility with old live state.
- `PI_AGENTS_IDLE_MS`: default60000; `PI_AGENTS_MAX_LIVE`: default8 managed background
  admissions. Attach/recovery may exceed the cap; active/attached work is not killed to
  enforce it. `PI_AGENTS_NODE`/`PI_AGENTS_PI` choose native executables.
- `PI_AGENTS_PROFILES`: explicit markdown profile directory override. Otherwise profiles
  load from Pi's agent-dir/agents, as before. The source worker/intuition/scout prompts and
  source APPEND_SYSTEM.md use the new tools. **Existing installed/custom profiles and system
  prompts are not rewritten or edited automatically.** For isolated use set this override
  to this checkout's `dotfiles/pi/agents` and use a fresh `PI_CODING_AGENT_DIR`; do not reuse
  installed old report_done/ask_user prompts. Review custom prompts before later deployment.
- Model tiers/fallback/maxDepth, lineage authorization, claims and orientation remain.
- Start explicitly with `PI_AGENTS_HOME=... node --experimental-strip-types central/daemon.ts`,
  or let the first session start it. Inspect daemon.log/per-agent log. No source deployment
  or existing trial reload is implied by using this checkout.

SQLite WAL/FULL commits stable-ID mail before acceptance replies. Pi alone writes its JSONL;
only matching persisted session entries followed by fsync become receipts. User handoffs
remain durable attention records, not fabricated Pi receipts. Session queues are not ACKs.
Unreceipted IDs remain durable for reconciliation/recovery (not exactly-once tools).
Daemon loss fences/interrupts managed writers, including attached ones; human roots remain
open with a warning. The separate daemon-lock.sqlite exclusive transaction is the singleton
lock and is kernel-released on crash. Never remove a live lock/store to force recovery.

Arbitrary background jobs/escaped shell groups are not made durable by parking; safe wrap-up
still reports/stops owned jobs. No transcript/message/event retention policy is implemented.

## Verification

CI owns the full test suite. Local task work uses only a couple named focused cases plus
`scripts/typecheck.sh`; native acceptance requires real Pi+dtach+controlling PTY with an
explicit deterministic offline provider, not fake attachment or API spend. Full terminal/
UI matrices, failure injection and power-loss portability remain separately attributable.

Layout: central/ (daemon/SQLite/IPC/attach), runtime/ (native Pi lifecycle bridge), tools/,
ui/ (reused picker/renderers), supervisor/ (profiles/client commands), store/ (contracts/pure
helpers; former file-store/pump/watchdog fixtures are not wired as runtime supervision).
