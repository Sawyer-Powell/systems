# Background subagents

This extension configures **child** processes only. The main agent is configured
by pi itself — `settings.json` (`defaultModel`, `defaultThinkingLevel`,
`defaultTools`) and `<agent-dir>/APPEND_SYSTEM.md` — so nothing here applies to a
running agent, and there is no startup moment before the config lands.

A **profile** is a named argv preset for a spawned pi. Its fields mirror pi's own
launch surface 1:1 and hold nothing that surface cannot express.

## Layout

| File | Responsibility |
|---|---|
| `index.ts` | Wiring: tools, command, lifecycle, result injection |
| `profiles.ts` | Profile loading, model aliases, resolution, child argv |
| `child.ts` | Child process, JSONL RPC, full process-tree kill |
| `registry.ts` | Durable records and live handles |
| `ui.ts` | Counter line and `/subagents` rendering |

## Model aliases and depth

`~/.pi/agent/settings.json`:

```json
{
  "agents": {
    "models": {
      "fast":       { "model": "deepseek/deepseek-v4.1-flash-1017", "thinking": "off" },
      "deliberate": { "model": "deepseek/deepseek-v4.1-flash-1017", "thinking": "high" }
    },
    "maxDepth": 3
  }
}
```

`model` in a profile is the enum `fast | deliberate`. A profile may override
`thinking`. Nesting is capped at `agents.maxDepth` (default 3); the main agent is
depth 0 and always gets `spawn_subagent`.

## Profiles

`~/.pi/agent/agents/*.md`:

```markdown
---
name: scout
description: Read-only reconnaissance
model: fast                 # alias
thinking: low               # optional override
tools: read, grep, find, ls # --tools allowlist; omit to keep pi defaults
extends: base               # optional composition
---
The full system prompt for this agent.
```

Fields: `name` (required), `description`, `model`, `thinking`, `tools`, `extends`.
The body becomes `--append-system-prompt`, so pi's structured prompt is kept.

## Compilation

`toChildArgs` emits pi's CLI, nothing proprietary:

| Profile | Flag |
|---|---|
| `modelId` + `provider` | `--model`, `--provider` |
| `thinking` | `--thinking` |
| `tools` | `--tools` |
| body | `--append-system-prompt <temp file>` |
| always | `--mode rpc --no-extensions -e <this extension>` |

Only `PI_AGENT_DEPTH` travels in the environment. The child reads
`agents.maxDepth` from settings to decide whether it gets `spawn_subagent` at
all. No resolved config is serialized into the environment.

## Tools

| Tool | Purpose |
|---|---|
| `spawn_subagent` | Start a background subagent from a profile |
| `list_subagents` | Status of every tracked subagent |
| `kill_subagent` | SIGTERM → SIGKILL the process group (`id: "*"` for all) |
| `resume_subagent` | Reopen a stopped/lost child with `--session` |

## Lifecycle

- **Finish**: `agent_settled` → record `done`, result injected with
  `deliverAs: "steer"` (busy main agent is interrupted at the next turn
  boundary; idle main agent starts a run).
- **Kill**: `kill_subagent` terminates the detached process group.
- **Restart**: records restore from the parent session branch; anything still
  `running` is killed if alive and marked `lost`; `resume_subagent` reopens it.
- **Status**: one counter line above the editor
  (`N active · N invoked · N killed`), `/subagents` for the full table.
