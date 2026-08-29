# The research behind Socratic Design

Why the rules in `SKILL.md` are shaped the way they are. Each section states a
research finding, then the **Design implication** — the specific rule it justifies —
so any rule can be traced to its evidence and adapted when a situation doesn't
obviously fit. Read the section for a rule before bending that rule.

The through-line: a designer's failures are rarely missing *information* — they are
blind spots (§2), and the fixes are structured dissent and made-explicit
assumptions (§3–6), not conclusions handed over. That is why the agent's role is
purely to ask. §10 covers the *stance* that keeps that questioning productive rather
than combative — load-bearing, because the same corrective question lands as help or
as attack depending on the frame it arrives in.

## Contents

1. Human/AI complementarity
2. Blind spots, not knowledge gaps — the biases that hit designers
3. Debiasing by considering the opposite
4. Prospective hindsight & the premortem
5. Structured dissent — devil's advocacy & dialectical inquiry
6. Surfacing assumptions
7. Socratic question taxonomy
8. Capturing design rationale
9. Self-explanation & justifying decisions
10. The productive-dialogue stance — why register decides whether rigor lands

---

## 1. Human/AI complementarity

The method rests on a lopsided division of labor. The agent is strong at breadth —
sweeping and organizing facts across a large corpus of code, docs, and history; the
human is the stronger *software designer*, holding the framing, the tradeoffs, and
the judgment about which risks matter. Value comes from each doing what it is good
at: the agent organizes information and puts it in front of the human, the human
designs, and the agent resists doing the human's part by handing over a conclusion —
which would substitute its weaker design judgment for the human's stronger one.

**Design implication:** the whole SOURCE/ORIENT (agent breadth) vs. EXAMINE (human
judgment) split, and the "withhold conclusions — always" rule. Questions are the
channel by which organized information reaches the design without the agent's design
judgment contaminating it.

## 2. Blind spots, not knowledge gaps — the biases that hit designers

A large body of judgment-and-decision research shows that skilled people fail not
from missing data but from systematic bias, and that simply *knowing* about the bias
rarely removes it:

- **Anchoring** (Tversky & Kahneman, 1974): an initial value or idea disproportionately
  constrains subsequent judgment — even when the anchor is transparently irrelevant.
  A designer anchors on their first design.
- **Confirmation bias** (Nickerson, 1998, review): people seek, interpret, and recall
  evidence that confirms an existing hypothesis and discount what contradicts it —
  even when aware of the tendency. A designer defends their first idea.
- **Design fixation** (Jansson & Smith, 1991) and the **Einstellung effect** (Luchins,
  1942): exposure to an example or a familiar solution path narrows the search space,
  so people miss simpler or better alternatives that are readily available.
- **Planning fallacy** (Kahneman & Tversky, 1979; Buehler, Griffin & Ross, 1994):
  systematic underestimation of time, cost, and risk *despite* knowing similar past
  efforts overran — students predicted 34 days for theses that took 55.

