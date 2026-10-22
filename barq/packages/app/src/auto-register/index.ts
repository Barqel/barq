import type { App } from "@barqel/barq";
import type { TranslationsRecord } from "@barqel/barq-i18n";
import type { CommandClass } from "../console/command";
import type { ListenerClass } from "../events/listener";
import type { JobClass } from "../jobs/job";
import type { BarqConfig } from "../kernel/app";
import { PROJECT_ROOT } from "../kernel/paths";
import {
	extractCommand,
	extractJob,
	extractListener,
	extractTranslation,
} from "./extractors";
import { importFile } from "./importer";
import { deepMergeManualWins, mergeManualAndAuto } from "./merge";
import { discoverModules } from "./modules";
import { resolveDirectory } from "./resolver";
import { scanFiles } from "./scanner";
import type {
	AutoRegisterConfig,
	AutoRegisterResult,
	AutoRegisterWarning,
} from "./types";

export {
	extractCommand,
	extractJob,
	extractListener,
	extractRoute,
	extractTranslation,
	sanitizeTranslations,
} from "./extractors";
export { importFile } from "./importer";
export { mergeManualAndAuto } from "./merge";
export type { DiscoverModulesOptions } from "./modules";
export { discoverModules } from "./modules";
export { resolveDirectory } from "./resolver";
export { scanFiles } from "./scanner";
export * from "./types";

export interface DiscoverOptions extends AutoRegisterConfig {
	root?: string;
}

/**
 * Discovers jobs, listeners, commands, and translations from the given root directory.
 */
export async function discover(
	root: string = PROJECT_ROOT,
	options: DiscoverOptions = {},
): Promise<AutoRegisterResult> {
	const warnings: AutoRegisterWarning[] = [];
	const jobs: JobClass[] = [];
	const listeners: ListenerClass[] = [];
	const commands: CommandClass[] = [];
	const translations: Record<string, Record<string, unknown>> = {};
	const discoveredLocales = new Map<string, string>(); // locale -> file

	const dirs = options.directories ?? {};
	const maxDepth = options.maxDepth ?? 5;
	const strict = options.strict ?? false;

	// 1. Discover Jobs
	if (options.jobs) {
		const jobDir = dirs.jobs ?? "app/jobs";
		const res = await resolveDirectory(root, jobDir, "jobs");
		if (res.warning) warnings.push(res.warning);
		if (res.ok && res.path) {
			const { files, warnings: scanWarnings } = await scanFiles(
				res.path,
				"jobs",
				{
					maxDepth,
				},
			);
			warnings.push(...scanWarnings);
			for (const file of files) {
				const imp = await importFile(file, "jobs", strict);
				if (imp.warning) warnings.push(imp.warning);
				if (imp.ok && imp.module) {
					const ext = extractJob(imp.module, file);
					if (ext.warning) warnings.push(ext.warning);
					if (ext.ok && ext.value) {
						jobs.push(ext.value);
					}
				}
			}
		}
	}

	// 2. Discover Listeners
	if (options.listeners) {
		const listenerDir = dirs.listeners ?? "app/listeners";
		const res = await resolveDirectory(root, listenerDir, "listeners");
		if (res.warning) warnings.push(res.warning);
		if (res.ok && res.path) {
			const { files, warnings: scanWarnings } = await scanFiles(
				res.path,
				"listeners",
				{ maxDepth },
			);
			warnings.push(...scanWarnings);
			for (const file of files) {
				const imp = await importFile(file, "listeners", strict);
				if (imp.warning) warnings.push(imp.warning);
				if (imp.ok && imp.module) {
					const ext = extractListener(imp.module, file);
					if (ext.warning) warnings.push(ext.warning);
					if (ext.ok && ext.value) {
						listeners.push(ext.value);
					}
				}
			}
		}
	}

	// 3. Discover Commands
	if (options.commands) {
		const commandDir = dirs.commands ?? "app/commands";
		const res = await resolveDirectory(root, commandDir, "commands");
		if (res.warning) warnings.push(res.warning);
		if (res.ok && res.path) {
			const { files, warnings: scanWarnings } = await scanFiles(
				res.path,
				"commands",
				{ maxDepth },
			);
			warnings.push(...scanWarnings);
			for (const file of files) {
				const imp = await importFile(file, "commands", strict);
				if (imp.warning) warnings.push(imp.warning);
				if (imp.ok && imp.module) {
					const ext = extractCommand(imp.module, file);
					if (ext.warning) warnings.push(ext.warning);
					if (ext.ok && ext.value) {
						commands.push(ext.value);
					}
				}
			}
		}
	}

	// 4. Discover Translations
	if (options.translations) {
		const localesDir = dirs.locales ?? "app/locales";
		const res = await resolveDirectory(root, localesDir, "translations");
		if (res.warning) warnings.push(res.warning);
		if (res.ok && res.path) {
			const { files, warnings: scanWarnings } = await scanFiles(
				res.path,
				"translations",
				{ maxDepth },
			);
			warnings.push(...scanWarnings);
			for (const file of files) {
				const imp = await importFile(file, "translations", strict);
				if (imp.warning) warnings.push(imp.warning);
				if (imp.ok && imp.module) {
					const ext = extractTranslation(imp.module, file);
					if (ext.warning) warnings.push(ext.warning);
					if (ext.ok && ext.locale && ext.messages) {
						const existingFile = discoveredLocales.get(ext.locale);
						if (existingFile) {
							warnings.push({
								code: "DUPLICATE_LANGUAGE",
								kind: "translations",
								file,
								message: `Duplicate language "${ext.locale}" discovered in ${file} (already discovered in ${existingFile}). Skipped second.`,
							});
						} else {
							discoveredLocales.set(ext.locale, file);
							translations[ext.locale] = ext.messages;
						}
					}
				}
			}
		}
	}

	return {
		jobs,
		listeners,
		commands,
		translations,
		routes: [],
		warnings,
	};
}

