import type { CommandClass } from "../console/command";
import type { ListenerClass } from "../events/listener";
import type { JobClass } from "../jobs/job";

export type AutoRegisterKind =
	| "jobs"
	| "listeners"
	| "commands"
	| "translations";

export interface RegistryConfig<T> {
	/** Directory path relative to project root (default: app/jobs, app/listeners, etc.) */
	dir?: string;
	/** Enable or disable auto registration for this registry (default: false). */
	autoRegister?: boolean;
	/** Manually registered items for this registry. */
	items?: T[];
}

export type JobsSetting = JobClass[] | RegistryConfig<JobClass>;
export type ListenersSetting = ListenerClass[] | RegistryConfig<ListenerClass>;
export type CommandsSetting = CommandClass[] | RegistryConfig<CommandClass>;
export type TranslationsSetting =
	| Record<string, unknown>
	| (RegistryConfig<never> & { items?: Record<string, unknown> });

export interface AutoRegisterConfig {
	/** Discover and register jobs from `app/jobs` (default: false). */
	jobs?: boolean;
	/** Discover and register listeners from `app/listeners` (default: false). */
	listeners?: boolean;
	/** Discover and register commands from `app/commands` (default: false). */
	commands?: boolean;
	/** Discover and register translations from `app/locales` (default: false). */
	translations?: boolean;
	/** Directory overrides relative to PROJECT_ROOT (default: app/jobs, app/listeners, app/commands, app/locales). */
	directories?: Partial<
		Record<"jobs" | "listeners" | "commands" | "locales", string>
	>;
	/** Maximum recursive scan depth (default: 5). */
	maxDepth?: number;
	/** Strict mode: throw on import or module errors instead of logging warnings (default: false). */
	strict?: boolean;
	/** Optional warning hook. */
	onWarning?: (w: AutoRegisterWarning) => void;
}

export type AutoRegisterWarningCode =
	| "OUTSIDE_ROOT"
	| "IMPORT_FAILED"
	| "INVALID_EXPORT"
	| "MULTIPLE_EXPORTS"
	| "DUPLICATE_LANGUAGE"
	| "DUPLICATE_COMMAND_NAME"
	| "MAX_FILES_EXCEEDED"
	| "INVALID_DIRECTORY";

export interface AutoRegisterWarning {
	code: AutoRegisterWarningCode;
	kind: AutoRegisterKind;
	file?: string;
	message: string;
}

export interface AutoRegisterResult {
	jobs: JobClass[];
	listeners: ListenerClass[];
	commands: CommandClass[];
	translations: Record<string, Record<string, unknown>>;
	warnings: AutoRegisterWarning[];
}