**Design implication:** the reason to *ask* rather than inform — the human's gap is
usually an unexamined assumption or an unpriced case, not a missing fact, so a
question that forces them to confront a skipped force is worth more than a
conclusion (which merely swaps their blind spot for the agent's). Directly motivates
"ask what they haven't considered" and "blind spots, not knowledge gaps."

- Anchoring: https://en.wikipedia.org/wiki/Anchoring_(cognitive_bias)
- Confirmation bias — Nickerson (1998): https://journals.sagepub.com/doi/abs/10.1037/1089-2680.2.2.175
- Design fixation — Jansson & Smith (1991): https://www.sciencedirect.com/science/article/abs/pii/0142694X9190003F
- Einstellung effect: https://en.wikipedia.org/wiki/Einstellung_effect
- Planning fallacy: https://en.wikipedia.org/wiki/Planning_fallacy

## 3. Debiasing by considering the opposite

The most robust general debiasing strategy is *considering the opposite*: explicitly
generating reasons the current view might be wrong. Lord, Lepper & Preston (1984)
showed it reduces biased assimilation of evidence — and beats generic "be objective"
instructions. Mussweiler, Strack & Pfeiffer (2000) showed the same move measurably
reduces even the notoriously stubborn anchoring effect, by activating knowledge
inconsistent with the anchor.

**Design implication:** a question that makes the human argue against their own design
is a stronger intervention than any fact. Motivates the EXAMINE loop generally and
the premortem at CAPTURE specifically.

- Lord, Lepper & Preston (1984): https://psycnet.apa.org/record/1985-11753-001
- Mussweiler, Strack & Pfeiffer (2000), via The Decision Lab: https://thedecisionlab.com/biases/anchoring-bias

## 4. Prospective hindsight & the premortem

Mitchell, Russo & Pennington (1989) found that imagining an outcome *has already
happened* ("prospective hindsight") increases people's ability to generate reasons
for that outcome by roughly 30% versus imagining it merely *might* happen. Gary
Klein turned this into the **premortem**: before committing, assume the design has
failed and ask why. The tense shift — from "what could go wrong" to "it went wrong;
explain it" — surfaces risks that forward-looking risk assessment misses.

**Design implication:** the CAPTURE step closes with a premortem framed as
*this design already failed — where?*, not a generic "any concerns?" It's the highest-
yield question form the agent has, and it stays a question asked *with* the human,
never a verdict handed down.

- Klein, *Performing a Project Premortem* (HBR, 2007): https://hbr.org/2007/09/performing-a-project-premortem

## 5. Structured dissent — devil's advocacy & dialectical inquiry

Schwenk's (1990) meta-analysis of structured-conflict studies found that introducing
formal dissent — devil's advocacy (one assigned critic) or dialectical inquiry (a
formal debate between opposing plans) — produces higher-quality decisions than
expert consensus, which tends to suppress disagreement (cf. groupthink). Notably,
devil's advocacy was *not* reliably worse than the heavier dialectical-inquiry
method: a single well-aimed critic captures most of the benefit.

**Design implication:** a single agent playing structured critic is enough — the
skill does not need to stage elaborate opposing designs. It also grounds the
collaborative stance (§10): the dissent is a *role* in service of the design, not
genuine adversarialism, which is what keeps it corrective rather than defensive.

- Schwenk (1990) meta-analysis: https://ideas.repec.org/a/eee/jobhdp/v47y1990i1p161-176.html

## 6. Surfacing assumptions

Strategic Assumption Surfacing and Testing (Mitroff & Emshoff, 1979) and RAND's
Assumption-Based Planning (Dewar et al.) both formalize one move: make a plan's
*implicit* assumptions explicit, then find the "load-bearing" ones — the assumptions
whose failure would materially change the design — and test or hedge them. Plans fail
at their unexamined assumptions, so naming them is where robustness is won.

**Design implication:** "surface unstated assumptions" as the first deep move in the
question ladder, and the SOURCE-phase hunt for contradictions between what the human
is assuming and what the code/docs actually enforce.

- RAND, *Assumption-Based Planning* (Dewar): https://www.rand.org/pubs/monograph_reports/MR114.html

## 7. Socratic question taxonomy

Paul & Elder (Foundation for Critical Thinking) organize Socratic inquiry into six
question types — clarification, probing assumptions, probing evidence, viewpoints and
perspectives, implications and consequences, and questions about the question —
arguing that systematic questioning surfaces unstated premises and strengthens
reasoning far more than open-ended discussion. Genuine (open) questions outperform
questions with one expected answer.

**Design implication:** the laddered question types (clarify-the-goal →
surface-assumptions → probe-constraints/prior-art → stress edge & failure modes →
weigh-alternatives → trace-consequences), and the rule against jumping to
consequence-tracing before the goal is clear.

- Paul & Elder, *The Art of Socratic Questioning*: https://www.criticalthinking.org/files/SocraticQuestioning2006.pdf

## 8. Capturing design rationale

