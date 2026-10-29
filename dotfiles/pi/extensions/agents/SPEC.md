# Central native agents runtime

Implementation contract. This replaces the former per-Pi file-store supervisor; it is
not a migration/compatibility layer. Operational commands and safety restrictions are
in [README.md](README.md).

## Ownership

```
native Pi + existing /agents UI/tools
          | Unix socket requests + invalidations
          v
one daemon — SQLite metadata/mail/receipts/events — dtach -N — native Pi bridge
          ^
managed attach wrapper — inherited fd3 lease — dtach -a (native terminal only)
```

- The daemon alone writes `runtime.sqlite`. Read-only client connections issue indexed
  views. The synchronous Store interface is retained for existing pure UI/orientation
  helpers; its mutation facade queues ordered IPC writes. Model-facing tools, UI actions,
  identity startup, settlement and shutdown **await flush** before claiming success.
  Launch/recovery/mark-done are explicit daemon operations, not cross-owner queued writes.
- Pi alone writes its own session JSONL. Managed identity is the original session ID;
  `PI_AGENTS_ID` must match before registering any root. A saved but nonexistent file is
  never passed to `--session`; first-conversation recovery uses the original `--session-id`.
- A dedicated connection holds `BEGIN EXCLUSIVE` on `daemon-lock.sqlite` for the entire
  daemon lifetime (`busy_timeout=0`). Ordinary runtime commits cannot release that lock.
  Kernel file locks release on crash; there is no race-prone stale PID-file reclamation.
- Runner owner token, Pi PID/start-time and dtach master PID fence execution. Hello must
  match the reserved token. Only an exact same-PID/token reload may replace its previous
  bridge; different-PID replacement is refused. A master exit without
  proof the Pi writer stopped is blocked, not an invitation to relaunch.
- IPC, process exits, bridge/lease EOF and the central deadline callback share one serial
  command chain. Ownership is rechecked after asynchronous session reconciliation. Only
  live runners, connected subscribers and active attachment leases have in-memory objects.

## Durable state

`agents`: immutable profile/objective/lineage/cwd, mutable task state, independent residency,
execution owner. `messages`: monotonic acceptance sequence, stable unique ID, recipient,
payload, persisted receipt entry ID. `events`: compact metadata invalidations, no tokens.
SQLite uses WAL, `synchronous=FULL`, and a 5s busy timeout. The home is private (0700);
the local socket is 0600. This is a trusted same-user local protocol, not a multi-tenant API.

Task state remains starting/working/idle/waiting-on-parent/waiting-on-user/done/error/
stopped/timed-out/dormant. Residency is **parked/starting/live/parking/blocked**. Parked
idle/waiting/done records retain their task state and never become lost just for having
no process. A blocked unfinished execution appears lost; terminal task badges remain
terminal with blocked residency visible in Details.

## Launch, delivery, parking

1. Spawn commits the profile/input and initial stable-ID instruction. The daemon reserves
   ownership and runs native Pi under foreground-master `dtach -N`; children are independent
   of parent process residency. Admission defaults to eight managed background runners.
   Attached/explicit recovery may exceed that cap; no active process is evicted to enforce it.
2. Hello validates identity/token and publishes the session path/PID. Existing-file receipts
   are reconciled before ordered mailbox delivery. Normal human roots connect without a
   managed launcher; duplicate live root writers are refused, including reconnects after
   daemon restart. Roots are never automatically launched or parked.
3. Acceptance commits before returning the message ID. Only ancestors/descendants and the
   user may message, not siblings. IDs deduplicate; conflicting reuse is refused. Delivery
   is serialized per recipient in acceptance order, independent of lexical ID ordering.
4. Context delivery uses the existing `agent_message` custom-message renderer with sender,
   kind and stable ID. While busy it steers; while idle it triggers a run. UI-only results
   do not invoke a model. UI/control receipts are appended as native `agents.receipt` entries.
5. A bridge notification requests **reconciliation**, not blind ACK. The daemon reads the
   pending recipient's session for the matching custom-message/receipt IDs, fsyncs the file,
   and only then commits receipt entry IDs. Missing files, volatile Pi queues and partial
   final JSONL lines are not receipts. On startup the same reconciliation repairs the
   session/SQLite transaction gap. This is durable acceptance and at-least-once intent,
   **not exactly-once tools or arbitrary external side effects**.
6. `agent_start` makes the runner busy before work. Only `agent_settled` releases automatic
   model/tool/retry work; `agent_end` does not. Compaction explicitly pins busy state and
   checks Pi idle state after completion. Managed idle cache warming is disabled. Idle
   interrupt/stop controls do not manufacture a model run or false permanent busy state.
7. Fully settled, detached runners with no pending mail/delivery get one idle deadline
   (default 60s, configurable). At the deadline the daemon checks leases plus dtach's
   execute-bit veto and asks the bridge to park. The bridge checks actual Pi idle state,
   reconciles receipts, and requests a final park-ready decision. A busy refusal cancels
   parking rather than stranding new mail. Graceful native shutdown then exits the old writer.
