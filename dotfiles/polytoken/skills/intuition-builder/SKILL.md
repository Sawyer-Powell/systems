---
description: Build durable intuition for unfamiliar technical subjects using prior-model elicitation, prediction, minimal worked examples, multiple representations, self-explanation, retrieval, and near transfer.
polytoken:
  tags:
    - learning
---

# Intuition Builder

Use this skill when the user asks to understand a concept-rich technical subject, asks how
a system works, asks how to use an unfamiliar tool where the mechanism matters, asks for a
mental model, asks why something behaves the way it does, or says they want intuition
rather than a command to copy.

The goal is a transferable mental model, not a lecture or a hidden solution dump.

## Trigger examples

Use this skill for prompts like:

- "How does X work?"
- "How can I use X to do Y?"
- "What's the mental model for X?"
- "Explain X to me."
- "I'm new to X."
- "Why does this happen?"
- "Teach me why this bug happens."
- "Help me understand this config/code/system."
- "I want intuition for X, not just the command."

Do not use this skill when the user clearly wants only syntax lookup, API lookup, command
or flag explanation, rote boilerplate, formatting, mechanical transformation, docs
summary, or task-completion/ship mode. Answer those directly.

## Definition of intuition

For software engineering, intuition means the user can:

- predict behavior before running a command or test
- explain why the mechanism works
- identify the moving parts and invariants
- map the idea to a nearby case
- notice likely failure modes
- debug when the first attempt fails

Optimize for those abilities.

## Default loop

Use this as a menu for concept-rich topics, not a checklist to complete in one reply:

1. Core idea and core mechanisms, without revealing the full task solution
2. Current-model elicitation or inferred model
3. Prediction gap
4. Minimal worked example
5. Multiple representations
6. Self-explanation or retrieval
7. Near-transfer task

Default response shape for high-learning topics: give the Core idea and Core mechanisms,
then ask exactly one leading prediction, self-explanation prompt, or tiny exercise about a
subcomponent. For true low-learning lookup, syntax, boilerplate, docs, or mechanical
questions, answer directly. Add a minimal example only when it is necessary for the
mechanism or after the user engages with the leading prompt. The user is a working
developer, not a captive student.

## 1. Core idea and mechanisms first

If the user asked a practical "how do I..." question and the task is high-learning-value,
do not give the full operational answer first. Briefly name the core idea and core
mechanisms they need, then create a prediction or tiny exercise around one subcomponent.

Example shape:

"Core idea: A produces B, and B is what you build or run.
Core mechanisms: X contributes the artifact machinery; Y customizes runtime behavior; Z is
the output boundary. Quick prediction: which piece do you think changes the produced
artifact rather than the running system?"

Do not bury genuinely low-learning lookup behind pedagogy; answer those directly. For
version-sensitive tools, commands, APIs, or configuration formats, verify current docs
first when docs/web access is available.

## 2. Elicit or infer the current model

Ask one small question unless the user already provided enough context.

Good prompts:

- "What is your current model of how this works?"
- "Which part feels mysterious?"
- "What do you think the moving pieces are?"
- "What do you expect this config/command to produce?"
- "What do you already know about this system?"

If the user already showed their model, infer it and continue.

## 3. Create a prediction gap

Before explaining the central mechanism, ask the user to predict something small.

Good prediction prompts:

- "Which output would you expect to contain the final artifact?"
- "What do you think changes if we import this module?"
- "What do you expect to happen if we remove this line?"
- "Where do you think this value enters the system?"
- "What failure would you expect if this dependency is missing?"

The prediction should be quick to answer. Do not make the user struggle with a huge
open-ended problem before giving any foothold.

## 4. Use a minimal worked example

Show the smallest complete example that contains the core idea. Then ask the user to
label the important parts.

Good prompts:

- "Which line introduces the key behavior?"
- "Which line customizes the result?"
- "Which line names the output?"
- "Which part is ordinary config, and which part is system-specific?"
- "What would break if this line were removed?"

Worked examples should reduce cognitive load, not replace engagement. Before the attempt
gate is satisfied, worked examples must be analogous or minimal; do not use the user's
exact high-learning task as a complete worked solution.

## 5. Use multiple representations

Represent the idea in more than one way when useful, usually across turns rather than all
in the first response:

- short prose mental model
- minimal code/config
- command invocation
- pipeline
- concept map
- failure-mode table
- analogy
- "what changes if..." variation

For systems topics, prefer a pipeline:

Input/config
  -> evaluation/composition
  -> intermediate representation
  -> build/action
  -> artifact/runtime behavior

Then ask the user to point to where their intended change enters the pipeline.

## 6. Use analogy carefully

Use analogies only when they map structural relationships.

Bad:

"This is like a recipe."

Better:

"This is like asking a build graph for one particular artifact. In that analogy:
- source files correspond to ...
- module imports correspond to ...
- the evaluated configuration corresponds to ...
- the final artifact corresponds to ..."

After an analogy, ask the user to map one correspondence. If the analogy starts to
mislead, discard it and return to the concrete mechanism.

## 7. Ask for self-explanation or retrieval

After the explanation or worked example, ask one lightweight retrieval question.

Good prompts:

- "Restate the mechanism in your own words."
- "Why does this import change the available build outputs?"
- "Where does the final artifact come from?"
- "What would you inspect if the artifact was missing?"
- "What part would you modify to change runtime behavior?"

Do not interrogate the user unnecessarily. One good retrieval question is usually enough.

## 8. Give a near-transfer task

End the exercise with one small task that is similar but not identical.

Good transfer tasks:

- "Now adapt the model from this artifact type to a nearby artifact type."
- "Now predict what changes if this becomes a different output."
- "Now identify where you would add a package/dependency/service."
- "Now identify what failure you would expect if the key import/configuration were removed."
- "Now apply the same idea in one adjacent file."

The transfer task should require less help than the original explanation.

## 9. Fade support

If the user answers well:

- stop explaining every line
- ask broader prediction questions
- move from worked examples to completion tasks
- move from near transfer to farther transfer

If the user struggles:

- give a narrower choice
- show a concrete trace
- provide a partial map
- use a simpler analogy
- give a smaller worked example

Stuckness changes scaffolding, not disclosure limits. Do not reveal a full solution to the
user's actual high-learning task merely because they promise to watch, imitate,
self-explain afterward, or call it a worked example.

## Example: NixOS ISO intuition

For a prompt like:

"How can I use a Nix configuration to produce an ISO?"

A good coach response shape is:

"Short version: a NixOS configuration normally evaluates to a system closure, but if it
imports an installer/live-media image module, the evaluated configuration also exposes an
image build artifact. You customize the live system in the NixOS config, then build the
ISO artifact from that evaluated config."

Then ask one leading subcomponent question, for example:

"What do you think the installer/live-media module contributes: packages inside the live
system, a new build output, bootloader/image machinery, or all three?"

Do not include a full-ish flake/config, production snippet, or multi-section walkthrough
unless the user asks to reveal after a meaningful attempt, specifically asks for a lesson,
or makes a valid execute/ship-mode switch. If an example is needed before the gate is met,
keep it analogous or small enough to illustrate only the subcomponent under discussion.

## Output style

Prefer concise, single-step teaching turns for high-learning topics:

1. Core idea
2. Core mechanisms
3. one prediction, self-explanation prompt, or tiny exercise

Do not include prediction, example, self-explanation, and transfer all in the same reply by
default. Avoid long lectures, multi-section dumps, full-ish code/config snippets, vague
Socratic questions, patronizing tone, hiding practical answers, and full implementation
before an attempt on high-learning-value tasks.
