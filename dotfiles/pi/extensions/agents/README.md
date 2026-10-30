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

## Parent ↔ child signaling

Default is **quiet**: final handoff + genuinely blocking questions, except material
scope/safety surprises. `spawn_agent` accepts optional `reporting` text: requested
notification triggers and final-handoff sections/length. Example: “Notify once on >10%
benchmark regression; final <=150 words: result, paths, verification, risks.” Omitted/blank
uses <=200 words with those sections; explicit objective reporting may override the default.
The supervisor appends this contract to the durable objective/initial instruction, so it
survives parking/resume without a new daemon protocol. Keep objective/field policies consistent.

Children must not send routine progress, phase changes or minor findings via send/ask/yield.
Batch requested signals/questions; prefer `set_status` for meaningful activity changes and
task artifacts for detailed notes. Parents read `## Agents` (refreshed per run), `list_agents`
or artifacts on demand. `info` still wakes an idle model or steers a busy one; this is
prompt-level guidance, not delivery suppression. Questions and final parent handoffs remain
waking; profile-specific human handoffs are unchanged. Existing callers remain compatible;
existing running sessions are not rewritten. [SIGNALING.md](SIGNALING.md) has the source
trace, full contract, enforcement alternatives and verification limits.

## Existing UI, clearer ownership

`/agents` / **alt+a** retains fuzzy search, scope, depth-first tree, native attachment,
message, interrupt, kill, explicit recovery, details, widget and lineage footer.
Default triage: NEEDS YOU → BLOCKED → WORKING → WAITING ON PARENT → IDLE.
Each bucket has explicit **Parent: name** headings; parent groups are ranked by their
oldest/most urgent child, rows predictably ordered. Duplicate parent names include ID tails.
All agent display surfaces use **parent::child::subchild** lineage paths: picker,
Attach tabs, native session names, tool results, snapshots, message headers, footers and
notifications. `names.ts` owns derivation, with name/ID fallbacks for missing lineage.
Immutable IDs remain machine addresses (`send_message.to`, `resume_agent.id`, leases,
session IDs); model-facing output includes `id:` explicitly. No tool guesses a path target.
Zellij labels are capped at 96 characters (keeping the leaf end), passed as literal argv,
not shell text. Process labels use `owner::kind suggestion` (including explicit title
leaves); processes are not managed agents and retain their handles. Old transcript claims
without a captured label fall back to their stored name/ID. Names are prominent first-column
paths, derived from immutable lineage without changing IDs. Duplicate qualified names get only the ID tail needed to
separate them. Names take width priority over secondary columns (no34-character cap);
selected detail wraps the complete name on narrow terminals. Headers are never selectable.
Search flattens matches but keeps full qualified ownership visible. Leaf names, qualified
`::` paths, hyphenated names and full dotted IDs all use the same normalized matcher.
`/agent-yield`, `/agent-archive` and `/agent-restore` open target selection when no target is
provided, never silently target self. Partial/ambiguous arguments prefill the fuzzy picker;
Escape cancels, Enter uses the highlighted stable ID. Exact IDs or unambiguous full qualified
names may act directly; daemon authority/eligibility still applies. `/agents [query]` also
prefills search. Model tools still require stable IDs, not fuzzy target guesses.

Tab toggles all/subtree, ctrl+v triage/tree, ctrl+t **include archived**. Only explicit
archive hides ordinary list records; old blocked/attention records do not silently decay.

The compact widget **above the editor** uses names relative to the focused agent: direct
child `child`, deeper `child::grandchild`; focused inside child, its direct child is simply
`grandchild`. Other branch ancestry remains and duplicate relative names get IDs only when
needed. Full `/agents`/command names and search identities are unchanged.
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
- `PI_AGENTS_HOME`: private runtime home, default `~/.pi/agents-v2`, separate from legacy
  `~/.pi/agents`. Explicit overrides retain their existing behavior. Use fresh temporary
  homes for trials; no copying, migration or deletion of old live state.