/** Deep-merges two locale records; `override` wins on key collisions. */
function mergeTranslationRecords(
	base: Record<string, Record<string, unknown>>,
	override: Record<string, Record<string, unknown>>,
): Record<string, Record<string, unknown>> {
	const merged: Record<string, Record<string, unknown>> = {};

	for (const locale of new Set([
		...Object.keys(base),
		...Object.keys(override),
	])) {
		const baseLocale = base[locale];
		const overrideLocale = override[locale];

		if (baseLocale && overrideLocale) {
			merged[locale] = deepMergeManualWins(overrideLocale, baseLocale);
		} else if (overrideLocale) {
			merged[locale] = overrideLocale;
		} else if (baseLocale) {
			merged[locale] = baseLocale;
		}
	}

	return merged;
}

/**
 * Defines application config asynchronously with top-level await support.
 * Automatically discovers jobs, listeners, commands, and translations.
 * Supports global `autoRegister: {...}` OR per-registry object config:
 * ```ts
 * jobs: {
 *   dir: "jobs",
 *   autoRegister: true,
 *   items: [SystemReportJob]
 * }
 * ```
 */
export async function defineConfigAsync<T extends BarqConfig>(
	config: T,
): Promise<T> {
	// Extract per-registry config or array
	const rawJobs = config.jobs;
	const jobsObj =
		!Array.isArray(rawJobs) && typeof rawJobs === "object" ? rawJobs : null;
	const manualJobs = Array.isArray(rawJobs) ? rawJobs : (jobsObj?.items ?? []);

	const rawListeners = config.listeners;
	const listenersObj =
		!Array.isArray(rawListeners) && typeof rawListeners === "object"
			? rawListeners
			: null;
	const manualListeners = Array.isArray(rawListeners)
		? rawListeners
		: (listenersObj?.items ?? []);

	const rawCommands = config.commands;
	const commandsObj =
		!Array.isArray(rawCommands) && typeof rawCommands === "object"
			? rawCommands
			: null;
	const manualCommands = Array.isArray(rawCommands)
		? rawCommands
		: (commandsObj?.items ?? []);

	const rawTranslations = config.translations;
	const translationsObj =
		rawTranslations &&
		typeof rawTranslations === "object" &&
		"autoRegister" in rawTranslations
			? (rawTranslations as {
					autoRegister?: boolean;
					dir?: string;
					items?: Record<string, unknown>;
				})
			: null;
	const manualTranslations = translationsObj
		? (translationsObj.items ?? {})
		: ((rawTranslations as Record<string, unknown>) ?? {});

	const globalAutoRegister = config.autoRegister ?? {};

	const jobsAuto = jobsObj?.autoRegister ?? globalAutoRegister.jobs ?? false;
	const listenersAuto =
		listenersObj?.autoRegister ?? globalAutoRegister.listeners ?? false;
	const commandsAuto =
		commandsObj?.autoRegister ?? globalAutoRegister.commands ?? false;
	const translationsAuto =
		translationsObj?.autoRegister ?? globalAutoRegister.translations ?? false;
	const modulesAuto = globalAutoRegister.modules ?? true;

	const hasRegistryObject =
		jobsObj !== null ||
		listenersObj !== null ||
		commandsObj !== null ||
		translationsObj !== null;

	const discoveryOptions: AutoRegisterConfig = {
		...globalAutoRegister,
		jobs: jobsAuto,
		listeners: listenersAuto,
		commands: commandsAuto,
		translations: translationsAuto,
		directories: {
			...globalAutoRegister.directories,
			...(jobsObj?.dir ? { jobs: jobsObj.dir } : {}),
			...(listenersObj?.dir ? { listeners: listenersObj.dir } : {}),
			...(commandsObj?.dir ? { commands: commandsObj.dir } : {}),
			...(translationsObj?.dir ? { locales: translationsObj.dir } : {}),
		},
	};

	const emptyResult: AutoRegisterResult = {
		jobs: [],
		listeners: [],
		commands: [],
		translations: {},
		routes: [],
		warnings: [],
	};

	// Module discovery is on by default: `modules/<name>/` owns its
	// registries. Flat `app/jobs`-style discovery stays opt-in.
	const moduleResult = modulesAuto
		? await discoverModules(PROJECT_ROOT, discoveryOptions)
		: emptyResult;

	const hasFlatAuto =
		jobsAuto || listenersAuto || commandsAuto || translationsAuto;
	const flatResult = hasFlatAuto
		? await discover(PROJECT_ROOT, discoveryOptions)
		: emptyResult;

	const result: AutoRegisterResult = {
		jobs: [...moduleResult.jobs, ...flatResult.jobs],
		listeners: [...moduleResult.listeners, ...flatResult.listeners],
		commands: [...moduleResult.commands, ...flatResult.commands],
		translations: mergeTranslationRecords(
			moduleResult.translations,
			flatResult.translations,
		),
		routes: moduleResult.routes ?? [],
		warnings: [...moduleResult.warnings, ...flatResult.warnings],
	};

	const hasDiscovered =
		result.jobs.length > 0 ||
		result.listeners.length > 0 ||
		result.commands.length > 0 ||
		(result.routes?.length ?? 0) > 0 ||
		Object.keys(result.translations).length > 0;

	if (!hasDiscovered && !hasRegistryObject) {
		return config;
	}

	// Dispatch warnings
	for (const warning of result.warnings) {
		if (discoveryOptions.onWarning) {
			discoveryOptions.onWarning(warning);
		} else {
			console.warn(
				`[barq:auto-register] (${warning.code}) ${warning.kind}: ${warning.message}`,
			);
		}
	}

	// Merge manual and auto
	const merged = mergeManualAndAuto(
		{
			jobs: manualJobs,
			listeners: manualListeners,
			commands: manualCommands,
			translations: manualTranslations as TranslationsRecord,
		},
		result,
	);

	const discoveredRoutes = result.routes ?? [];
	const routes: BarqConfig["routes"] =
		discoveredRoutes.length === 0
			? config.routes
			: (app: App) => {
					for (const route of discoveredRoutes) {
						route(app);
					}
					config.routes?.(app);
				};

	return {
		...config,
		routes,
		jobs: merged.jobs,
		listeners: merged.listeners,
		commands: merged.commands,
		translations: merged.translations,
	};
}
