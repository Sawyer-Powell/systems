// Resolve pi's packages for plain-node tests (no node_modules in this dir).
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";

const piBin = realpathSync(execFileSync("which", ["pi"], { encoding: "utf8" }).trim());
const pkg = path.join(path.dirname(piBin), "..", "libexec", "lib", "node_modules", "@earendil-works", "pi-coding-agent");
const map = {
	"@earendil-works/pi-coding-agent": path.join(pkg, "dist", "index.js"),
	"@earendil-works/pi-tui": path.join(pkg, "node_modules", "@earendil-works", "pi-tui", "dist", "index.js"),
	typebox: path.join(pkg, "node_modules", "typebox", "build", "index.mjs"),
};

export async function resolve(specifier, context, next) {
	if (map[specifier]) return { url: pathToFileURL(map[specifier]).href, shortCircuit: true };
	return next(specifier, context);
}
