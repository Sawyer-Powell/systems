# Learning science behind Socratic Learning

Why the rules in `SKILL.md` are shaped the way they are. Each section states the
research finding, then the **Design implication** — the specific rule it justifies
— so any rule can be traced back to its evidence and adapted when a situation
doesn't obviously fit. Read the section for a rule before bending that rule.

## Contents

1. Human/AI complementarity
2. Cognitive Load Theory
3. Retrieval practice & the testing effect
4. Desirable difficulties
5. Scaffolding & the Zone of Proximal Development
6. Guided discovery, not pure discovery
7. Elaborative interrogation & self-explanation
8. Socratic question taxonomy + Bloom's
9. LLM Socratic-tutor findings

---

## 1. Human/AI complementarity

The whole method rests on a division of labor: the agent is strong at breadth,
recall, and fast synthesis across a large corpus; the human is strong at abstract
framing, judgment, and noticing when the frame itself is wrong. Teaching works
best when each does what it's good at — the agent sources and organizes, the human
does the reasoning — and the agent resists the temptation to also do the human's
part by handing over conclusions.

**Design implication:** the SOURCE (agent breadth) vs. QUESTION (human reasoning)
split; the rule that the agent never states the answer it is fishing for.

## 2. Cognitive Load Theory (Sweller)

Working memory is severely limited. Load comes in three kinds: *intrinsic* (the
material's inherent difficulty, relative to what the learner already knows),
*extraneous* (imposed by poor presentation — undefined jargon, five ideas at once,
irrelevant detail), and *germane* (productive effort spent building durable mental
models). Overloading working memory stops learning outright; when intrinsic load
is already high, even small extraneous overhead becomes fatal.

**Design implication:** one idea per turn; define jargon before first use;
concrete example before abstraction; and — critically — when narrowing after a
wrong answer, reduce *scope* without introducing a new concept (narrowing must
lower load, not raise it).

- The Decision Lab: https://thedecisionlab.com/reference-guide/psychology/cognitive-load-theory
- Education NSW (CESE): https://education.nsw.gov.au/content/dam/main-education/about-us/educational-data/cese/2017-cognitive-load-theory.pdf

## 3. Retrieval practice & the testing effect (Roediger, Karpicke)

Being tested on material produces substantially better long-term retention than
re-studying it — on delayed tests, prior retrieval can beat re-reading by a wide
margin. Effortful retrieval strengthens the memory and builds additional routes
back to it. The practical upshot: the act of *asking* is the learning event, not a
check that happens after teaching.

**Design implication:** asking is the teaching; the hard stop after each question
(no hints, no suggested answers) is what forces the retrieval that makes it stick.

- Roediger & Karpicke (2006), *The Power of Testing Memory*: https://notes.andymatuschak.org/zGfjkW1ociSmSUCLcpbhKjf
- Karpicke & Roediger (2007), repeated retrieval: https://learninglab.psych.purdue.edu/downloads/2007/2007_Karpicke_Roediger_JML.pdf

## 4. Desirable difficulties (Bjork)

Conditions that make learning *feel* easy (massed practice, rereading) tend to
impair long-term retention, while conditions that make it feel effortful (spaced,
interleaved, retrieval-based) improve it. A narrower follow-up question is harder
than simply being told the answer — and that difficulty is the point. The caveat
(see §2): difficulty must stay within working-memory capacity; a question the
learner can't even parse produces frustration, not learning.

**Design implication:** prefer a narrower follow-up over giving the answer; the
pace levers ("just tell me", "faster") are the safety valve that keeps difficulty
*desirable* rather than crushing.

- Structural Learning on Bjork's desirable difficulties: https://www.structural-learning.com/post/robert-bjork-teachers-guide-desirable

## 5. Scaffolding & the Zone of Proximal Development (Vygotsky; Wood, Bruner & Ross)

The ZPD is the gap between what a learner can do alone and what they can do with
help from a more capable other. Scaffolding is temporary support pitched at that
boundary; its defining feature is *fading* — support must decrease as competence
grows. Hold it too long and you block independence; drop it too fast and you cause
frustration.

**Design implication:** start concrete and structured, then fade toward
open-ended questions as the human demonstrates a grip; pitch each question at the
edge of what they can currently do, not below it.

- Simply Psychology, ZPD: https://www.simplypsychology.org/zone-of-proximal-development.html

## 6. Guided discovery, not pure discovery (Kirschner, Sweller & Clark)

A large evidence base shows minimally-guided instruction (pure discovery,
unsupported problem-based learning) is *less* effective than guided instruction,
especially for novices: lacking domain schemas, novices can't generate productive
hypotheses, so they thrash under high load and learn little. Guidance recedes in
value only once the learner has substantial prior knowledge (see also the
expertise-reversal effect). The "narrow, don't correct" rule is guided discovery —
questions that shrink the search space — *not* pure discovery. But if narrowing
keeps failing, the learner has been pushed into unsupported-discovery territory.

**Design implication:** the escape hatch — after ~2 narrower questions that don't
land, widen back out or provide a worked example / simpler analogous case rather
than narrowing further. Never leave the human to flounder.

- Kirschner, Sweller & Clark (2006): https://www.tandfonline.com/doi/abs/10.1207/s15326985ep4102_1
- Full PDF: https://research.ou.nl/ws/files/1015152/Why%20minimal%20guidance%20during%20instruction%20does%20not%20work.pdf

## 7. Elaborative interrogation & self-explanation (Pressley et al.; Chi)

Prompting a learner to explain *why* or *how* something is true (elaborative
interrogation) forces them to connect new information to what they already know.
Self-explanation — having the learner articulate their own reasoning while working
— is stronger still, and works best *during* the reasoning, not after. Explanations
the learner generates are markedly more durable than ones handed to them.

**Design implication:** the "why do you think that?" rule; pulling for the
learner's own reasoning rather than moving on when they land an answer; and the
closing **teach-back** — a longer-form, free-recall description in the learner's
own words forces them to integrate the pieces into one model (the generation
effect), which is why the session ends with a teach-back, not a yes/no. Lead the
teach-back with a pointed, high-level prompt rather than an open "explain
everything," so the recall is guided, not floundering (see §6).

- UW–La Crosse CATL, elaborative interrogation: https://www.uwlax.edu/catl/guides/teaching-improvement-guide/how-can-i-improve/elaborative-interrogation/
- Northeastern CATL, self-explanation: https://learning.northeastern.edu/the-power-of-self-explanation/

## 8. Socratic question taxonomy + Bloom's

Socratic questioning maps onto the upper tiers of Bloom's taxonomy (analyze,
evaluate, create), but reaching those tiers requires stable ground on the lower
ones (remember, understand). Peer-reviewed Socratic-tutoring work uses five
question types that ladder from surface to depth: clarification,
assumption-probing, evidence-seeking, implication-exploring, and
perspective-testing. Forcing analysis-level questions before the learner has the
basics creates overload; genuine (open) questions beat pseudo-questions with one
expected answer.

