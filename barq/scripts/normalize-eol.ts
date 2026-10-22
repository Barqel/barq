// Normalizes the line endings of the working tree to LF.
//
// The repository is formatted with LF (Biome enforces it), but a Windows
// checkout with `core.autocrlf=true` turns every file into CRLF — and the
// formatter then refuses the file. `.gitattributes` keeps the checkout
// honest; this script fixes a tree that was checked out before it.
//
//   bun scripts/normalize-eol.ts
//
// Git stores LF either way, so the change is invisible to the repository.
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = "E:/Lab/barq/barq";
const SKIP = new Set([
	".git",
	"node_modules",
	"dist",
	"out",
	".next",
	"coverage",
	"doc",
	"compares",
]);

// The files that carry text.
const TEXT = new Set([
	".ts",
	".tsx",
	".js",
	".jsx",
	".mjs",
	".cjs",
	".json",
	".jsonc",
	".md",
	".mdx",
	".txt",
	".yml",
	".yaml",
	".toml",
	".css",
	".html",
	".sh",
	".env",
	".example",
]);

let changed = 0;

function walk(dir: string): void {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (SKIP.has(entry.name)) continue;

		const full = join(dir, entry.name);

		if (entry.isDirectory()) {
			walk(full);
			continue;
		}

		const extension = entry.name.includes(".")
			? entry.name.slice(entry.name.lastIndexOf("."))
			: "";

		if (!TEXT.has(extension) && !entry.name.startsWith(".env")) continue;
		if (statSync(full).size > 2_000_000) continue;

		const content = readFileSync(full, "utf8");

		if (!content.includes("\r\n")) continue;

		writeFileSync(full, content.replace(/\r\n/g, "\n"));
		changed++;
		console.log(`  ${relative(root, full)}`);
	}
}

console.log("Normalizing the line endings to LF…");
walk(root);
console.log(`\n${changed} file(s) normalized`);
