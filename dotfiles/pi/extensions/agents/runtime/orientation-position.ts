/**
 * Where the orientation block goes in an LLM call's messages.
 *
 * Anthropic prompt caching puts a single conversation breakpoint on the last block of the request (pi's
 * `convertMessages`). A block that is appended at the *end* of every call therefore moves each call, so the
 * entry written by call N is never a prefix of call N+1 and nothing but the system prompt and tools is ever
 * read from the cache: every call re-writes the whole conversation. Inserting the block at a position that
 * is fixed for the whole run (the end of the history that existed when the run started) keeps every call a
 * pure extension of the previous one.
 */
export interface Positioned<T> {
	messages: T[];
	/** The position to reuse for the rest of the run. */
	at: number;
}

/** `messages` with `block` inserted at `at` (first call of a run: the end), and the position to remember. */
export function insertAtRunPosition<T>(messages: T[], block: T, at: number | undefined): Positioned<T> {
	const position = Math.min(at ?? messages.length, messages.length);
	return { messages: [...messages.slice(0, position), block, ...messages.slice(position)], at: position };
}
