import { basename, extname } from "node:path";
import { Command, type CommandClass } from "../console/command";
import { Listener, type ListenerClass } from "../events/listener";
import { Job, type JobClass } from "../jobs/job";
import type { AutoRegisterWarning, RouteEntry } from "./types";

export interface ExtractItemResult<T> {
	ok: boolean;
	value?: T;
	warning?: AutoRegisterWarning;
}

export interface ExtractTranslationResult {
	ok: boolean;
	locale?: string;
	messages?: Record<string, unknown>;
	warning?: AutoRegisterWarning;
}

function isClass(fn: unknown): fn is new (...args: unknown[]) => unknown {
	return (
		typeof fn === "function" &&
		/^class\s/.test(Function.prototype.toString.call(fn))
	);
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
	return (
		typeof val === "object" &&
		val !== null &&
		!Array.isArray(val) &&
		Object.getPrototypeOf(val) === Object.prototype
	);
}

/**
 * Checks for prototype pollution keys recursively and creates a clean dictionary.
 */
export function sanitizeTranslations(
	obj: Record<string, unknown>,
	filePath: string,
): { clean: Record<string, unknown>; warning?: AutoRegisterWarning } {
	const clean = Object.create(null) as Record<string, unknown>;

	for (const key of Object.keys(obj)) {
		if (key === "__proto__" || key === "constructor" || key === "prototype") {
			return {
				clean,
				warning: {
					code: "INVALID_EXPORT",
					kind: "translations",
					file: filePath,
					message: `Forbidden key "${key}" detected in translations object. Potential prototype pollution rejected.`,
				},
			};
		}

		const val = obj[key];
		if (isPlainObject(val)) {
			const nested = sanitizeTranslations(val, filePath);
			if (nested.warning) {
				return { clean, warning: nested.warning };
			}
			clean[key] = nested.clean;
		} else if (typeof val === "string") {
			clean[key] = val;
		} else {
			return {
				clean,
				warning: {
					code: "INVALID_EXPORT",
					kind: "translations",
					file: filePath,
					message: `Invalid translation value at key "${key}". Expected string or nested object.`,
				},
			};
		}
	}

	return { clean };
}

/**
 * Picks candidates from default export and named exports.
 * Rule: Accept default export OR exactly one valid named export.
 * If multiple valid candidates exist in the same file, warn and skip.
 */
function pickClassCandidate<T>(
	mod: Record<string, unknown>,
	filePath: string,
	kind: "jobs" | "listeners" | "commands",
	predicate: (val: unknown) => val is T,
): ExtractItemResult<T> {
	const candidates: { name: string; value: T }[] = [];

	if (mod.default !== undefined && predicate(mod.default)) {
		candidates.push({ name: "default", value: mod.default });
	}

	for (const [key, val] of Object.entries(mod)) {
		if (key === "default") continue;
		if (predicate(val)) {
			// Avoid adding the same class identity twice if default was an alias to named
			if (!candidates.some((c) => c.value === val)) {
				candidates.push({ name: key, value: val });
			}
		}
	}

	if (candidates.length === 0) {
		return {
			ok: false,
			warning: {
				code: "INVALID_EXPORT",
				kind,
				file: filePath,
				message: `File does not export a valid ${kind.slice(0, -1)} class.`,
			},
		};
	}

	if (candidates.length > 1) {
		return {
			ok: false,
			warning: {
				code: "MULTIPLE_EXPORTS",
				kind,
				file: filePath,
				message: `File exports multiple candidate ${kind} classes (${candidates.map((c) => c.name).join(", ")}). Expected exactly one.`,
			},
		};
	}

	return { ok: true, value: candidates[0]!.value };
}

export function extractJob(
	mod: Record<string, unknown>,
	filePath: string,
): ExtractItemResult<JobClass> {
	const isJobSubclass = (val: unknown): val is JobClass => {
		if (!isClass(val)) return false;
		return val.prototype instanceof Job || val === Job;
	};

	return pickClassCandidate(mod, filePath, "jobs", isJobSubclass);
}

export function extractListener(
	mod: Record<string, unknown>,
	filePath: string,
): ExtractItemResult<ListenerClass> {
	const isListenerSubclass = (val: unknown): val is ListenerClass => {
		if (!isClass(val)) return false;
		return val.prototype instanceof Listener || (val as unknown) === Listener;
	};

	return pickClassCandidate(mod, filePath, "listeners", isListenerSubclass);
}

export function extractCommand(
	mod: Record<string, unknown>,
	filePath: string,
): ExtractItemResult<CommandClass> {
	const isCommandSubclass = (val: unknown): val is CommandClass => {
		if (!isClass(val)) return false;
		return val.prototype instanceof Command || val === Command;
	};

	return pickClassCandidate(mod, filePath, "commands", isCommandSubclass);
}

/**
 * Picks the single route function a module's `routes.ts` exports.
 *
 * A route entry is either the default export or exactly one named function
 * export; ambiguous files are reported instead of guessed.
 */
export function extractRoute(
	mod: Record<string, unknown>,
	filePath: string,
): ExtractItemResult<RouteEntry> {
	const candidates: { name: string; value: RouteEntry }[] = [];

	if (typeof mod.default === "function") {
		candidates.push({ name: "default", value: mod.default as RouteEntry });
	}

	for (const [key, val] of Object.entries(mod)) {
		if (key === "default") continue;
		if (typeof val !== "function") continue;
		if (!candidates.some((candidate) => candidate.value === val)) {
			candidates.push({ name: key, value: val as RouteEntry });
		}
	}

	if (candidates.length === 0) {
		return {
			ok: false,
			warning: {
				code: "INVALID_EXPORT",
				kind: "routes",
				file: filePath,
				message: "File does not export a route function.",
			},
		};
	}

	if (candidates.length > 1) {
		return {
			ok: false,
			warning: {
				code: "MULTIPLE_EXPORTS",
				kind: "routes",
				file: filePath,
				message: `File exports multiple route functions (${candidates
					.map((candidate) => candidate.name)
					.join(", ")}). Expected exactly one.`,
			},
		};
	}

	return { ok: true, value: candidates[0]!.value };
}

export function extractTranslation(
	mod: Record<string, unknown>,
	filePath: string,
): ExtractTranslationResult {
	const ext = extname(filePath);
	const locale = basename(filePath, ext);

	const val = mod.default ?? mod;

	if (!isPlainObject(val)) {
		return {
			ok: false,
			warning: {
				code: "INVALID_EXPORT",
				kind: "translations",
				file: filePath,
				message: `Translation file must export a plain object. Received ${typeof val}.`,
			},
		};
	}

	const { clean, warning } = sanitizeTranslations(val, filePath);
	if (warning) {
		return { ok: false, warning };
	}

	return {
		ok: true,
		locale,
		messages: clean,
	};
}