Design-rationale research argues that the durable value of a design is not just the
chosen option but the *design space* around it — the alternatives considered and the
criteria used. QOC (MacLean, Young, Bellotti & Moran, 1991) captures Questions,
Options, and Criteria; IBIS (Rittel & Kunz; Conklin's gIBIS) structures deliberation
as Issues, Positions, and Arguments; and Architecture Decision Records (Nygard, 2011)
record each decision's context, the decision, and its consequences in the repo.
The shared claim: recording *why*, and what was rejected, prevents uninformed
re-litigation and makes the design defensible to people who weren't in the room.

**Design implication:** the CAPTURE step records decisions *and* rationale — what was
chosen, what was rejected, why, and the tradeoff accepted — not just the final shape.

- QOC — MacLean et al. (1991): https://acawiki.org/Questions,_Options,_and_Criteria:_Elements_of_design_space_analysis
- IBIS / gIBIS: https://en.wikipedia.org/wiki/Issue-based_information_system
- ADR — Nygard (2011): https://www.cognitect.com/blog/2011/11/15/documenting-architecture-decisions

## 9. Self-explanation & justifying decisions

Chi, De Leeuw, Chiu & Lavancher (1994) established the *self-explanation effect*:
articulating *why* — while reasoning — forces integration with prior knowledge,
surfaces gaps, and corrects errors, yielding better understanding than passively
receiving an explanation. Applied to design, being made to justify a choice (rather
than just state it) is itself a check: a decision the designer can't defend aloud is
one that needs more work.

**Design implication:** the "pull for rationale" rule ("why that over the
alternative?") and capturing the justification, not just the choice — the act of
justifying is a defect detector, not bookkeeping.

- Chi et al. (1994), *Eliciting self-explanations improves understanding*: https://onlinelibrary.wiley.com/doi/10.1207/s15516709cog1803_3

## 10. The productive-dialogue stance — why register decides whether rigor lands

The debiasing moves in §3–5 are only as good as the stance they arrive in: the same
corrective question is absorbed or resisted depending on whether it reads as joint
inquiry or as attack. Education and organizational research converge here:

- **Exploratory vs. disputational talk** (Mercer; Wegerif — Thinking Together,
  Cambridge). Mercer distinguishes *disputational* talk (assertion and
  counter-assertion, defending turf) from *exploratory* talk, where participants
  engage critically but constructively with each other's reasoning and offer
  justifications and alternatives. Exploratory talk is what makes reasoning publicly
  accountable and measurably improves problem-solving — and it depends on ideas being
  built on, not attacked.
- **Accountable Talk / deliberative discourse** (Michaels, O'Connor & Resnick, 2008).
  Rigorous discussion rests on three accountabilities — to the community (listen and
  build on others), to reasoning (logical connections, warranted conclusions), and to
  knowledge (grounded in facts and texts). Rigor and respect are the *same* practice,
  not a trade-off.
- **Dialogic teaching** (Alexander). Productive talk is collective, reciprocal,
  *supportive* (it is safe to take an intellectual risk), cumulative (ideas build on
  ideas), and purposeful. Note "supportive": challenge without safety shuts inquiry
  down.
- **Psychological safety** (Edmondson, 1999). Where people feel safe to take
  interpersonal risks, they surface problems and learn; where they feel threatened,
  they go quiet and defensive. Threat suppresses exactly the error-detection the
  method is trying to produce.

The unifying mechanism, with §5's role-based dissent: framing critique as a *role*
played *with* the designer — and engaging the strongest version of their design (the
principle of charity / steelmanning) — preserves the full corrective power of
dissent while removing the defensiveness a personal challenge triggers.

**Design implication:** the "note on stance" up front (collaborative inquiry, not
interrogation); naming the loop **Examine** rather than "Challenge" and the closing
move a **premortem** rather than an "adversarial pass"; the "imagine failure
*together*" framing; and the affirmative register throughout — hard questions,
generous stance. Softening the register is not softening the rigor: §§3–5 and the
"withhold conclusions" rule stay exactly as sharp.

- Exploratory talk — Thinking Together (Cambridge): https://thinkingtogether.educ.cam.ac.uk/
- Accountable Talk — Michaels, O'Connor & Resnick (2008): https://link.springer.com/article/10.1007/s11217-007-9071-1
- Dialogic teaching — Alexander: https://robinalexander.org.uk/dialogic-teaching/
- Psychological safety — Edmondson (1999): https://journals.sagepub.com/doi/10.2307/2666999