- `PI_AGENTS_IDLE_MS`: default60000; `PI_AGENTS_MAX_LIVE`: default8 managed background
  admissions. Attach/recovery may exceed the cap; active/attached work is not killed to
  enforce it. `PI_AGENTS_NODE`/`PI_AGENTS_PI` choose native executables.
- `PI_AGENTS_PROFILES`: explicit markdown profile directory override. Otherwise profiles
  load from Pi's agent-dir/agents, as before. The source worker/intuition/scout prompts and
  source APPEND_SYSTEM.md use the new tools. Canonical source integration updates the existing
  Home Manager source symlinks; copied/custom profiles and prompts are not rewritten.
  For isolated use set this override
  to this checkout's `dotfiles/pi/agents` and use a fresh `PI_CODING_AGENT_DIR`; do not reuse
  installed old report_done/ask_user prompts. Review custom prompts before later deployment.
- Child tool surface: `--no-extensions` drops Pi's built-in extensions, so every child names
  `-e builtin:mcp -e builtin:codemode` explicitly. Neither grants a tool by itself: a profile's
  `tools:` is still the whole `--tools` allowlist (plus the extension's own names). Pi declares a
  `direct`-exposure MCP tool only when the allowlist names or matches it, and naming any `mcp__`
  entry makes Pi filter MCP tools to the matches, so a profile reaches an MCP server by listing
  `codemode` and/or an `mcp__<server>__*` pattern, and `codemode`/`deferred`-exposure servers not
  named that way stay parent-only. The source profiles grant `codemode` and `mcp__exa__*` (web
  search/fetch, read-only). Spawning tools are never added implicitly; they come from
  `agentToolNames`, so an interactable child only gets them while it is under `maxDepth` and a
  non-interactable child gets none.
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

## Official source cutover

Home Manager already links `~/.pi/agent/{settings.json,APPEND_SYSTEM.md,agents,extensions,...}`
with `mkOutOfStoreSymlink` into `~/repos/systems/dotfiles/pi`. Canonical source changes are
available immediately through those links; a new normal Pi loads them without a rebuild or
`PI_AGENTS_PROFILES` override. Use a fresh normal session with trial overrides unset. Old
agents/inboxes remain in their old home and are not automatically imported or displayed.
Keep separate trial panes/homes isolated until the user closes them.

**Old human roots must reload or start fresh before spawning more agents through changed
canonical sources. Do not reload legacy managed workers.** Startup checks only that session's
legacy `input.json`/`lock` in the old default and selected home, before daemon/root creation.
Legacy managed workers without the new identity/token are refused; a different live or unknown
legacy lock owner is refused without changing its lock. Same-PID human root reload or no live
old owner is allowed. This is a conservative one-time cutover check, not migration or an atomic
cross-runtime lock handoff; prefer a fresh session rather than concurrently resuming old ones.
It shuts down only the rejected new invocation, never other legacy processes.

Current Node22.23.1 already meets runtime requirements: source cutover can be tried before
Nix activation using that existing Node. `home/sawyer/default.nix` declares Node24 LTS and
pins `PI_AGENTS_NODE` in session variables and managed bash/zsh initialization. A Nix switch
is needed only to realize that package/pin, not to activate source files. On the audited
work-macbook, existing `switch` alias expands to:

```sh
sudo darwin-rebuild switch --flake /Users/sawyerpowell/repos/systems#work-macbook
```

No flake update is needed. After a user-run switch, open a fresh shell to pick up the pin;
do not export an unrealized future Nix path beforehand. Do not stop/reload existing agents
as part of activation. No source integration, Nix switch or trial reload is implied by tests.

## Verification

CI owns the full test suite. Local task work uses only a couple named focused cases plus
`scripts/typecheck.sh`; native acceptance requires real Pi+dtach+controlling PTY with an
explicit deterministic offline provider, not fake attachment or API spend. Full terminal/
UI matrices, failure injection and power-loss portability remain separately attributable.

Layout: central/ (daemon/SQLite/IPC/attach), runtime/ (native Pi lifecycle bridge), tools/,
ui/ (reused picker/renderers), supervisor/ (profiles/client commands), store/ (contracts/pure
helpers; former file-store/pump/watchdog fixtures are not wired as runtime supervision).
