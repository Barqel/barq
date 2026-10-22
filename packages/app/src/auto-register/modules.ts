// Module discovery.
//
// Barq apps can group domain code into `modules/<name>/`. Every module owns
// its registries using a fixed layout:
//
//   modules/<name>/routes.ts | routes/routes.ts   one route function
//   modules/<name>/jobs/                          Job subclasses
//   modules/<name>/listeners/                     Listener subclasses
//   modules/<name>/commands/                      Command subclasses
//   modules/<name>/locales/<locale>.ts            translation dictionaries
//
// `discoverModules()` walks that layout once and returns one aggregated
// registry set: translations from every module are deep-merged per locale
// (instead of being dropped as duplicates), and route entries are composed in
// deterministic module order.
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { PROJECT_ROOT } from "../kernel/paths";
import {
	extractCommand,
	extractJob,
	extractListener,
	extractRoute,
	extractTranslation,
} from "./extractors";
import { importFile } from "./importer";
import { resolveDirectory } from "./resolver";
import { scanFiles } from "./scanner";
import type {
	AutoRegisterConfig,
	AutoRegisterKind,
	AutoRegisterResult,
	AutoRegisterWarning,
	RouteEntry,
} from "./types";

type ClassKind = Extract<AutoRegisterKind, "jobs" | "listeners" | "commands">;

type Extractor<T> = (
	module: Record<string, unknown>,
	file: string,
) => { value?: T; warning?: AutoRegisterWarning };

export interface DiscoverModulesOptions extends AutoRegisterConfig {
	root?: string;
}

/** Resolves a path to "file" / "dir" without throwing when it is missing. */
async function pathKind(path: string): Promise<"file" | "dir" | null> {
	try {
		const info = await stat(path);

		if (info.isDirectory()) return "dir";
		if (info.isFile()) return "file";
		return null;
	} catch {
		return null;
	}
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		Object.getPrototypeOf(value) === Object.prototype
	);
}

function mergeMessages(
	target: Record<string, unknown>,
	source: Record<string, unknown>,
): void {
	for (const [key, value] of Object.entries(source)) {
		const existing = target[key];

		if (isPlainObject(existing) && isPlainObject(value)) {
			mergeMessages(existing, value);
		} else {
			target[key] = value;
		}
	}
}

/** Returns the mutable dictionary for a locale, creating it on first use. */
function localeMessages(
	store: Record<string, Record<string, unknown>>,
	locale: string,
): Record<string, unknown> {
	let target = store[locale];

	if (!target) {
		target = Object.create(null) as Record<string, unknown>;
		store[locale] = target;
	}

	return target;
}

/** Loads the single route function a module exposes, if any. */
async function discoverRoute(
	moduleDir: string,
	warnings: AutoRegisterWarning[],
	strict: boolean,
): Promise<RouteEntry | null> {
	const candidates = [
		join(moduleDir, "routes.ts"),
		join(moduleDir, "routes", "routes.ts"),
	];

	let file: string | null = null;
	for (const candidate of candidates) {
		if ((await pathKind(candidate)) === "file") {
			file = candidate;
			break;
		}
	}

	// No route entry is a valid module shape (jobs-only, shared, ...).
	if (!file) return null;

	const imported = await importFile(file, "routes", strict);
	if (imported.warning) warnings.push(imported.warning);
	if (!imported.ok || !imported.module) return null;

	const extracted = extractRoute(imported.module, file);
	if (extracted.warning) warnings.push(extracted.warning);

	return extracted.value ?? null;
}

/** Loads Job / Listener / Command classes from one module folder. */
async function discoverClasses<T>(
	moduleDir: string,
	kind: ClassKind,
	extract: Extractor<T>,
	warnings: AutoRegisterWarning[],
	maxDepth: number,
	strict: boolean,
): Promise<T[]> {
	const dir = join(moduleDir, kind);
	if ((await pathKind(dir)) !== "dir") return [];

	const scanned = await scanFiles(dir, kind, { maxDepth });
	warnings.push(...scanned.warnings);

	const items: T[] = [];
	for (const file of scanned.files) {
		const imported = await importFile(file, kind, strict);
		if (imported.warning) warnings.push(imported.warning);
		if (!imported.ok || !imported.module) continue;

		const extracted = extract(imported.module, file);
		if (extracted.warning) warnings.push(extracted.warning);
		if (extracted.value) items.push(extracted.value);
	}

	return items;
}

