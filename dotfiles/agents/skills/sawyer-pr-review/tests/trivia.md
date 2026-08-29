# sawyer-pr-review trivia

Trivia bank for the `sawyer-pr-review` skill. Each question must be answerable
from `SKILL.md` alone.

Pass criteria: a `general-purpose` subagent given the SKILL.md text plus this
file must answer every question correctly without inferring from training data
or general PR-review intuition. **Haiku-pass is the acceptance bar.**

## Q1: What tool does the skill require for inspecting PR contents?
**A:** The `gh` CLI, and only the `gh` CLI. No other tool is permitted for fetching/viewing PR content.

## Q2: Is the reviewer allowed to `git checkout` the PR branch locally?
**A:** No. The skill explicitly forbids changing branches and checking out the PR. All inspection happens through `gh` against the remote.

## Q3: What two artifacts must Step 1 produce before moving on?
**A:** (1) A concise explanation of the PR's goal, and (2) a brief technical explanation of how the PR achieves that goal, grounded in the actual code.

## Q4: In Step 2, what is the reviewer trying to understand?
**A:** How the PR fits into the larger Plenful system — specifically (a) which existing codebase patterns (tests + implementation) the PR is reusing, and (b) any new patterns the PR introduces.

## Q5: What other skill must Step 3 invoke?
**A:** The `learning-opportunities` skill (`/learning-opportunities`). Step 3 is not a free-form explanation — it routes through that skill to build the user's mental model.

## Q6: What is the exit condition for Step 3?
**A:** High confidence that the user fully understands the PR. Until then, Step 3 is not complete.

## Q7: Step 4 asks the reviewer to surface concerns. Name the four concern categories the skill calls out explicitly.
**A:** (1) Runtime bugs, (2) code style issues (breaks from codebase norms), (3) bad pattern breaks (where existing codebase patterns would make the code simpler/safer), (4) implementation misaligned from the PR's stated goal.

## Q8: After surfacing concerns in Step 4, what must the reviewer do before proceeding?
**A:** Ask the user whether they identified any issues and whether they agree with the issues the reviewer raised. Step 4 is collaborative, not a one-way report.

## Q9: What are the two acceptable exit conditions for Step 4?
**A:** Either (a) reviewer and user agree on a concrete list of suggestions, or (b) reviewer and user agree to approve the PR.

## Q10: In Step 5, who writes the actual PR approval/comments on GitHub?
**A:** The user. Step 5 is "yield to the user" — the reviewer's job ends after alignment in Step 4. The skill does not author the PR review comment.

## Q11: What must happen IMMEDIATELY at the start of executing the skill?
**A:** Create a checklist of the steps. The skill requires this before any other action.

## Q12: The user types `/pr-review` but does not include a PR number. Should the skill proceed?
**A:** No. The skill requires a PR number as a parameter. Without one, it cannot proceed.

## Q13: Is the reviewer expected to draft the GitHub review comment / approval message for the user?
**A:** No. Step 5 explicitly yields responsibility for responding to the PR (approval or comments) to the user.

## Q14: When inspecting files referenced by the PR but not changed in the diff, what mechanism does the skill prescribe?
**A:** The `gh` CLI exploring the codebase on the remote branch (Step 2). Local checkout is not permitted.

## Q15: Is it acceptable to skip Step 3 (`/learning-opportunities`) if the reviewer believes the user already understands the PR?
**A:** No. The skill prescribes Step 3 unconditionally; the exit condition is high confidence the user understands, but the step itself is not optional.
