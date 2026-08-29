---
name: mont-task-tracking
description: Set up and maintain task graphs with mont in jj repositories, including choosing between tasks and broad jots, dependencies, gates, validation, and task lifecycle commands. Use when asked to initialize mont, capture a plan in .tasks, update mont work, or distill jots; do not use for generic planning when mont is not in scope.
---

# Mont Task Tracking

Use `mont` as the interface to `.tasks`. If `.tasks` does not exist, initialize
it first with `mont init`. Otherwise inspect the existing graph before changing
it:

```sh
mont check
mont list
mont ready
```

Read `.tasks/config.yml` and relevant task files when their details matter.
`mont ready` includes jots as well as executable tasks; distinguish tasks ready
to implement from jots ready to distill when reporting or selecting work.

## Choose the right record

- **Task:** one executable outcome with bounded scope and a concrete definition
  of done. Keep tasks atomic enough to implement and verify independently.
- **Jot:** a broad goal, problem area, or uncertainty that is not ready to
  implement. A jot should usually be distilled into one or more tasks.
- **Gate:** a reusable quality or human checkpoint that must be unlocked before
  a task can be completed.

Do not split one already-understood task into several narrow jots. Generally,
the flow is one broad jot to one-or-more concrete tasks, not many jots collapsed
into one task. If the work already has clear scope and verification, create a
task directly.

If completion requires an unselected provider, unavailable credential, or
mandatory external check that cannot currently run, keep that portion as a jot
or split it from an independently completable offline task.

Encode only real ordering constraints in `after`; independent tasks should stay
independent even when a source plan lists them sequentially.

## Make tasks independently startable

Write each task as a self-contained handoff. Assume a new agent has the
repository and `mont show <id>`, but none of the conversation that created the
task. Include the context needed to begin safely and quickly:

- the intended outcome and why it matters;
- bounded scope, non-goals, and relevant architectural decisions or invariants;
- useful starting files, symbols, or canonical documents;
- real dependencies and constraints;
- a concrete definition of done and required verification.

Reference stable source documents rather than copying large sections that can
drift. Do not rely on chat history or unstated decisions. If the essential
context or verification cannot yet be stated, keep the work as a jot and
distill it later.

Self-contained does not mean inventing missing design. Record established
decisions and leave unresolved choices explicit. In a greenfield repository,
give one task ownership of choosing the shared stack and layout, or capture that
decision in a stable document, before exposing parallel implementation tasks
that could otherwise make incompatible choices.

## Create and update records

Prefer `mont task --stdin` for creating one or several records. It avoids shell
escaping problems and accepts the normal multi-document task format. Use
`mont task <id> --patch '<yaml>'` for focused frontmatter changes and
`mont task <id> --append '<text>'` for description additions.

For a batch, run `mont task --stdin`, send records in this form, then send EOF:

```markdown
---
id: first-task
title: First task
---

Task context and definition of done.

---
id: second-task
title: Second task
after: [first-task]
---

Task context and definition of done.
```

Create gate records before adding them to `default_gates` or task frontmatter;
`mont` validates references while loading the graph. Apply specialized gates
only to tasks that need them. Default gates belong in `.tasks/config.yml`.
Do not create a gate that merely restates a task's definition of done; a gate
must add an independently meaningful reusable quality or human checkpoint.

Use jots for the unresolved horizon, then run `mont distill <id>` when the jot
is ready to become concrete work.

## Verify every mutation

After creating or editing records, run:

```sh
mont check
mont list
mont show <changed-id>
mont ready
```

Confirm that titles, dependencies, gates, task-versus-jot types, and ready work
match the intended graph. For each changed task, ask whether a fresh agent could
start from `mont show <id>` without the originating conversation. Do not rely
only on successful file creation.

`mont check` validates structure, not semantic consistency. When independent
tasks converge on a downstream consumer, compare their definitions of done for
shared terminology, coverage, state semantics, and interface assumptions.
Assign each shared contract an owner and encode any resulting dependency.

## Work lifecycle and jj

Use `mont start <id>` before implementation, unlock gates only with the evidence
their instructions require, and use `mont done -m '<summary>'` only when the
definition of done is satisfied.

With jj integration enabled, `mont` records task mutations as jj changes and
leaves a fresh working copy. After a sequence of mont operations, inspect
`jj status` and `jj log`; restore or set the new working-copy description when
needed. Preserve unrelated changes and do not rewrite task history merely to
make it tidier.
