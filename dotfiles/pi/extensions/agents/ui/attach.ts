/** Attach to an interactable agent's PTY in a new zellij tab. */
import { insideZellij, newTab } from "../../zellij/panes.ts";
import type { AgentRecord } from "../store/index.ts";

/**
 * Terminal modes pi enables once, at startup, on the terminal it first ran in: alt screen,
 * no autowrap, button-motion mouse reporting (wheel/click), focus events, bracketed paste.
 * A client that attaches later never sees them, so without replaying them the wheel scrolls
 * the multiplexer's scrollback instead of pi, and the screen is not an alt screen.
 */
export const TERMINAL_MODES = "\\033[?1049h\\033[?7l\\033[?1000h\\033[?1002h\\033[?1004h\\033[?1006h\\033[?2004h";

/**
 * `dtach -r winch` only makes pi repaint when the pty size actually changes, so an
 * attach from a tab the same size as the previous client shows nothing. The wrapper
 * nudges the tab's tty by one column and back after attaching, which forces a repaint.
 * `$1` is the socket path.
 */
export const ATTACH_SCRIPT = [
	`printf '${TERMINAL_MODES}'`,
	'sock=$1',
	'set -- $(stty size 2>/dev/null </dev/tty)',
	'c=$2',
	'if [ -n "$c" ] && [ "$c" -gt 2 ]; then',
	'  ( sleep 1; stty cols $((c-1)) </dev/tty; sleep 0.3; stty cols "$c" </dev/tty ) >/dev/null 2>&1 &',
	'fi',
	'exec dtach -a "$sock" -r winch',
].join("\n");

export function attachArgv(ptySocket: string): string[] {
	return ["sh", "-c", ATTACH_SCRIPT, "agents-attach", ptySocket];
}

interface AttachResult {
	opened: boolean;
	/** What the user can run by hand when a tab cannot be opened. */
	command: string;
}

export async function attach(record: AgentRecord, ptySocket: string): Promise<AttachResult> {
	// The manual command is the plain attach; a terminal that is resized after attaching repaints anyway.
	const command = `dtach -a ${/[^\w@%+=:,./-]/.test(ptySocket) ? JSON.stringify(ptySocket) : ptySocket} -r winch`;
	if (!insideZellij()) return { opened: false, command };
	await newTab({ argv: attachArgv(ptySocket), name: record.input.id, cwd: record.input.cwd });
	return { opened: true, command };
}
