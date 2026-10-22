import { existsSync } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, normalize, relative, resolve } from "node:path";
import type { AutoRegisterKind, AutoRegisterWarning } from "./types";

export interface ResolveDirectoryResult {
	ok: boolean;
	path?: string;
	warning?: AutoRegisterWarning;
}

/**
 * Validates that an absolute or relative directory lies safely strictly inside
 * the canonical PROJECT_ROOT. Rejects directory traversal (..), absolute paths escaping root,
 * and symbolic links that resolve outside the project root.
 */
export async function resolveDirectory(
	root: string,
	dirOrRelative: string,
	kind: AutoRegisterKind,
): Promise<ResolveDirectoryResult> {
	// Root canonical path
	let canonicalRoot: string;
	try {
		canonicalRoot = await realpath(root);
	} catch {
		canonicalRoot = resolve(root);
	}

	const normalizedInput = normalize(dirOrRelative);
	const targetPath = isAbsolute(normalizedInput)
		? resolve(normalizedInput)
		: resolve(canonicalRoot, normalizedInput);

	// Check path traversal via relative check
	const rel = relative(canonicalRoot, targetPath);
	if (rel.startsWith("..") || isAbsolute(rel)) {
		return {
			ok: false,
			warning: {
				code: "OUTSIDE_ROOT",
				kind,
				file: dirOrRelative,
				message: `Directory path "${dirOrRelative}" resolves outside project root`,
			},
		};
	}

	if (!existsSync(targetPath)) {
		return {
			ok: false,
			// Directory not existing is not a fatal security error, simply nothing to discover
		};
	}

	// Verify target and each ancestor are not symlinks pointing outside the project root
	try {
		const stat = await lstat(targetPath);
		if (stat.isSymbolicLink()) {
			return {
				ok: false,
				warning: {
					code: "OUTSIDE_ROOT",
					kind,
					file: dirOrRelative,
					message: `Directory "${dirOrRelative}" is a symbolic link, which is not permitted for auto-register`,
				},
			};
		}

		const realTarget = await realpath(targetPath);
		const realRel = relative(canonicalRoot, realTarget);
		if (realRel.startsWith("..") || isAbsolute(realRel)) {
			return {
				ok: false,
				warning: {
					code: "OUTSIDE_ROOT",
					kind,
					file: dirOrRelative,
					message: `Realpath of "${dirOrRelative}" escapes project root`,
				},
			};
		}

		return {
			ok: true,
			path: realTarget,
		};
	} catch (err) {
		return {
			ok: false,
			warning: {
				code: "INVALID_DIRECTORY",
				kind,
				file: dirOrRelative,
				message: `Failed to resolve directory "${dirOrRelative}": ${err instanceof Error ? err.message : String(err)}`,
			},
		};
	}
}
