# Panes and processes

Lets the agent start a **process in a new zellij pane or tab** and later
**message** that process, so it can hand work back to you for review. Requires
pi to run inside a zellij session.

The core is a router. It has no knowledge of any specific program: each process
**kind** is a service that owns its config schema, launch command, transport,
and message handling.

## Tools

```
spawn_process({ kind, config, cwd?, relation?, target?, direction?, floating?, name? }) -> handle
send_process({ handle, message })                                                     -> result
list_processes()                                                                      -> tracked rows
```

`kind` names a process kind registered in code. `config` is validated against
that kind's schema, and only kind code builds the command line. The model never
supplies argv, so it cannot start arbitrary processes.

### Relations

Every spawn has a relation, and it is a property of the process, not of the
call site:

- **`child`** (default): the kind opens a control channel (a unix socket) and
  the process gets a `p<n>` handle. `send_process` can drive it, and
  `list_processes` reports whether that channel is `reachable`.
- **`sibling`**: the process is launched into a pane or tab for *you* to drive.
  It gets an `s<n>` handle and is listed, but it has no control channel, so
  `send_process` refuses it. `list_processes` reports only `running`/`closed`.

A kind declares which relations it can produce (`ProcessKind.relations`) and
builds a different command line for each. Same program, different contract:

| | child | sibling |
|---|---|---|
| pi | `pi --mode rpc` behind a socket shim | `pi` — the normal interactive TUI |
| nvim | `nvim --listen <socket>` | `nvim` — no socket |

Use a child when the agent should supervise, prompt, or read back. Use a sibling
when the point is to hand a process to the human (open an editor, start a session
to take over) without the agent being able to poke at it.

### Placement

`target` picks where the process lives:

- `"pane"` (default): a pane split in the focused tab; `direction`
  (`right`/`down`) and `floating` apply.
- `"tab"`: a new tab whose first pane runs the process; `name` becomes the tab
  name, and `direction`/`floating` are rejected because they do not apply.

Either way the process is tracked identically: same handle, same records, same
`send_process`/`list_processes`. A tab placement is recorded as
`{ target: "tab", tabId, paneId }`; pane placements record the tab they landed
in too, because zellij pane ids repeat across tabs (`terminal_1` exists in every
tab).

### pi kind

```
spawn_process({ kind: "pi", target: "tab", config: { prompt: "Review src/auth.ts" } })
spawn_process({ kind: "pi", config: { model: "anthropic/claude-sonnet-4", tools: "read,bash" } })
spawn_process({ kind: "pi", config: { name: "docs-check", sessionId: "docs-check" } })
spawn_process({ kind: "pi", target: "tab", relation: "sibling", config: { prompt: "Look at the failing test" } })

send_process({ handle: "p2", message: { type: "prompt", message: "Now check the tests" } })
send_process({ handle: "p2", message: { type: "prompt", message: "Stop, try X", mode: "steer" } })
send_process({ handle: "p2", message: { type: "wait", timeoutSeconds: 300 } })
send_process({ handle: "p2", message: { type: "abort" } })
send_process({ handle: "p2", message: { type: "state" } })
send_process({ handle: "p2", message: { type: "last" } })
```

A second pi agent, in its own pane or tab, so you can watch it work and steer it.
`config` maps onto pi's own flags: `prompt` (sent once the child is up), `model`,
`name`, `tools`, `sessionId`, and `noSession`.

As a **child** it runs `pi --mode rpc`; as a **sibling** it runs the ordinary
interactive TUI (with `prompt` as the opening message) and is yours to drive —
useful for handing off a task or taking over a session. Both record their
`sessionId`; siblings report it in the spawn result too.

- `prompt` sends a user message. By default it waits up to 60s for the run to
  settle and returns the reply; `waitSeconds: 0` returns as soon as the message
  is accepted. `mode: "steer"`/`"followUp"` queues it while the child is busy.
- `wait` collects the reply of a run that is still going (`timeoutSeconds`,
  default 120).
- `abort` stops the current run and waits for idle; `state` reports model,
  thinking level, streaming, message counts, and session; `last` returns the
  last assistant text.

Sessions are real pi sessions: `sessionId` defaults to a fresh UUID, and the
spawn result reports it, so you can later `pi --session <id>` yourself. Pass
`noSession: true` for an ephemeral child.

The child runs `pi --mode rpc` behind a small pane-side shim
(`kinds/pi-shim.mjs`) that owns a unix socket and paints a live transcript
(assistant text, tool starts, prompts) on the pane, so the tab is worth looking
at. One message is one short-lived socket connection.

### nvim kind