/** Loads and deep-merges the locale dictionaries of one module. */
async function discoverLocales(
	moduleDir: string,
	warnings: AutoRegisterWarning[],
	maxDepth: number,
	strict: boolean,
): Promise<Record<string, Record<string, unknown>>> {
	const dir = join(moduleDir, "locales");
	if ((await pathKind(dir)) !== "dir") return {};

	const scanned = await scanFiles(dir, "translations", { maxDepth });
	warnings.push(...scanned.warnings);

	const locales: Record<string, Record<string, unknown>> = {};
	for (const file of scanned.files) {
		const imported = await importFile(file, "translations", strict);
		if (imported.warning) warnings.push(imported.warning);
		if (!imported.ok || !imported.module) continue;

		const extracted = extractTranslation(imported.module, file);
		if (extracted.warning) warnings.push(extracted.warning);
		if (!extracted.ok || !extracted.locale || !extracted.messages) continue;

		mergeMessages(
			localeMessages(locales, extracted.locale),
			extracted.messages,
		);
	}

	return locales;
}

/**
 * Discovers every module under `modules/` (configurable through
 * `directories.modules`) and aggregates its registries.
 */
export async function discoverModules(
	root: string = PROJECT_ROOT,
	options: DiscoverModulesOptions = {},
): Promise<AutoRegisterResult> {
	const warnings: AutoRegisterWarning[] = [];
	const jobs: AutoRegisterResult["jobs"] = [];
	const listeners: AutoRegisterResult["listeners"] = [];
	const commands: AutoRegisterResult["commands"] = [];
	const routes: RouteEntry[] = [];
	const translations: Record<string, Record<string, unknown>> = {};

	const maxDepth = options.maxDepth ?? 5;
	const strict = options.strict ?? false;
	const modulesDir = options.directories?.modules ?? "modules";

	const resolved = await resolveDirectory(root, modulesDir, "modules");
	if (resolved.warning) warnings.push(resolved.warning);

	if (resolved.ok && resolved.path) {
		const modulesPath = resolved.path;
		let entries: import("node:fs").Dirent[] = [];

		try {
			entries = await readdir(modulesPath, {
				withFileTypes: true,
				encoding: "utf8",
			});
		} catch (err) {
			warnings.push({
				code: "IMPORT_FAILED",
				kind: "modules",
				file: modulesPath,
				message: `Could not read modules directory: ${err instanceof Error ? err.message : String(err)}`,
			});
		}

		const moduleDirs = entries
			.filter(
				(entry) =>
					entry.isDirectory() &&
					!entry.name.startsWith(".") &&
					!entry.name.startsWith("_") &&
					entry.name !== "node_modules",
			)
			.map((entry) => entry.name)
			.sort((a, b) => a.localeCompare(b, "en"))
			.map((name) => join(modulesPath, name));

		for (const moduleDir of moduleDirs) {
			const route = await discoverRoute(moduleDir, warnings, strict);
			if (route) routes.push(route);

			jobs.push(
				...(await discoverClasses(
					moduleDir,
					"jobs",
					extractJob,
					warnings,
					maxDepth,
					strict,
				)),
			);
			listeners.push(
				...(await discoverClasses(
					moduleDir,
					"listeners",
					extractListener,
					warnings,
					maxDepth,
					strict,
				)),
			);
			commands.push(
				...(await discoverClasses(
					moduleDir,
					"commands",
					extractCommand,
					warnings,
					maxDepth,
					strict,
				)),
			);

			for (const [locale, messages] of Object.entries(
				await discoverLocales(moduleDir, warnings, maxDepth, strict),
			)) {
				mergeMessages(localeMessages(translations, locale), messages);
			}
		}
	}

	return { jobs, listeners, commands, translations, routes, warnings };
}
