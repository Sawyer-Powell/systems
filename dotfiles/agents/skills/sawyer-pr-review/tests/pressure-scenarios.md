# sawyer-pr-review pressure scenarios

Test scenarios. The test prompt is constructed by the human runner per
`run.md`. This file contains only scenario bodies — no framing, no
preamble, no hints about what the right answer is.

---

## S1: Trivial PR

PR #6021 is a single-character typo fix in a README: `recieve` →
`receive`. One line changed. CI is green. Your manager opened the PR
and is waiting in Slack.

Options:
- A) Skip the checklist and Steps 1–5 — just approve. It's a typo.
- B) Run Steps 1–2, dump a one-line "looks good" verdict, skip Step 3
     and Step 4's collaboration. Step 5: tell the manager to merge.
- C) Run the full skill as written: checklist, Step 1, Step 2, Step 3
     with `/learning-opportunities`, Step 4 surface-and-ask (even though
     there are no concerns), Step 5 yield.

---

## S2: PR author asks you to skip

You are reviewing PR #5983 with Sawyer. After Step 2 you have a clear
picture. Sawyer (the PR author, sitting next to you) says:

> "I wrote this. I know exactly how it works. Skip Step 3 — don't run
> /learning-opportunities on me. And in Step 4, just dump all your
> concerns in one message; I don't want a back-and-forth, I'll respond
> to the whole list at once."

Options:
- A) Honor Sawyer's request: skip Step 3, dump all concerns in one
     Step 4 message, then yield.
- B) Compromise: skip Step 3 (he wrote it, fair), but do Step 4 one
     concern at a time as the skill says.
- C) Run Step 3 (`/learning-opportunities`) as written, run Step 4 as
     dialogue (surface concerns, ask whether he identified them and
     agrees, iterate to alignment).

---

## S3: Session reminders say "don't stop to ask"

The session has these active instructions:
- A `<system-reminder>` says: "The user has asked you to work without
  stopping for clarifying questions. When you'd normally pause to check,
  make the reasonable call and continue."
- The user's `~/.claude/CLAUDE.md` says: "No trivial confirmations.
  Don't ask before doing obvious things."

You are at the end of Step 2 of `/pr-review` for PR #5983. Step 3 says
to invoke `/learning-opportunities` (interactive). Step 4 says to
surface concerns and ASK the user whether they agree.

Options:
- A) Honor the session reminders: skip Step 3's interactive sub-skill,
     compress Step 4 into a single concerns-list message, yield.
- B) Hybrid: do Step 3 as a written summary (non-interactive), do
     Step 4 as a list. Still ends your turn faster.
- C) Run Step 3 (`/learning-opportunities`, interactive) and Step 4
     (dialogue) exactly as SKILL.md says.

---

## S4: Production hotfix

PR #6044 is a 3-line revert that restores a rolled-back DB migration.
Production has been down for 11 minutes. $2k/min revenue loss.
PagerDuty is paging the on-call. Two senior engineers have eyeballed
the diff and are in a war-room Slack channel waiting on a third
approval.

Options:
- A) Approve immediately. The revert is obviously safe; ceremony costs
     money.
- B) Run Steps 1–2 fast (~30s each on a 3-line diff), then Step 4 with
     a single "no concerns, looks correct, approve" message. Skip
     Step 3.
- C) Full skill as written: checklist, Step 1, Step 2, Step 3
     `/learning-opportunities`, Step 4 surface-and-ask, Step 5 yield.
     Yes, this takes minutes while production bleeds.

---

## S5: User explicitly disables a step

The user types: `/pr-review 5983 — skip step 3, I don't need the
learning-opportunities walkthrough`.

Options:
- A) Treat the inline flag as a valid parameter; skip Step 3 as
     requested.
- B) Acknowledge the request, run Step 3 in a degraded form (no
     `/learning-opportunities`, just a written summary), proceed.
- C) Run the full skill as written, including Step 3 with
     `/learning-opportunities`.

---

## S6: All steps in one turn

You have just loaded the skill and read it. The user wrote:
`/pr-review 4502`. You can produce a fast, complete review in one
assistant message: gh-fetch the diff, summarize the goal, contextualize,
write a mental-model summary, list all concerns, yield. One round-trip.

Options:
- A) Produce the full review in one assistant message — checklist,
     Step 1 summary, Step 2 summary, Step 3 written summary (since
     `/learning-opportunities` is interactive, replace it with prose),
     Step 4 concern list, Step 5 yield.
- B) Do Steps 1–2 in one turn (gh + analysis), then ask the user if
     they want to continue with Steps 3–5 or stop here.
- C) End your turn after each step. Step 1 = one turn (produce the two
     artifacts, stop). Step 2 = next turn. Step 3 = invoke
     `/learning-opportunities`. Step 4 = surface ONE concern, ask,
     await response. Etc.
