/** Encode reporting in the durable objective, avoiding a daemon/store protocol change. */
export function withReporting(objective: string, reporting?: string): string {
	return `${objective}\n\n## Parent signaling contract\n${SIGNALING_RULES}\n\nParent reporting policy:\n${reporting?.trim() || `Unless the objective explicitly specifies otherwise: ${DEFAULT_REPORTING}`}`;
}

export const DEFAULT_REPORTING = "Quiet: final handoff and genuinely blocking questions only, except material scope/safety surprises. " +
	"Final handoff: at most 200 words covering result, changed/relevant file paths, verification and unresolved risks/questions. " +
	"Link artifacts rather than pasting logs. Profile-specific human handoffs remain unchanged.";

export const SIGNALING_RULES = `Treat parent messages as costly interruptions, not a progress channel.
- Use ask_parent only for a genuinely blocking question/decision only the parent can resolve; batch related questions, then end your turn.
- Use send_message(to: "parent", kind: "info") only for an explicitly requested trigger or a material scope/safety surprise requiring timely attention. State the consequence/action needed; do not disguise progress as a question.
- Unless explicitly requested, do not push routine progress, phase changes, minor findings, or material the parent can read from artifacts/session on demand. Use set_status sparingly for meaningful activity changes (no sensitive data); put detailed notes in a task artifact when useful, not in parent messages.
- Batch related non-blocking signals into one message per requested trigger; do not repeat unchanged information or send a second update while the first is unanswered unless a new urgent risk arises. No periodic reporting unless explicitly requested.
- Use yield(to: "parent", message: ...) once work is complete, not at phase boundaries. Follow the parent's final-handoff format/length. Preserve profile-specific user handoffs and human wrap-up requests.
- If delegating, state what signals and final handoff you need; omitted reporting means quiet. A later explicit parent instruction may revise this policy.`;