**Design implication:** the five-type ladder, shallow→deep, and the rule against
jumping to deep questions on shaky ground.

- Pitt Teaching Center, Bloom's + discussion questions: https://teaching.pitt.edu/resources/designing-discussion-questions-using-blooms-taxonomy-examples/

## 9. LLM Socratic-tutor findings

Recent empirical work on LLM-based Socratic tutors converges on a few practical
points: tutors trained to ask the five Socratic question types outperform
non-Socratic baselines on critical-thinking measures; a recurring failure mode is
*asymmetric / coarse feedback* (praising a half-right answer as if fully right, or
flatly rejecting it) and weak sensitivity to the learner's current state; and
tracking learner mastery to tailor question depth improves outcomes.

**Design implication:** the asymmetric-feedback rule (name what's right, then ask
about what's incomplete) and fading based on demonstrated understanding — done in
conversation, without maintaining a formal ledger.

- Socratic chatbot for critical thinking (arXiv 2409.05511): https://arxiv.org/html/2409.05511v1
- GuideEval — instructional guidance in Socratic LLMs (arXiv 2508.06583): https://arxiv.org/pdf/2508.06583
- SocraticLM (NeurIPS 2024): http://staff.ustc.edu.cn/~huangzhy/files/papers/JiayuLiu-NeurIPS2024.pdf
