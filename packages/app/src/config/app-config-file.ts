// Locates the application declaration file.
//
// The starter layout keeps it at `app/config/app.ts`; the historical root
// `barq.config.*` files stay supported so existing apps (and the `barq`
// CLI's generators) keep working unchanged. The first existing candidate
// wins — so a project that has both is unambiguous.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { PROJECT_ROOT } from "../kernel/paths";

/** Candidate locations, in priority order. */
export const APP_CONFIG_FILES = [
	"app/config/app.ts",
	"barq.config.ts",
	"barq.config.js",
	"barq.config.mjs",
] as const;

/** Absolute path of the app config, or `null` when the app declares none. */
export function findAppConfigFile(): string | null {
	for (const file of APP_CONFIG_FILES) {
		const path = join(PROJECT_ROOT, file);

		if (existsSync(path)) {
			return path;
		}
	}

	return null;
}

/**
 * Config path as written in CLI messages — the existing file when there is
 * one, otherwise the preferred location (`app/config/app.ts`).
 */
export function appConfigFileLabel(): string {
	for (const file of APP_CONFIG_FILES) {
		if (existsSync(join(PROJECT_ROOT, file))) {
			return file;
		}
	}

	return APP_CONFIG_FILES[0];
}
