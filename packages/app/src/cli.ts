// Console support: `runCli()` (used by the `barq` bin) and the app-config
// loader. Everything is class-based — built-in commands ship with the
// framework, application commands come from `barq.config.ts`.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createCli } from "@barqel/barq-cli";
import { resolveOpenApi } from "./config/openapi";
import { registerCommands } from "./console/command";
import { builtinCommands } from "./console/commands";
import type { BarqConfig } from "./kernel/app";
import { env } from "./kernel/env";
import { PROJECT_ROOT } from "./kernel/paths";
import { setRuntimeInfo } from "./kernel/runtime";

const CONFIG_FILES = ["barq.config.ts", "barq.config.js", "barq.config.mjs"];

/**
 * Loads `barq.config.ts` from the application root (Bun imports TypeScript
 * directly). Returns `{}` when the app has no config file — every setting
 * has a default.
 */
export async function loadAppConfig(): Promise<BarqConfig> {
	for (const file of CONFIG_FILES) {
		const path = join(PROJECT_ROOT, file);

		if (!existsSync(path)) {
			continue;
		}

		const module = await import(pathToFileURL(path).href);
		return (module.default ?? {}) as BarqConfig;
	}

	return {};
}

/** Registers built-in + application commands and runs the CLI. */
export async function runCli(config: BarqConfig = {}): Promise<void> {
	const openapiConfig = resolveOpenApi(config.openapi);
	const name = config.name ?? "Barq App";

	setRuntimeInfo({
		name,
		env: env.APP_ENV,
		port: env.APP_PORT,
		docsPath: openapiConfig.docsPath,
		specPath: openapiConfig.specPath,
	});

	const cli = createCli({
		name,
		version: openapiConfig.version,
		description: "Application console commands",
	});

	registerCommands(cli, [...builtinCommands, ...(config.commands ?? [])]);

	await cli.run();
}
