/**
 * nvim process kind.
 *
 * All neovim knowledge lives here: how to launch an addressable instance, how
 * to reach it, and how to translate a protocol message into an nvim command.
 * The core never sees `nvim`, `--listen`, or the remote-expr transport.
 *
 * The control channel is nvim's own `--listen` socket. Each message is one
 * short-lived `nvim --server <socket> --remote-expr ...` client, so there is no
 * long-lived connection to babysit and no dependency to install. Read-only
 * messages (`context`, `diagnostics`) return JSON.
 */
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import { Type } from "typebox";
import type { ProcessKind, ProcessMessage, ProcessRecord, SendResult, SpawnSpec } from "../protocol.ts";

const execFileAsync = promisify(execFile);

const NvimConfig = Type.Object({
	path: Type.String({ description: "File to open in the pane." }),
	line: Type.Optional(Type.Number({ description: "Line to place the cursor on." })),
});

const OpenMessage = Type.Object({
	type: Type.Literal("open"),
	path: Type.String({ description: "File to make the active buffer." }),
	line: Type.Optional(Type.Number({ description: "Line to place the cursor on." })),
	cwd: Type.Optional(
		Type.String({ description: "Change the editor's working directory (before opening), e.g. when switching projects." }),
	),
});

const ContextMessage = Type.Object({
	type: Type.Literal("context"),
	scope: Type.Optional(
		Type.Union([Type.Literal("cursor"), Type.Literal("selection"), Type.Literal("buffer")], {
			description: "Diagnostics to include. Defaults to the selection when one exists, else the cursor line.",
		}),
	),
});

const DiagnosticsMessage = Type.Object({
	type: Type.Literal("diagnostics"),
	scope: Type.Optional(
		Type.Union(
			[Type.Literal("buffer"), Type.Literal("cursor"), Type.Literal("selection"), Type.Literal("workspace")],
			{ description: "What to report on. Defaults to the current buffer." },
		),
	),
	severity: Type.Optional(
		Type.Union([Type.Literal("error"), Type.Literal("warning"), Type.Literal("info"), Type.Literal("hint")], {
			description: "Only this severity.",
		}),
	),
	path: Type.Optional(Type.String({ description: "Report on this file instead of the current buffer." })),
});

const NotesMessage = Type.Object({
	type: Type.Literal("notes"),
	paths: Type.Optional(
		Type.Array(Type.String(), { description: "Scan these files instead of the open file buffers." }),
	),
});

const DiffviewMessage = Type.Object({
	type: Type.Literal("diffview"),
	rev: Type.Optional(
		Type.String({
			description:
				"Revision argument for Diffview, e.g. a commit id or 'A..B'. Omit for working-tree changes.",
		}),
	),
	paths: Type.Optional(Type.Array(Type.String(), { description: "Limit the diff to these paths." })),
});

const NvimMessage = Type.Union([OpenMessage, ContextMessage, DiagnosticsMessage, DiffviewMessage, NotesMessage]);

interface NvimDiagnostic {
	path: string;
	line: number;
	col: number;
	endLine: number;
	endCol: number;
	severity: string;
	message: string;
	source: string | null;
	code: string | number | null;
}

interface NvimContext {
	file: string;
	cursor: { line: number; col: number };
	mode: string;
	selection: { startLine: number; startCol: number; endLine: number; endCol: number; lines: string[] } | null;
	diagnostics: NvimDiagnostic[];
}

/** Marker files/folders used to pick a process working directory for LSP-style tooling. */
const PROJECT_MARKERS = [
	".git",
	".jj",
	".hg",
	".svn",
	"package.json",
	"tsconfig.json",
	"jsconfig.json",
	"pyproject.toml",
	"Cargo.toml",
	"go.mod",
	"deno.json",
	"deno.jsonc",
	"Gemfile",
];

/**
 * Fixed Lua for `open`: file, line, and optional cwd arrive as `_A[1..3]`, so no
 * model or path text is ever compiled as source. The cursor is clamped.
 */
const OPEN_LUA =
	"(function() local p=_A[1] local l=_A[2] local d=_A[3] if d then vim.cmd.cd(vim.fn.fnameescape(d)) end vim.cmd.edit(vim.fn.fnameescape(p)) if l then vim.api.nvim_win_set_cursor(0,{math.min(l, vim.fn.line('$')),0}) end end)()";

/**
 * Fixed Lua for the read-only `context` / `diagnostics` messages. Options arrive
 * as `_A = { mode, scope, severity, path }` (empty strings mean unset). Returns
 * a JSON string. No `"` or `\` may appear below: the source is embedded in a Vim
 * double-quoted string, so those would need escaping.
 */
