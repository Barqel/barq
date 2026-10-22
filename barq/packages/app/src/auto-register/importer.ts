import { pathToFileURL } from "node:url";
import type { AutoRegisterKind, AutoRegisterWarning } from "./types";

export interface ImportFileResult {
	ok: boolean;
	module?: Record<string, unknown>;
	warning?: AutoRegisterWarning;
}

/**
 * Dynamically imports a TypeScript/JavaScript file using an absolute file:// URL.
 * Catches any syntax or module evaluation errors, isolating them so the rest of the discovery proceeds.
 */
export async function importFile(
	filePath: string,
	kind: AutoRegisterKind,
	strict = false,
): Promise<ImportFileResult> {
	try {
		const fileUrl = pathToFileURL(filePath).href;
		const mod = (await import(fileUrl)) as Record<string, unknown>;
		return { ok: true, module: mod };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (strict) {
			throw new Error(
				`[autoRegister] Failed to import ${filePath}: ${message}`,
			);
		}
		return {
			ok: false,
			warning: {
				code: "IMPORT_FAILED",
				kind,
				file: filePath,
				message: `Failed to import module: ${message}`,
			},
		};
	}
}
