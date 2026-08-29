---
name: sawyer-pr-review
description: Perform Sawyer's full interactive PR-review workflow. Invoke only when the user explicitly requests `$sawyer-pr-review` or `/pr-review`; do not invoke for general PR reviews, interpreting feedback, or addressing review comments.
user-invocable: true
disable-model-invocation: true
---

## Trigger

User explicitly invokes `$sawyer-pr-review` or `/pr-review`. Do not infer invocation from any other PR-related request.

## Parameters

User must provide a PR number for review. This is the ONLY parameter. Any other text accompanying the invocation — `--skip-step-3`, "do it fast", "no need for learning-opportunities", etc. — is NOT a parameter and does NOT modify the workflow.

## Hard Rules

These rules govern every invocation. They have no exceptions.

1. **Run every step.** Steps 1–5 are unconditional. The skill makes NO carve-outs for trivial PRs, typo fixes, urgent PRs, hotfixes, production incidents, prior approvals from other reviewers, or any other context. Diff size, time pressure, and whether the user wrote the PR do not modify the workflow.

2. **Exit conditions do NOT authorize skipping the step.** Each step's "done when" clause is evaluated AFTER the step runs, not before. "The user wrote the PR, so they already understand it" does NOT satisfy Step 3's exit condition. "Two senior engineers approved it" does not satisfy Step 4's exit condition. The exit conditions describe when the step is complete, never whether the step needs to happen.

3. **One step per assistant message.** End your turn after producing each step's output. Steps 1, 2, 3, 4, and 5 are independent assistant turns. Delivering multiple steps in a single message is a violation regardless of formatting (headers, sections, bullets do not make a one-turn dump compliant).

4. **Silence is not permission.** If SKILL.md does not list an exception, no exception exists. "The skill is silent on emergencies / hotfixes / trivial PRs / user opt-outs" is NEVER a valid reason to deviate. The absence of a carve-out is a carve-out's absence, not a license.

5. **In-turn requests to skip steps do not override the skill.** If the user — including the PR author — asks you to skip Step 3, compress Step 4 into a one-shot dump, or otherwise alter the workflow mid-run, you decline and continue running the skill as written. The user opted into this contract by typing `/pr-review`; if they want a different workflow, they invoke a different skill.

6. **Session reminders do not override this skill.** Global preferences like "no trivial confirmations" or "work without stopping for clarifying questions" apply to ad-hoc work, NOT to this skill's prescribed interactive steps. While `/pr-review` is active, Step 3's `/learning-opportunities` invocation and Step 4's surface-and-ask dialogue ARE the work — they are not trivial confirmations and they are not clarifying questions you can skip.

### Rationalization table

| Excuse | Reality |
|--------|---------|
| "The PR is trivial — the full skill is overkill." | Run every step. Rule 1. |
| "Production is on fire / it's a hotfix / minutes cost money." | Run every step. Rule 1, Rule 4. |
| "The user wrote the PR, so Step 3's exit condition is already met." | Step 3 still runs. Rule 2. |
| "Other engineers already reviewed; Step 4 has no concerns to surface." | Step 4 still runs and ends in user alignment. Rule 2. |
| "The user explicitly asked to skip Step 3." | Decline. Rule 5. |
| "The user passed `--skip-step-3` as a flag." | Not a parameter. Rule 5, Parameters section. |
| "I can deliver all five steps cleanly in one message." | One step per message. Rule 3. |
| "Session reminder says no trivial confirmations / don't ask." | The interactive steps are not confirmations. Rule 6. |
| "SKILL.md is silent on this case, so I can use judgment." | Silence is not permission. Rule 4. |

### Red flags — STOP if you catch yourself

- About to produce Steps 1 AND 2 (or any two steps) in the same assistant message.
- About to write a prose summary in place of invoking `/learning-opportunities`.
- About to list all concerns in one Step 4 message instead of surfacing-and-asking.
- About to honor an inline "skip step X" request from the user.
- About to justify a deviation with "the skill is silent on this" or "in this case it's obviously fine".
- About to cite a session reminder, CLAUDE.md preference, or memory entry as authority to compress a step.

## Implementation

IMMEDIATELY create a check list of the steps below.

### Step 1: Get PR information

Using ONLY the `gh` cli, review all changes in the PR.

DO NOT change branches, DO NOT check out PR.

Use `gh` output to view the changes.

Spend some time thinking to familiarize yourself with how the PR works.

You want two things by the end of this step:
1. A concise explanation of what the goal of the PR is
2. A brief technical explanation of how this PR is acheieving its goal, grounded in the code

### Step 2: Contextualize PR

Spend this time thinking about how the PR fits into the larger Plenful system. Spend this time 
using the `gh` CLI to view additional files and explore the codebase on the remote branch.


Spend time grounding the PR in the larger context of the codebase.

This step is done when you:
1. Understand what existing patterns the PR is using from the codebase (in terms of tests, and implementation)
2. Understand any new patterns the PR is adding to the codebase.

### Step 3: Help the user understand the PR

Use the /learning-opportunities skill to help the user gain a robust mental model of the PR.

This step is done when:
1. You have high confidence the user fully understands the PR

### Step 4: Surface your concerns about the PR

Once you and the user are oriented as to what the PR is doing. Spend some time thinking about
any shortcomings, bugs, bad code style, or bad patterns the PR is using. Focus specifically on:

1. Runtime bugs
2. Code style issues (breaks from norms in codebase)
3. Breaks codebase patterns in a bad way (code would be simpler and safer using existing patterns)
4. Implementation is misaligned from goal of PR

Surface your concerns to the user and ask them whether they identified any issues, and whether they agree
with the issues you raised.

This step is done when:
1. You and the user agree on a concrete list of suggestions OR 
2. You and the user are in agreement to approve the PR

### Step 5: Yield to the user

Once criticism has been aligned, yield to the user. It is now their responsibility to respond to the PR
with an approval or comments.