const QUERY_LUA =
	"(function() " +
	"local opts=_A local mode=opts[1] local scope=opts[2] local sev=opts[3] local path=opts[4] " +
	"if scope=='' then scope=nil end if sev=='' then sev=nil end if path=='' then path=nil end " +
	"local SEV={'error','warning','info','hint'} local SEVNUM={error=1,warning=2,info=3,hint=4} " +
	"local function sevname(n) return SEV[n] or 'unknown' end " +
	"local function pathof(buf) return vim.api.nvim_buf_get_name(buf) end " +
	"local function keep(d) return not sev or d.severity==SEVNUM[sev] end " +
	"local function onerow(d,bpath) return {path=bpath,line=d.lnum+1,col=d.col+1,endLine=(d.end_lnum or d.lnum)+1,endCol=(d.end_col or d.col)+1,severity=sevname(d.severity),message=d.message,source=d.source,code=d.code} end " +
	"local function rowsbuf(buf) local out={} for _,d in ipairs(vim.diagnostic.get(buf)) do if keep(d) then out[#out+1]=onerow(d,pathof(buf)) end end return out end " +
	"local function allrows() local out={} for _,d in ipairs(vim.diagnostic.get(nil)) do if keep(d) then out[#out+1]=onerow(d,pathof(d.bufnr)) end end return out end " +
	"local function pick(rows,pred) local out={} for _,r in ipairs(rows) do if pred(r) then out[#out+1]=r end end return out end " +
	"local function findbuf(p) local b=vim.fn.bufnr(p) if b~=-1 then return b end local t=vim.fn.resolve(vim.fn.fnamemodify(p,':p')) for _,bb in ipairs(vim.api.nvim_list_bufs()) do local n=vim.api.nvim_buf_get_name(bb) if n~='' and vim.fn.resolve(n)==t then return bb end end return -1 end " +
	"local buf=vim.api.nvim_get_current_buf() local pos=vim.api.nvim_win_get_cursor(0) " +
	"local m=vim.api.nvim_get_mode().mode local sp local ep " +
	"if m=='v' or m=='V' or m==string.char(22) then sp=vim.fn.getpos([['v]]) ep=vim.fn.getpos('.') else sp=vim.fn.getpos([['<]]) ep=vim.fn.getpos([['>]]) end " +
	"local sel=nil if sp[2]>0 and ep[2]>0 then if sp[2]>ep[2] then local t=sp sp=ep ep=t end sel={startLine=sp[2],startCol=sp[3],endLine=ep[2],endCol=ep[3],lines=vim.fn.getline(sp[2],ep[2])} end " +
	"local function oncursor(r) return r.line==pos[1] end " +
	"local function inrange(r) return sel and r.line>=sel.startLine and r.line<=sel.endLine end " +
	"if mode=='diagnostics' then " +
	"if path then local b=findbuf(path) if b==-1 then return vim.json.encode({error='buffer not open: '..path}) end return vim.json.encode({scope='buffer',diagnostics=rowsbuf(b)}) end " +
	"if scope=='workspace' then return vim.json.encode({scope='workspace',diagnostics=allrows()}) end " +
	"local rows=rowsbuf(buf) local chosen=rows " +
	"if scope=='cursor' then chosen=pick(rows,oncursor) elseif scope=='selection' then if sel then chosen=pick(rows,inrange) else chosen=pick(rows,oncursor) end end " +
	"return vim.json.encode({scope=scope or 'buffer',diagnostics=chosen}) end " +
	"local rows=rowsbuf(buf) local chosen " +
	"if scope=='buffer' then chosen=rows elseif scope=='cursor' then chosen=pick(rows,oncursor) " +
	"elseif scope=='selection' then if sel then chosen=pick(rows,inrange) else chosen=pick(rows,oncursor) end " +
	"elseif sel then chosen=pick(rows,inrange) else chosen=pick(rows,oncursor) end " +
	"return vim.json.encode({file=pathof(buf),cursor={line=pos[1],col=pos[2]+1},mode=vim.api.nvim_get_mode().mode,selection=sel,diagnostics=chosen}) " +
	"end)()";

/** Finds `NOTE(agent)` comments in loaded file buffers, or in the given paths. */
const NOTES_LUA =
	"(function() local paths=_A local out={} local scanned=0 " +
	"local function scan(name,lines) scanned=scanned+1 for i,line in ipairs(lines) do if line:find('NOTE(agent)',1,true) then out[#out+1]={path=name,line=i,text=line} end end end " +
	"if #paths>0 then for _,p in ipairs(paths) do local ok,lines=pcall(vim.fn.readfile,p) if ok then scan(p,lines) end end return vim.json.encode({scope='paths',scanned=scanned,notes=out}) end " +
	"for _,b in ipairs(vim.api.nvim_list_bufs()) do if vim.api.nvim_buf_is_loaded(b) and vim.bo[b].buftype=='' then local name=vim.api.nvim_buf_get_name(b) if name~='' then scan(name,vim.api.nvim_buf_get_lines(b,0,-1,false)) end end end " +
	"return vim.json.encode({scope='buffers',scanned=scanned,notes=out}) end)()";

