# Central native agents: states, handoffs and archive

Operational commands and isolated profile/config boundary: [README.md](README.md).
No new chat TUI, compatibility migration or per-agent supervisor.

## Independent concerns

Workflow has exactly six states: **working, idle, waiting-on-parent, needs-you, blocked,
archived**. Completion is message content, not a self-controlled success/retirement state.
Blocked has a displayed reason; crash, timeout, provider failure and unresolved ownership
are reasons, not more workflow states. Startup/parking are residency details.

Residency: parked/starting/live/parking/blocked execution ownership. Pi alone owns its
session JSONL; daemon alone owns SQLite metadata/mail. An idle/attention/question session
may be live or parked. Archive is explicit retirement and requires safely parked ownership.

## Owners and durable bus

One daemon holds a dedicated `BEGIN EXCLUSIVE` connection on daemon-lock.sqlite for its
whole lifetime (`busy_timeout=0`); ordinary commits use a different WAL/FULL database and
cannot release that lock. Kernel locks release on crash. No stale PID-file reclaim race.
Runtime SQLite uses a5s busy timeout; local home0700/socket0600, trusted same-user protocol.

Reserved token, native Pi PID/start-time and foreground dtach master PID fence each managed
session. Hello validates ID/token before delivery; a missing saved session file uses the
original --session-id, never --session on a nonexistent file that could generate a new ID.
Only exact same-PID/token reload may replace an existing managed bridge (same PID for human
roots); stale bridges cannot write state/activity or clear the replacement on EOF.

IPC, process exits, connection/lease EOF and nearest-deadline callbacks share one serial
queue. Reconciliation rechecks owner after await. Ambiguous Pi/master ownership never
permits a second writer, even on explicit recovery. Human roots are clients, not launched
or auto-parked managed runners. An unavailable root's mail waits for that session reconnect.

Acceptance persists stable unique ID + monotonic recipient sequence before returning.
Notification/launch failure after commit becomes deferred blocked delivery, not a false
"not accepted" result. Ancestor/descendant authorization remains; siblings cannot message.
A user-targeted yield is the only special durable user recipient. Conflicting ID reuse is
refused. Notifications carry compact invalidations, never streamed tokens.

Pi `sendMessage()`/volatile queues are not receipts. At native message/turn settlement,
daemon scans only pending recipient receipts, recognizes matching agent_message/custom
receipt entries, fsyncs the session and records entry IDs. Missing/partial files do not ACK.
Startup reconciles this session/DB transaction gap. Unreceipted stable IDs remain durable
for recovery; delivery is at-least-once intent, never exactly-once external side effects.

## Yield at a safe boundary

`yield(to:parent|user,message)` replaces both report_done and ask_user. Genuine ask_parent
questions remain separate. Profiles retain capability gates; non-interactable workers
spontaneously yield to parent, but a human wrap-up request can authorize a user handoff.

1. Runtime records the entire finalized assistant batch before tool execution. Yield must
   be its **sole** tool, with the exact current call ID. Mixed/nested yields fail clearly
   before any local intent or durable acceptance. Ordinary siblings finish normally; the
   model may make a meaningful corrected sole-yield call, not a farewell after acceptance.
2. A valid sole tool is sequential and returns native `terminate:true`, with explicit
   **requested** wording. Runtime's genuinely awaited turn_end follows result persistence
   and commits its local request to the daemon. Real pre-accept interruption, reload or
   shutdown clears pending intent. A pre-boundary crash is blocked interrupted work,
   not an accepted completion.
3. Daemon transaction commits message + sender handoff metadata + new workflow state.
   Parent: kind yield, context delivery, child idle, always invokes parent model including
   interactive human roots. User: kind yield, user recipient, sender needs-you, no parent
   inference. Summary/recipient/messageID/time remain independent of process residency.
4. Sole yield is the whole finalized batch, so native terminate suppresses only its ordinary
   automatic follow-up. There is NO handoff-induced ctx.abort, stop barrier or speculative
   hasPendingMessages check. Native queued custom instructions remain on an un-aborted
   run and can continue normally; that actual next turn clears old handoff attention.
5. Native final agent_settled, not agent_end, releases automatic work for parking. Successful
   non-interactable text completion performs the same parent handoff at settled. Errors and
   true interruption retain blocked/reason, not an invented completion.

`/agent-yield`/Request yield to you persists a human wrap-up control, asks normal native
model work to stop/report owned jobs/workspaces safely, then yield to user. An observed
settled wrap-up may supply its real final summary if it omitted the tool. Dead, blocked,
archived or ambiguous sessions are refused; no fabricated lost-agent completion command.

Result branch claims remain agents.result entries on receipt of a child's parent yield;
this preserves branch history without making claims the authority for workflow/liveness.
Progress notes, orientation, inherited claims, question matching and model errors remain.

## Archive and explicit restoration

Daemon operations archive/restore are shared by user UI/commands and archive_agent/
restore_agent parent tools. Authority is user or the direct owning parent, never target
self, unrelated agents or broad foreign state writes. Generic state RPC cannot archive or
unarchive. Every requested workflow state is validated against the six-state contract.

Archive requires already detached/settled/parked and known-safe ownership. Busy, attached,
starting, blocked or unknown ownership is refused with a reason and no interruption/kill.
User detaches and lets existing idle parking complete, then archives. This intentionally
avoids another shutdown/archive state machine. Children remain independent and unaffected.

