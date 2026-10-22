import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { AutoRegisterKind, AutoRegisterWarning } from "./types";

export const SUPPORTED_EXTENSIONS = new Set([
	".ts",
	".tsx",
	".mts",
	".cts",
	".js",
	".mjs",
	".cjs",
]);

export interface ScanFilesResult {
	files: string[];
	warnings: AutoRegisterWarning[];
}

export interface ScanOptions {
	maxDepth?: number;
	maxFiles?: number;
}

/**
 * Scans a directory recursively up to maxDepth (default 5) and maxFiles (default 1000).
 * Ignores:
 * - Hidden files or dirs (starting with .)
 * - Private files or dirs (starting with _)
 * - node_modules
 * - Type definitions (*.d.ts)
 * - Test and benchmark files (*.test.ts, *.spec.ts, *.bench.ts)
 * - Symbolic links
 *
 * Sorts all found files stably using localeCompare with "en".
 */
export async function scanFiles(
	dir: string,
	kind: AutoRegisterKind,
	options: ScanOptions = {},
): Promise<ScanFilesResult> {
	const maxDepth = options.maxDepth ?? 5;
	const maxFiles = options.maxFiles ?? 1000;
	const files: string[] = [];
	const warnings: AutoRegisterWarning[] = [];

	async function walk(currentDir: string, depth: number): Promise<void> {
		if (depth > maxDepth) {
			return;
		}

		let entries: import("node:fs").Dirent[];
		try {
			entries = await readdir(currentDir, {
				withFileTypes: true,
				encoding: "utf8",
			});
		} catch (err) {
			warnings.push({
				code: "IMPORT_FAILED",
				kind,
				file: currentDir,
				message: `Could not read directory ${currentDir}: ${err instanceof Error ? err.message : String(err)}`,
			});
			return;
		}

		// Sort entries for deterministic directory walking
		entries.sort((a, b) => a.name.localeCompare(b.name, "en"));

		for (const entry of entries) {
			const name = entry.name;

			// Skip hidden, private, or node_modules
			if (
				name.startsWith(".") ||
				name.startsWith("_") ||
				name === "node_modules"
			) {
				continue;
			}

			// Do NOT follow symbolic links
			if (entry.isSymbolicLink()) {
				continue;
			}

			const fullPath = join(currentDir, name);

			if (entry.isDirectory()) {
				await walk(fullPath, depth + 1);
			} else if (entry.isFile()) {
				// Filter test, spec, bench, d.ts
				if (
					name.endsWith(".d.ts") ||
					name.endsWith(".test.ts") ||
					name.endsWith(".test.js") ||
					name.endsWith(".spec.ts") ||
					name.endsWith(".spec.js") ||
					name.endsWith(".bench.ts") ||
					name.endsWith(".bench.js")
				) {
					continue;
				}

				// Check extension
				const dotIndex = name.lastIndexOf(".");
				if (dotIndex === -1) {
					continue;
				}
				const ext = name.slice(dotIndex);
				if (!SUPPORTED_EXTENSIONS.has(ext)) {
					continue;
				}

				if (files.length >= maxFiles) {
					warnings.push({
						code: "MAX_FILES_EXCEEDED",
						kind,
						file: fullPath,
						message: `Maximum file limit (${maxFiles}) reached for kind "${kind}". Remaining files were skipped.`,
					});
					return;
				}

				files.push(fullPath);
			}
		}
	}

	await walk(dir, 1);
	files.sort((a, b) => a.localeCompare(b, "en"));

	return { files, warnings };
}
