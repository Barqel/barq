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
import { mergeManualAndAuto } from "./merge";
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
	extractTranslation,
	sanitizeTranslations,
} from "./extractors";
export { importFile } from "./importer";
export { mergeManualAndAuto } from "./merge";
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
		warnings,
	};
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

	const hasAnyAuto =
		jobsAuto || listenersAuto || commandsAuto || translationsAuto;

	const hasRegistryObject =
		jobsObj !== null ||
		listenersObj !== null ||
		commandsObj !== null ||
		translationsObj !== null;

	if (!hasAnyAuto) {
		if (!hasRegistryObject) {
			return config;
		}
		return {
			...config,
			jobs: manualJobs,
			listeners: manualListeners,
			commands: manualCommands,
			translations: manualTranslations as TranslationsRecord,
		};
	}

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

	// Run discovery
	const result = await discover(PROJECT_ROOT, discoveryOptions);

	// Dispatch warnings
	for (const warning of result.warnings) {
		if (discoveryOptions.onWarning) {
			discoveryOptions.onWarning(warning);
		} else {
			console.warn(
				`[barq:autoRegister] (${warning.code}) ${warning.kind}: ${warning.message}`,
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

	return {
		...config,
		jobs: merged.jobs,
		listeners: merged.listeners,
		commands: merged.commands,
		translations: merged.translations,
	};
}
