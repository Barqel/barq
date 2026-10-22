// Console support: `runCli()` (used by the `barq` bin) and the app-config
// loader. Everything is class-based — built-in commands ship with the
// framework, application commands come from the app config
// (`app/config/app.ts`, a root `barq.config.*`, or the package entrypoint).
import { pathToFileURL } from "node:url";
import { createCli } from "@barqel/barq-cli";
import { Mailer, setMailer } from "@barqel/barq-email";
import { findAppConfigFile } from "./config/app-config-file";
import { resolveEmail } from "./config/email";
import { resolveOpenApi } from "./config/openapi";
import { registerCommands } from "./console/command";
import { builtinCommands } from "./console/commands";
import type { BarqConfig } from "./kernel/app";
import { env } from "./kernel/env";
import { setRuntimeInfo } from "./kernel/runtime";

/**
 * Loads the application declaration (Bun imports TypeScript directly).
 * Returns `{}` when the app has no config file — every setting has a default.
 */
export async function loadAppConfig(): Promise<BarqConfig> {
	const path = findAppConfigFile();

	if (path === null) {
		return {};
	}

	const module = await import(pathToFileURL(path).href);
	return (module.default ?? module.config ?? {}) as BarqConfig;
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

	// The CLI runs without the HTTP app, but the mailer belongs to the
	// configuration — register it so the commands can send mails.
	setMailer(new Mailer(resolveEmail(config.email, env)));

	const cli = createCli({
		name,
		version: openapiConfig.version,
		description: "Application console commands",
	});

	const rawCommands = config.commands;
	const resolvedCommands = Array.isArray(rawCommands)
		? rawCommands
		: (rawCommands?.items ?? []);

	registerCommands(cli, [...builtinCommands, ...resolvedCommands]);

	await cli.run();
}
