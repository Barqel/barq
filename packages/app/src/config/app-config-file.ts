// Locates the application declaration file.
//
// The starter layout keeps it at `app/config/app.ts`; the historical root
// `barq.config.*` files stay supported so existing apps (and the `barq`
// CLI's generators) keep working unchanged. When neither exists, the
// package entrypoint (`module` / `main` in package.json) is used, so an app
// can declare its config in `index.ts` without a `barq.config.ts` shim. The
// entrypoint must guard side effects with `import.meta.main`. The first
// existing candidate wins — so a project that has several is unambiguous.
import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { PROJECT_ROOT } from "../kernel/paths";

/** Candidate locations, in priority order. */
export const APP_CONFIG_FILES = [
	"app/config/app.ts",
	"barq.config.ts",
	"barq.config.js",
	"barq.config.mjs",
] as const;

/** Resolves the package entrypoint (`module` or `main`) when it exists. */
function findPackageEntry(): string | null {
	const manifest = join(PROJECT_ROOT, "package.json");

	if (!existsSync(manifest)) {
		return null;
	}

	try {
		const pkg = JSON.parse(readFileSync(manifest, "utf8")) as {
			module?: unknown;
			main?: unknown;
		};
		const entry =
			typeof pkg.module === "string"
				? pkg.module
				: typeof pkg.main === "string"
					? pkg.main
					: null;

		if (entry === null) {
			return null;
		}

		const path = resolve(PROJECT_ROOT, entry);
		return existsSync(path) ? path : null;
	} catch {
		return null;
	}
}

/** Absolute path of the app config, or `null` when the app declares none. */
export function findAppConfigFile(): string | null {
	for (const file of APP_CONFIG_FILES) {
		const path = join(PROJECT_ROOT, file);

		if (existsSync(path)) {
			return path;
		}
	}

	return findPackageEntry();
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

	const entry = findPackageEntry();

	if (entry !== null) {
		return relative(PROJECT_ROOT, entry).replace(/\\/g, "/");
	}

	return APP_CONFIG_FILES[0];
}