```
spawn_process({ kind: "nvim", config: { path: "src/foo.ts", line: 40 } })
spawn_process({ kind: "nvim", config: { path: "src/foo.ts" }, floating: true })
spawn_process({ kind: "nvim", config: { path: "src/foo.ts" }, cwd: "packages/app" })

send_process({ handle: "p1", message: { type: "open", path: "src/bar.ts", line: 3 } })
send_process({ handle: "p1", message: { type: "open", path: "main.go", cwd: "cmd/app" } })

send_process({ handle: "p1", message: { type: "context" } })
send_process({ handle: "p1", message: { type: "diagnostics", severity: "error" } })
send_process({ handle: "p1", message: { type: "notes" } })
send_process({ handle: "p1", message: { type: "diffview" } })
send_process({ handle: "p1", message: { type: "diffview", rev: "abc123..def456", paths: ["src"] } })
```

`open` changes the active file (and cursor); `cwd` optionally runs `:cd` first.

`context` is read-only and returns the current state: file, cursor, mode, the
visual selection (from the active visual range or the `'<`/`'>` marks), and
diagnostics scoped to the selection or cursor line. `diagnostics` queries
nvim's diagnostic store directly: `scope` is `buffer` (default), `cursor`,
`selection`, or `workspace`; `severity` filters to one level; `path` targets an
already-open buffer. Both return full structured rows in `details` and a
truncated text summary.

`notes` finds `NOTE(agent)` comments in the loaded file buffers, or in the
`paths` you pass instead, and returns structured `{ path, line, text }` rows.
These are feedback from the user: address them, then delete the comments; never
write notes yourself.

`diffview` opens `diffview.nvim` through its Lua API. Omit `rev` for
working-tree changes; pass a revision (or `A..B`) for a range, and `paths` to
limit it. It requires `diffview.nvim`; the message reports a clear error if it
is not installed.

That gives the review loop: the agent opens nvim, you move the cursor or select
something, and the agent calls `context` to get exactly what you are looking at.

### Working directory

The process cwd is what LSP and file-relative tooling use, so it is chosen
deliberately:

1. explicit `spawn_process.cwd`
2. the kind's suggestion — for nvim, the nearest enclosing project root of the
   opened file (`.git`, `.jj`, `package.json`, `pyproject.toml`, `Cargo.toml`,
   `go.mod`, `deno.json`, `Gemfile`, ...), falling back to the file's directory;
   for pi, the pi working directory
3. the pi working directory

The chosen cwd is stored on the record and used to resolve later `open` paths.

Pi's own working directory is fixed for a session and cannot be changed by an
extension or tool (`ctx.cwd` is read-only; there is no `/cd`). Changing it means
starting or switching to a session rooted in that directory. This extension does
not change pi's cwd; it gives each spawned process its own.

## Records and safety

- A record
  `{ handle, kind, relation, target, tabId, paneId, name, cwd, config, runtime }`
  is stored in tool-result `details`, so it is reconstructed per session branch
  and survives forks. Records from before tabs existed have no `tabId` and fall
  back to matching the pane id anywhere; records from before relations have no
  `relation` and are treated as children.
- Handles are `p<n>` for children and `s<n>` for siblings, numbered
  independently.
- `send_process` only accepts a handle the core created on the current branch,
  and only a child's: a sibling has no channel to send to.
- Before dispatch, the pane is checked against `zellij action list-panes`
  (`exited == false`, scoped to the recorded tab) and the kind's own
  reachability check (socket exists).
- If you close a pane or its tab, the next message fails cleanly; the agent can
  spawn a new process.
- The extension only ever issues create-only zellij actions (`new-pane`,
  `new-tab`) plus the read-only `list-panes` and `current-tab-info`. No close,
  focus, move, resize, or send-keys.

## Adding a kind

Implement `ProcessKind` (`protocol.ts`) — `relations`, config schema, `spawn`,
`send`, and `alive` — plus the optional `spawnNote` (a one-line fact about the
process that now exists) and `afterSpawn` (work that needs a child's channel to
be open, e.g. pi's initial prompt) hooks. Add it to `KINDS` in `index.ts`. The
core and tools do not change, and placement (pane or tab) is the core's
business, so a kind never learns where it was put.

A kind that cannot run without a channel simply declares
`relations: ["child"]`; the core rejects `relation: "sibling"` before opening
anything.

## nvim transport

nvim is launched with `--listen <socket>` and driven by short-lived
`nvim --server <socket> --remote-expr` clients. One message is one request, so
there is no long-lived connection or dependency to install. If notifications
or state reads are needed later, a persistent msgpack client can replace it
behind the same `send` interface.