8. New work/attach before park commit cancels or pins it. After commit, work and attachment
   wait for old-owner exit; leases transfer to the replacement live reservation. Only a
   proven safe exit becomes parked and permits automatic wake. Reopening saved context
   never creates a second simultaneous session writer.
9. Explicit Resume resets stopped/timed-out/waiting execution state and `runStartedAt`
   before recovery instructions. Ordinary wake preserves waiting/done state until actual
   new work changes it. A fenced possibly live or unknown writer cannot be stolen by Resume.

## Attachment contract

Only the managed wrapper is supported for auto-parked sessions. It reserves before dtach
starts, waits for an owned bridge, restores terminal modes/forces resize repaint, then runs
**native** dtach/Pi. The connected reservation socket is inherited by dtach as fd3. EOF
releases the reservation only after the actual native client and wrapper have closed it.
Only positive peer read-EOF releases the lease; a local socket close/error pins unknown
ownership instead. Lease connections are not event subscribers. Wrapper death alone,
terminal silence or socket mode 0600 do not prove detach. A suspended
client keeps its lease until it exits. No explicit release, `end()` or `shutdown()` is used
while the inherited client lives.

Raw `dtach -a/-A/-p` bypasses that serialization and is **unsupported/prohibited**. Socket
mode 0700 is only a conservative additional veto (0600 means detached on the tested dtach,
not atomic authority to park). Observing an untracked attachment pins the live runner until
exit. There are no raw commands in supported UI/manual attachment instructions.

On a blocked/lost Attach action the UI first requests explicit ownership-safe recovery;
only then does it launch the managed wrapper. A live/ambiguous old owner still refuses.
No custom chat renderer, SDK-to-TUI handoff, or extra session writer exists.

## Supervision and existing feature surface

The daemon maintains one next-deadline timer over **live records only**, covering launch
handshake, non-interactable whole-run limits, applicable tool/model stall thresholds and
parking. Declared bash deadlines and slow-thinking first-output deadlines retain their
actual later threshold rather than being forgotten after an early step-timeout check.
No parked per-agent timers, filesystem watchers, mailbox polls, heartbeat writes or PID
scans exist. Roots/bridges never supervise descendants.

The existing pure fuzzy picker/triage/tree/rendering/profile/claim helpers remain in use.
Widget invalidations ignore unrelated trees and query SQL-ranked candidate metadata/counts;
only seven rows per group plus live runners/lineage are decoded, not a parked transcript
or a whole parked subtree. Footer counts use indexed direct-child aggregates. Universal
fuzzy/tree metadata is loaded on demand when the picker is opened. The indexed page endpoint
is available for bounded clients. Streaming tokens stay local to native Pi.

Preserved: `/agents`, alt+a, filters, subtree/all, finished toggles, triage/tree, widget,
lineage footer, Attach/Message/Interrupt/Kill/Resume/Details/Mark done, `/agent-done`, all
existing model tools, profiles/model tiers/fallback, configurable depth, lineage permissions,
nonblocking questions/results, progress notes, orientation, branch claims, inherited views
and model-error reporting. Spawn depth is captured with input so daemon CLI capabilities
and Pi registration agree. Kill signals the owning process group and retains a 5s force
backstop; escaped shell groups are not promised to be collected.

`/agent-done` still prompts normal model wrap-up, does not abort or delete workspaces, and
uses the existing settled backstop. Marking a lost agent done is a daemon command that first
proves the old Pi/master are not live, then changes task state and sends the parent result;
it does not grant general cross-runner state mutation rights.

## Failure/recovery boundaries

- Unexpected exit during active work is blocked/interrupted, never automatic tool replay.
  Accepted unreceipted mail remains in SQLite, including while blocked.
- Daemon restart scans only uncertain ownership rows once; it never scans/hydrates all
  parked conversations. Managed bridge loss aborts and orderly-shuts down even attached
  managed Pi as interrupted work. Human roots remain open with a reconnect warning.
- An owner that never supplied its PID is ambiguous even if its master disappeared.
  Handshake failures remain visible and fenced pending inspection; no guessed duplicate
  writer is launched. PID reuse may conservatively refuse recovery rather than steal a session.
- Arbitrary detached shell/background jobs have no new durable-job service. Wrap-up must
  still stop/report owned jobs; parking does not make external side effects transactional.
- Transcript/event/message retention and platform-specific power-loss behavior are not
  claimed solved. A local home/database must not be deleted/replaced while processes own it.

## Verification boundaries

Local development is limited to a couple of named focused cases plus targeted typecheck;
CI owns broad suites. The new focused daemon case exercises SQLite acceptance vs actual
receipt, singleton contention and blocked-owner restart. Native acceptance additionally
requires real Pi + dtach + controlling PTY, deterministic offline provider, keyboard input,
attached veto, detached park/exit, message and attachment wake, same-session continuity and
single-writer observation. A mocked dtach is not attachment evidence. Exact revision,
commands, timings and unverified failure/UI/platform matrices belong in the implementation
handoff, not an implied blanket guarantee from these docs.