/** Opens Diffview through its Lua API (never a `:cmd` string, so no injection). */
const DIFFVIEW_LUA =
	"(function() local ok,dv=pcall(require,'diffview') if not ok then return 'ERROR: diffview.nvim is not installed' end local pok,err=pcall(dv.open,_A) if not pok then return 'ERROR: '..tostring(err) end return 'ok' end)()";

/** Vim single-quoted string; only `'` needs doubling. */
function vimString(value: string): string {
	if (value.includes("\n") || value.includes("\0")) {
		throw new Error("nvim: paths may not contain newlines or NUL bytes");
	}
	return `'${value.replaceAll("'", "''")}'`;
}

function openExpression(file: string, line?: number, cd?: string): string {
	const args = [
		vimString(file),
		line === undefined ? "v:null" : String(Math.trunc(line)),
		cd === undefined ? "v:null" : vimString(cd),
	];
	return `luaeval("${OPEN_LUA}", [${args.join(", ")}])`;
}

function queryExpression(mode: string, options: { scope?: string; severity?: string; path?: string }): string {
	const args = [mode, options.scope ?? "", options.severity ?? "", options.path ?? ""].map(vimString);
	return `luaeval("${QUERY_LUA}", [${args.join(", ")}])`;
}

async function remoteExpr(socket: string, expression: string): Promise<string> {
	try {
		const { stdout } = await execFileAsync("nvim", ["--server", socket, "--remote-expr", expression]);
		return stdout;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`nvim did not respond on ${socket}: ${message}`);
	}
}

/** The control socket is kind-owned state inside the generic record; validate it. */
function socketOf(record: ProcessRecord): string {
	const socket = record.runtime.socket;
	if (typeof socket !== "string" || socket.length === 0) {
		throw new Error(`nvim: process ${record.handle} has no control socket`);
	}
	return socket;
}

/** Nearest enclosing project root for a file, falling back to the file's directory. */
export function detectProjectRoot(file: string): string {
	const fileDir = path.dirname(file);
	const { root } = path.parse(fileDir);
	let dir = fileDir;
	for (;;) {
		if (PROJECT_MARKERS.some((marker) => existsSync(path.join(dir, marker)))) return dir;
		const parent = path.dirname(dir);
		if (parent === dir || dir === root) return fileDir;
		dir = parent;
	}
}

function formatDiagnostic(row: NvimDiagnostic): string {
	return `${row.path}:${row.line}:${row.col} ${row.severity} ${row.message}${row.source ? ` (${row.source})` : ""}`;
}

const MAX_ROWS = 200;

let nvimChecked = false;