Archive retains session, profile, summary, handoff/history. It is hidden by default, not
deleted. Ordinary messages remain durably queued with explicit deferred/archived feedback.
Scheduler, normal attach and resume exclude archived targets; child completion to archived
parent is also deferred. No timer/watcher/process/transcript is allocated per archived row.

Restore is explicit, returns workflow to idle and releases eligible queued work. Human
roots still are not daemon-launched; restore + later reconnect delivers their retained
handoffs. Restore and attach is labeled explicitly, never hidden inside ordinary Attach.
Blocked-owner recovery remains separately fenced. No force-archive/reparent/cascade feature.

## Parking and native attachment

Native interactive Pi runs under supervised `dtach -N`. Fully settled detached runners with
no pending mail get an idle deadline (default60s). Actual bridge idle check, durable receipt
reconciliation and final park-ready decision precede graceful Pi shutdown. A busy refusal
cancels parking. Arriving message/attach before commit cancels/pins; after commit it waits
for proven old-owner exit, then wakes the same session. Safe parking is not active-crash replay.

Managed wrapper reserves before native dtach -a, inherits the connected lease as actual
client fd3, restores terminal modes and forces repaint. Only positive peer read-EOF releases
that reservation. Wrapper death, local daemon-side close/error, mode0600 or terminal silence
alone cannot prove detach. A suspended client retains its lease. Local close/error pins
unknown ownership. Lease-only sockets do not subscribe to invalidations, but remain in the
all-open connection registry so daemon shutdown closes them and releases singleton ownership.

Raw dtach -a/-A/-p bypasses lease serialization and is unsupported/prohibited for auto-parked
sessions. The socket execute bit is only a conservative additional veto; unknown/raw observed
attachment pins until execution exits. Never end()/shutdown() the inherited connection while
its client lives. No replacement chat renderer, RPC/TUI handoff or duplicate session writer.

## Sparse supervision and UI

One central nearest timer covers only live launch/run/stall/parking deadlines. Actual
long tool/model thresholds are scheduled, not forgotten after an early step-timeout check.
No per-Pi watchdog/heartbeat/mailbox poll or per-parked/archived object/timer/watch/PID scan.
Compaction pins busy state; managed idle cache warming is disabled. Idle interrupt controls
do not manufacture a model run. Active crash/timeout is blocked with reason and explicit
recovery; attached managed writers fail closed on daemon loss, while human roots remain open.

Default triage: NEEDS YOU, BLOCKED, WORKING, WAITING ON PARENT, IDLE; optional ARCHIVED.
Every bucket has explicit nonselectable parent headings. Parent groups use their most
urgent/oldest child rank; child order is stable. Duplicate parent names disambiguate by ID.
Names are lineage-derived `parent::child::subchild` paths in the first/most important
column; stable operation IDs are not renamed. Only duplicate qualified paths add an ID tail.
There is no arbitrary34-character name cap; secondary columns may fall off narrow rows,
while selected detail wraps the full qualified name. Search flattens rank but retains that
visible ownership, not a width-dependent suffix. Qualified `::` and leaf-name queries share
hyphen/dot/underscore normalization is identical for candidate/query, preserving per-word
fuzzy scoring. Tree, scope, archive toggle and header-skipping keyboard selection remain.
Hiding an archived tree node does not hide active descendants.

Only explicit archive retires ordinary list rows. No old error/lost age-decay into completed.
Widget SQL computes the same effective state/priority **before** limiting: seven candidates
per group plus live owners/lineage, and indexed counts. Compact names alone are rendered relative to the
focused immutable agent ID using that bounded snapshot (child, child::grandchild); records,
full picker names, breadcrumbs and search data are not changed. Needs-you/blocked/question states
never age out; the compact idle window is10min. Unrelated invalidations are ignored. Full
picker metadata is on-demand; no parked transcripts are hydrated for lists or widget.

Targeted user slash commands open the existing fuzzy picker with no argument or a prefilled
partial/ambiguous query. Exact IDs/unambiguous qualified names may take a direct path. There
is no nearest-match auto-action or implicit self target. Enter returns the shown stable ID,
re-read before action; Escape never mutates. All operations still pass existing daemon
validation. /agents accepts a prefilled query too; model tools remain stable-ID-only.

Profile prompts load from PI_AGENTS_PROFILES override or normal Pi agent-dir/agents. Source
worker/intuition/scout/system prompts use yield/archive semantics. Installed/custom prompt
files are not rewritten: isolated runs must explicitly choose this source profile directory
and a fresh Pi config. This is a documented configuration boundary, not a text-rewrite shim.

## Verification boundaries

CI owns full suites. Local proof is limited to selected grouped-view/state case + one
bounded native offline yield/archive case, plus typecheck. Real Pi/dtach/controlling PTY must
prove root-parent model invocation, user attention/no parent invocation, safe batch stop,
archive refusal/deferred work/explicit restoration, native attach and park/session continuity.
Provider outputs may be deterministic fixtures; attachment/process/session behavior may not
be mocked. Exact tested revision/commands/timing/cleanup and unresolved platform/UI/power-loss/
failure-injection matrices belong in external acceptance evidence, not blanket guarantees.
