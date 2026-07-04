---
description: Create small near-transfer practice tasks after learning, debugging, review, or design work so the user proves they can apply the concept with less help.
polytoken:
  tags:
    - learning
---

# Transfer Drill

Use this skill after a substantial coach-mode interaction when the user should practice
applying the same concept with less help.

The goal is to convert understanding into independent capability.

## Trigger examples

Use this skill after:

- a bug is understood or fixed
- a new system, API, or concept was explained
- an intuition-builder exercise completes
- a design tradeoff was resolved
- a code review identifies a pattern
- a codebase-comprehension session finds the relevant path
- the user asks "how do I know I learned this?"
- the user asks for practice
- the user asks what to try next

Do not use this skill for trivial lookup, syntax answers, boilerplate, docs summary,
formatting, or purely mechanical tasks. Do not use transfer as a disguised lecture or as a
way to justify revealing a high-learning task solution before the user attempts.

## What good transfer looks like

A good transfer drill is:

- small
- similar but not identical
- solvable with less help
- tied to the same underlying concept
- checkable
- not busywork

Prefer one strong transfer task over many weak ones.

## Transfer distance

Choose the distance deliberately.

### Near transfer

Use when the user is new to the concept or just struggled.

Examples:

- same function, new edge case
- same config pattern, one changed value
- same bug class, adjacent test
- same API, simpler call
- same design, smaller component

### Medium transfer

Use when the user handled the original well.

Examples:

- different file, same invariant
- different endpoint, same validation pattern
- different artifact type, same build pipeline
- different concurrency primitive, same race pattern
- different component, same state transition

### Far transfer

Use only when the user demonstrates fluency.

Examples:

- same principle in another framework
- same debugging strategy in another subsystem
- same architecture tradeoff in another service
- same performance model in another data structure

Start near. Move farther only if the user succeeds.

## Default flow

This is the internal progression over turns; do not output all seven steps at once.

1. Name the transferable concept.
2. Pick one transfer task.
3. State what the user should do without full help.
4. Give the success criteria, preferably including a prediction or self-explanation.
5. Withhold the solution until the user attempts.
6. After the attempt, grade against the criteria.
7. Offer one hint at a time if needed.

## Drill format

Use a compact format by default, preferably one paragraph or a few bullets:

Concept: <one sentence naming the durable idea>
Exercise: <one small task or leading question>
Check yourself: <one to three brief success criteria>

End by asking the user to try it before asking for the solution. I can give hints one
level at a time. Do not turn a transfer drill into a multi-section lecture.

## Hint ladder for drills

Use the same hint ladder as coach mode:

- L0: Ask a guiding question.
- L1: Point to the relevant file, symbol, concept, invariant, or observation.
- L2: Explain the principle without solving.
- L3: Give pseudocode, a test strategy, or an experiment.
- L4: Give a small fragment.
- L5: Give the full solution only after an attempt plus an explicit reveal request,
      or a valid execute/ship-mode switch.

A hint is classified by how much it reveals, not by its label.

## Grading the attempt

When the user attempts the drill, respond with:

1. What is correct
2. What is missing or risky
3. The smallest next correction
4. One follow-up question or next transfer, if useful

Avoid vague praise. Give specific feedback.

## Drill templates

### Debugging

Concept:
Debugging is hypothesis testing: expected behavior, observed behavior, falsifiable prediction.

Transfer task:
Pick one adjacent failure mode and state a hypothesis plus the smallest test/log/trace that would
confirm or falsify it.

Success criteria:
- names expected vs observed behavior
- states a falsifiable hypothesis
- chooses a minimal diagnostic
- predicts the result before running it

### Codebase comprehension

Concept:
Understanding a code path means knowing entry point, state transitions, side effects, and output.

Transfer task:
Trace the same kind of request/event through one adjacent path and identify where state changes.

Success criteria:
- identifies entry point
- identifies key call chain
- identifies state mutation or invariant
- explains output or side effect

### Test design

Concept:
A good regression test protects behavior, not implementation details.

Transfer task:
Write or outline the minimal failing test for one adjacent edge case.

Success criteria:
- states the behavior being protected
- fails before the fix
- passes after the fix
- avoids unnecessary implementation coupling

### Refactoring

Concept:
A safe refactor changes structure while preserving externally visible behavior.

Transfer task:
Apply the same refactor pattern to one smaller function or explain why it should not be applied.

Success criteria:
- names the invariant
- identifies regression risk
- proposes a small reversible step
- names the test/check that protects behavior

### Architecture/design

Concept:
A design choice is justified by constraints and tradeoffs, not by preference alone.

Transfer task:
Compare two designs for a smaller adjacent feature and choose one.

Success criteria:
- states constraints
- names non-goals
- compares tradeoffs
- chooses and defends one option
- identifies one failure mode

### Performance

Concept:
Performance intuition comes from identifying the dominant cost and the scaling variable.

Transfer task:
Predict the dominant cost in one adjacent path and propose a measurement.

Success criteria:
- names the likely bottleneck
- identifies input size or scaling variable
- proposes a measurement
- states what result would change the conclusion

### Security

Concept:
Security review means identifying trust boundaries, attacker-controlled input, and consequences.

Transfer task:
Find one adjacent trust boundary and describe how untrusted input could flow through it.

Success criteria:
- identifies trusted vs untrusted data
- names an attacker capability
- describes impact
- suggests a check or mitigation

### New technical system

Concept:
A transferable mental model maps inputs, composition/evaluation, outputs, and failure modes.

Transfer task:
Apply the same pipeline to a nearby variant.

Success criteria:
- identifies input/config
- identifies composition/evaluation step
- identifies produced artifact/runtime behavior
- predicts what changes in the variant
- names one likely failure mode

## Avoid

Do not:

- give the solution before the attempt
- assign a large homework project
- create vague practice like "try another one"
- ask many questions at once
- turn every tiny answer into a drill
- use transfer as a disguised lecture
- use post-hoc transfer to launder an ungated full solution

## Stop conditions

Stop or switch modes when:

- the user makes a valid execute/ship-mode switch
- the task is urgent and not learning-oriented
- the concept was trivial lookup
- the user declines practice
- the drill would be busywork