export function createNvimKind(): ProcessKind {
	return {
		name: "nvim",
		description:
			"A visible neovim editor. Messages: open (change file), context (cursor/selection + diagnostics), diagnostics (query), notes (find NOTE(agent) comments), diffview (open a diff view).",
		relations: ["child", "sibling"],
		configSchema: NvimConfig,
		messageTypes: ["open", "context", "diagnostics", "diffview", "notes"],
		messageSchema: NvimMessage,

		async preflight(): Promise<void> {
			if (nvimChecked) return;
			try {
				await execFileAsync("nvim", ["--version"]);
				nvimChecked = true;
			} catch {
				throw new Error("nvim is not available on PATH");
			}
		},

		spawn(config, cwd, relation): SpawnSpec {
			const file = path.resolve(cwd, String(config.path));
			// A sibling editor is the user's, so it gets no `--listen` and no channel.
			const socket = relation === "child" ? `/tmp/nvim-pane-${randomBytes(6).toString("hex")}.sock` : null;
			const argv = ["nvim"];
			if (socket) argv.push("--listen", socket);
			if (config.line !== undefined) argv.push(`+${Math.trunc(Number(config.line))}`);
			argv.push(file);
			return { argv, runtime: socket ? { socket } : {}, name: `edit: ${path.basename(file)}`, cwd: detectProjectRoot(file) };
		},

		async send(record: ProcessRecord, message: ProcessMessage): Promise<SendResult> {
			const socket = socketOf(record);
			const base = record.cwd || process.cwd();

			if (message.type === "open") {
				const file = path.resolve(base, String(message.path));
				const line = message.line === undefined ? undefined : Number(message.line);
				const cd = message.cwd === undefined ? undefined : path.resolve(base, String(message.cwd));
				await remoteExpr(socket, openExpression(file, line, cd));
				const location = line === undefined ? file : `${file}:${line}`;
				return { text: `nvim ${record.handle}: opened ${location}`, details: { handle: record.handle, opened: file, line, cwd: record.cwd } };
			}

			if (message.type === "context") {
				const raw = await remoteExpr(socket, queryExpression("context", { scope: message.scope as string | undefined }));
				const context = JSON.parse(raw) as NvimContext;
				const diagnostics = context.diagnostics.slice(0, MAX_ROWS);
				const where = context.selection
					? `selection ${context.selection.startLine}:${context.selection.startCol}-${context.selection.endLine}:${context.selection.endCol}`
					: `cursor ${context.cursor.line}:${context.cursor.col}`;
				const lines = [`nvim ${record.handle}: ${context.file} (${where}, mode=${context.mode}), ${context.diagnostics.length} diagnostic(s)`];
				for (const row of diagnostics.slice(0, 10)) lines.push(`  ${formatDiagnostic(row)}`);
				return {
					text: lines.join("\n"),
					details: { handle: record.handle, ...context, diagnostics, truncated: context.diagnostics.length > diagnostics.length },
				};
			}

			if (message.type === "diagnostics") {
				const explicitPath = message.path === undefined ? undefined : path.resolve(base, String(message.path));
				const raw = await remoteExpr(
					socket,
					queryExpression("diagnostics", {
						scope: message.scope as string | undefined,
						severity: message.severity as string | undefined,
						path: explicitPath,
					}),
				);
				const parsed = JSON.parse(raw) as { scope?: string; error?: string; diagnostics?: NvimDiagnostic[] };
				if (parsed.error) return { text: `nvim ${record.handle}: ${parsed.error}`, details: { handle: record.handle, error: parsed.error } };
				const all = parsed.diagnostics ?? [];
				const diagnostics = all.slice(0, MAX_ROWS);
				const noun = all.length === 1 ? "diagnostic" : "diagnostics";
				const header = `nvim ${record.handle}: ${all.length} ${noun} (${parsed.scope ?? "buffer"})`;
				const body = diagnostics.slice(0, 50).map(formatDiagnostic);
				return {
					text: [header, ...body].join("\n"),
					details: { handle: record.handle, scope: parsed.scope, count: all.length, diagnostics, truncated: all.length > diagnostics.length },
				};
			}

			if (message.type === "notes") {
				const paths = Array.isArray(message.paths) ? (message.paths as string[]).map((p) => path.resolve(base, String(p))) : [];
				const raw = await remoteExpr(socket, `luaeval("${NOTES_LUA}", [${paths.map(vimString).join(", ")}])`);
				const parsed = JSON.parse(raw) as {
					scope?: string;
					notes?: Array<{ path: string; line: number; text: string }>;
				};
				const notes = (parsed.notes ?? []).slice(0, MAX_ROWS);
				const header =
					notes.length === 0
						? `nvim ${record.handle}: no NOTE(agent) comments (${parsed.scope ?? "buffers"})`
						: `nvim ${record.handle}: ${notes.length} NOTE(agent) comment(s) (${parsed.scope ?? "buffers"})`;
				return {
					text: [header, ...notes.map((n) => `  ${n.path}:${n.line}: ${n.text.trim()}`)].join("\n"),
					details: { handle: record.handle, scope: parsed.scope, count: notes.length, notes },
				};
			}

			if (message.type === "diffview") {
				const args: string[] = [];
				if (message.rev !== undefined) args.push(String(message.rev));
				const paths = Array.isArray(message.paths) ? (message.paths as string[]).map((p) => path.resolve(base, String(p))) : [];
				if (paths.length > 0) args.push("--", ...paths);
				const raw = await remoteExpr(socket, `luaeval("${DIFFVIEW_LUA}", [${args.map(vimString).join(", ")}])`);
				const result = raw.trim();
				if (result.startsWith("ERROR:")) throw new Error(result.replace(/^ERROR:\s*/, ""));
				const where = message.rev === undefined ? "working-tree changes" : `rev ${message.rev}`;
				return {
					text: `nvim ${record.handle}: opened Diffview (${where})`,
					details: { handle: record.handle, rev: message.rev, paths: message.paths },
				};
			}

			throw new Error(`nvim: unsupported message "${message.type}"`);
		},

		alive(record): boolean {
			const socket = record.runtime.socket;
			return typeof socket === "string" && existsSync(socket);
		},
	};
}
