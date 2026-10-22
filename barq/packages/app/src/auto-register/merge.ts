import type { TranslationsRecord } from "@barqel/barq-i18n";
import type { CommandClass } from "../console/command";
import type { ListenerClass } from "../events/listener";
import type { JobClass } from "../jobs/job";
import type { AutoRegisterResult, AutoRegisterWarning } from "./types";

function isPlainObject(val: unknown): val is Record<string, unknown> {
	return (
		typeof val === "object" &&
		val !== null &&
		!Array.isArray(val) &&
		Object.getPrototypeOf(val) === Object.prototype
	);
}

/**
 * Deep merge where manual (base) wins over discovered (auto).
 * Safe against prototype pollution.
 */
export function deepMergeManualWins(
	manualObj: Record<string, unknown>,
	autoObj: Record<string, unknown>,
): Record<string, unknown> {
	const result = Object.create(null) as Record<string, unknown>;

	// Start with auto keys
	for (const [key, autoVal] of Object.entries(autoObj)) {
		if (key === "__proto__" || key === "constructor" || key === "prototype") {
			continue;
		}
		result[key] = autoVal;
	}

	// Overwrite or deep merge with manual (manual always wins)
	for (const [key, manualVal] of Object.entries(manualObj)) {
		if (key === "__proto__" || key === "constructor" || key === "prototype") {
			continue;
		}
		const autoVal = result[key];
		if (isPlainObject(manualVal) && isPlainObject(autoVal)) {
			result[key] = deepMergeManualWins(manualVal, autoVal);
		} else {
			result[key] = manualVal;
		}
	}

	return result;
}

/**
 * Merges manual and discovered items adhering strictly to:
 * 1. Manual wins always (items kept in original order).
 * 2. Deduplication by reference (===).
 * 3. Discovered items added after manual items in deterministic alphabetical discovery order.
 * 4. Commands name collisions checked: if a discovered command has the same signature name as an existing one, warn and skip it.
 */
export function mergeManualAndAuto(
	manual: {
		jobs?: JobClass[];
		listeners?: ListenerClass[];
		commands?: CommandClass[];
		translations?: TranslationsRecord;
	},
	discovered: AutoRegisterResult,
): {
	jobs: JobClass[];
	listeners: ListenerClass[];
	commands: CommandClass[];
	translations: TranslationsRecord;
	warnings: AutoRegisterWarning[];
} {
	const warnings: AutoRegisterWarning[] = [...discovered.warnings];

	// --- 1. Jobs ---
	const jobs: JobClass[] = [...(manual.jobs ?? [])];
	const jobSet = new Set<JobClass>(jobs);

	for (const autoJob of discovered.jobs) {
		if (!jobSet.has(autoJob)) {
			jobSet.add(autoJob);
			jobs.push(autoJob);
		}
	}

	// --- 2. Listeners ---
	const listeners: ListenerClass[] = [...(manual.listeners ?? [])];
	const listenerSet = new Set<ListenerClass>(listeners);

	for (const autoListener of discovered.listeners) {
		if (!listenerSet.has(autoListener)) {
			listenerSet.add(autoListener);
			listeners.push(autoListener);
		}
	}

	// --- 3. Commands ---
	const commands: CommandClass[] = [...(manual.commands ?? [])];
	const commandSet = new Set<CommandClass>(commands);
	const commandNames = new Set<string>();

	const getCommandName = (cmdClass: CommandClass): string | null => {
		try {
			// Try reading signature from prototype or an instance
			const proto = cmdClass.prototype as { signature?: string };
			if (typeof proto?.signature === "string") {
				return proto.signature.trim().split(/\s+/)[0] ?? null;
			}
			const inst = new cmdClass();
			if (typeof inst?.signature === "string") {
				return inst.signature.trim().split(/\s+/)[0] ?? null;
			}
		} catch {
			// In case instantiation fails because of constructor arguments
		}
		return null;
	};

	for (const cmd of commands) {
		const name = getCommandName(cmd);
		if (name) {
			commandNames.add(name);
		}
	}

	for (const autoCmd of discovered.commands) {
		if (commandSet.has(autoCmd)) {
			continue;
		}

		const name = getCommandName(autoCmd);
		if (name && commandNames.has(name)) {
			warnings.push({
				code: "DUPLICATE_COMMAND_NAME",
				kind: "commands",
				message: `Command with name "${name}" is already registered. Skipping auto-registered duplicate command.`,
			});
			continue;
		}

		if (name) {
			commandNames.add(name);
		}
		commandSet.add(autoCmd);
		commands.push(autoCmd);
	}

	// --- 4. Translations ---
	const manualTranslations = (manual.translations ?? {}) as Record<
		string,
		Record<string, unknown>
	>;
	const autoTranslations = discovered.translations;
	const translations: TranslationsRecord = {};

	const allLocales = new Set([
		...Object.keys(autoTranslations),
		...Object.keys(manualTranslations),
	]);

	for (const locale of allLocales) {
		const manualLocaleObj = manualTranslations[locale];
		const autoLocaleObj = autoTranslations[locale];

		if (manualLocaleObj && autoLocaleObj) {
			translations[locale] = deepMergeManualWins(
				manualLocaleObj,
				autoLocaleObj,
			) as import("@barqel/barq-i18n").TranslationDictionary;
		} else if (manualLocaleObj) {
			translations[locale] =
				manualLocaleObj as import("@barqel/barq-i18n").TranslationDictionary;
		} else if (autoLocaleObj) {
			translations[locale] =
				autoLocaleObj as import("@barqel/barq-i18n").TranslationDictionary;
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
