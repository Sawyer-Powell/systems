# Parent ↔ child signaling

## Diagnosis (source inspection)

Baseline: `ecc7d29d` (`jj` parent); unrelated Neovim working-copy edits left alone.
Paths below are relative to `dotfiles/pi/`; runtime/daemon citations are unchanged.

- At baseline, `agents/worker.md:16-22` already directed questions to `ask_parent`,
  progress to `set_status`, completion to parent yield. It did **not** explicitly forbid
  parent `info` progress or require parent-defined triggers. Scout had only final-report
  guidance (`agents/scout.md:10-14`); intuition primarily specified human handoffs
  (`agents/intuition.md:12-34`). No evidence that profiles explicitly demanded parent
  progress; permissive tools plus missing negative/default rules are the likely cause.
- `extensions/agents/tools/index.ts:51-80` exposes parent messaging, defaults parent kind
  to `info`, and sets **all** explicit sends to `deliver: context`. Its baseline description
  said “info otherwise,” not “only actionable/requested signals.” `ask_parent` similarly
  sends context mail and sets waiting-on-parent (`:89-103`); parent yield is completion,
  not a progress channel (`:111-131`). Kind `info` is **not** low priority.
- `extensions/agents/runtime/index.ts:119-131` gives UI mail a receipt/notification, but
  context mail calls `sendMessage(triggerTurn: true, deliverAs: idle ? undefined : steer)`.
  Thus an info wakes an idle parent, including a human root, or queues steering into a
  busy parent's conversation; it does not itself abort an in-flight tool/provider call.
  Cost: extra inference/attention, permanent transcript content and future context tokens;
  receipts prevent treating a volatile Pi queue as durable delivery. No token cost measured.
  Daemon context mail can also wake a parked managed parent (`central/daemon.ts:87-91,
  111-118, 209-212`); unavailable human roots wait for reconnect.
- Automatic failures/stalls are separate: `runtime/index.ts:87-92,396` and
  `central/daemon.ts:165,192` use `store/store.ts:416-419` to select UI for root parents,
  context for managed parents. Parent yield always uses context (`central/daemon.ts:241`).
  Do not suppress operational failures or questions/completions to fix routine progress.
- Profile system injection is `supervisor/launch.ts:66` (`--append-system-prompt`), plus
  global `APPEND_SYSTEM.md:36`. There is no separate messaging system injection in runtime.
  Runtime's `## Agents` is context data, computed **once per run** (`runtime/index.ts:222-244`),
  not a live system prompt. `store/orientation.ts:54-81` includes status/activity notes;
  `tools/index.ts:18-30` supplies state/activity/note in `list_agents`. `set_status` changes
  only metadata, never sends mail (`tools/index.ts:134-147`). Prefer these existing surfaces.

## Contract (recommended and implemented)

Parent states optional `spawn_agent.reporting: string`: notification triggers and final
handoff sections/length. Example: “Notify once if benchmark regresses >10%; otherwise
blocking questions only. Final: result, paths, commands/outcomes, risks; <=150 words.”
Named milestones are opt-in, not implied by a multi-phase objective.

Omitted/blank reporting means **quiet**: final handoff + genuinely blocking questions,
except material scope/safety surprises requiring timely attention. Default final <=200
words: result, changed/relevant paths, verification, unresolved risks/questions; link logs.
Explicit objective reporting can override the default; if using both, keep them consistent
(the explicit reporting field is the appended policy). Later parent instructions can revise it.
Profile-specific human teaching/review handoffs remain unchanged.

Child uses `ask_parent` only when the parent must resolve a blocking question/decision;
ends its turn. Uses `send_message(info)` only for listed triggers or material scope/safety
surprises, explaining the consequence/action needed. Batches related questions/signals,
one message per trigger, no unchanged repeats or periodic reports unless requested.
No routine progress, phase transitions, minor findings or artifact-readable detail via
send/ask/yield. Uses `set_status` sparingly for activity changes and task notes artifacts
for detail; parent reads snapshots/list/artifacts on demand rather than polling.
Uses one final parent yield per completed assignment, following the requested format
(scout may use its existing automatic final-text handoff). Never yields merely between phases.

Implementation: `supervisor/signaling.ts` appends the rules + reporting to the durable
objective in `supervisor/index.ts`. Daemon already delivers that objective as initial
instruction (`central/daemon.ts:298`); interrupted-task resume retains it. No new store,
IPC field or migration. Old callers remain valid; old running agents/custom profiles are
not rewritten. Canonical profiles/global instructions and tool descriptions reinforce it.
This is behavioral guidance, **not a hard message filter or rate limiter**.

## Delivery options / trade-offs

| Option | Benefit | Cost / recommendation |
|---|---|---|
| Quiet prompts + optional objective-encoded reporting | Small, compatible; parent states demand; no lost urgent mail | Model may disobey. **Ship this first.** |
| Non-waking info folded into latest child snapshot | Hard prevention of progress-triggered inference | Needs durable latest-info metadata, acknowledgement/reconnect semantics and scheduling changes. Existing UI delivery alone loses model-visible body and doesn't populate snapshots. Separate opt-in protocol work; never silently demote existing info (some is actionable). |
| Coalesce/debounce info | Fewer turns during bursts | Timers, pending-mail/receipt complexity; delays actionable signals and still wakes unnecessarily. Defer. |
| Per-child budget + warning | Bounds abuse | Counters/reset boundaries/recovery; warnings can themselves interrupt, hard caps can hide urgent scope/safety signals. Defer; measure first. |

Kinds retain delivery semantics: `instruction` directs a descendant, `answer` matches a
question ID, `info` is ordinary context mail (not status), `question` blocks the child,
`yield(parent)` completes work and wakes the parent, `yield(user)` flags human attention
without parent inference. If enforcement becomes necessary, introduce an **explicit**
non-waking progress kind with latest-note storage/snapshot exposure, rather than changing
`info` under existing callers. Safety/question/yield remain immediate durable context mail.

## Verification / limits

Focused existing tools tests + new signaling tests: 21 passed. Extension typecheck passed.
Commands from repository root:

```sh
bash dotfiles/pi/extensions/agents/scripts/test.sh tools/tools.test.ts supervisor/signaling.test.ts
bash dotfiles/pi/extensions/agents/scripts/typecheck.sh
```

No full suite (CI-owned), native PTY/API-spend trial or claim of measured behavioral
improvement. Follow-up: observe a fresh loaded session; only add delivery enforcement if
quiet prompts still leak unsolicited messages. No daemon restart/reload performed here.
