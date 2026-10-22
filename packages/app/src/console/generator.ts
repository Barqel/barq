// Shared base for the `*:make` scaffolding commands.
//
// A generator renders a stub from this package's `stubs/` directory into a
// module: `job:make send-emails billing` writes to
// `modules/billing/jobs/send-emails.ts`, and the module argument defaults to
// `app`, so `job:make send-emails` writes to
// `modules/app/jobs/send-emails.ts`.
//
// Modules are auto-discovered at boot, so generated jobs, listeners and
// commands need no wiring in the app config.
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CommandContext, CommandFlag } from "@barqel/barq-cli";
import { appConfigFileLabel } from "../config/app-config-file";
import { PROJECT_ROOT } from "../kernel/paths";
import { Command } from "./command";
import {
	ensureFrameworkAlias,
	FRAMEWORK_IMPORT,
	FRAMEWORK_PACKAGE,
	frameworkImportSpecifier,
} from "./framework-import";

// Locates `<package>/stubs` from both runtime shapes of this package:
// - source runs (bin fallback): `src/console/generator.ts` → walk up
// - bundled builds: everything inlined into `dist/index.js` → walk up
//
// Resolved LAZILY — the bundled server never runs generators, so importing
// this module must not depend on the stubs directory being present.
let stubsDir: string | null = null;

function resolveStubsDir(): string {
	if (stubsDir !== null) {
		return stubsDir;
	}

	let dir = dirname(fileURLToPath(import.meta.url));

	for (let depth = 0; depth < 5; depth += 1) {
		const candidate = join(dir, "stubs");

		if (existsSync(candidate)) {
			stubsDir = candidate;
			return candidate;
		}

		const parent = dirname(dir);

		if (parent === dir) {
			break;
		}

		dir = parent;
	}

	throw new Error(
		`Could not locate the \`stubs\` directory of ${FRAMEWORK_PACKAGE}. ` +
			`Reinstall the package (\`bun install ${FRAMEWORK_PACKAGE}\`).`,
	);
}

/** Array key in the app config that receives the generated class. */
export interface RegistryTarget {
	key: "jobs" | "listeners" | "commands";
}

/** Module used when the optional `[module]` argument is omitted. */
export const DEFAULT_MODULE = "app";

/** "app" → "modules/app"; "user" → "modules/user". */
export function moduleRoot(module: string): string {
	return `modules/${module}`;
}

/** "send-emails" → "SendEmails"; "wallet/transfer" → "WalletTransfer". */
export function pascalCase(value: string): string {
	return value
		.split(/[^a-zA-Z0-9]+/)
		.filter(Boolean)
		.map((part) => part[0]!.toUpperCase() + part.slice(1))
		.join("");
}

/** "UserCreated" → "user-created"; "user.created" → "user-created". */
export function kebabCase(value: string): string {
	return value
		.replace(/([a-z0-9])([A-Z])/g, "$1-$2")
		.split(/[^a-zA-Z0-9]+/)
		.filter(Boolean)
		.map((part) => part.toLowerCase())
		.join("-");
}

/** "send-emails" → "sendEmails"; "user.created" → "userCreated". */
export function camelCase(value: string): string {
	return kebabCase(value)
		.split("-")
		.filter(Boolean)
		.map((part, index) =>
			index === 0 ? part : part[0]!.toUpperCase() + part.slice(1),
		)
		.join("");
}

export abstract class GeneratorCommand extends Command {
	override readonly flags = {
		force: {
			type: "boolean",
			alias: "f",
			description: "Overwrite the file if it already exists",
		},
	} satisfies Record<string, CommandFlag>;

	/** Stub file inside this package's `stubs/` directory (e.g. "job.stub"). */
	protected abstract readonly stub: string;

	/** Name of the positional argument that carries the input. */
	protected readonly argumentName: string = "name";

	/** Name of the optional positional argument that carries the module. */
	protected readonly moduleArgument: string = "module";

	/** The `<name>` argument must match this pattern. */
	protected readonly namePattern: RegExp = /^[a-z0-9]+(?:[/-][a-z0-9]+)*$/i;

	/** The `[module]` argument must match this pattern (a single folder). */
	protected readonly modulePattern: RegExp = /^[a-z][a-z0-9-]*$/;

	/** Registry that receives the new class automatically (optional). */
	protected readonly registry: RegistryTarget | null = null;

	/** Class name derived from the argument (e.g. "send-emails" → "SendEmailsJob"). */
	protected abstract className(name: string): string;

	/** Destination file, relative to the project root. */
	protected abstract outputPath(name: string, module: string): string;

	/** Extra stub variables, addressed as `{{key}}`. */
	protected variables(
		_name: string,
		_className: string,
		_module: string,
	): Record<string, string> {
		return {};
	}

	/** Lines printed after a successful generation. */
	protected hints(
		_name: string,
		_className: string,
		_relativePath: string,
		_module: string,
	): string[] {
		return [];
	}

	override async handle(ctx: CommandContext): Promise<void> {
		const rawName = String(ctx.args[this.argumentName] ?? "").trim();

		if (!this.namePattern.test(rawName)) {
			ctx.log.error(
				`Invalid name "${rawName}" — use lowercase words separated by dashes (example: send-emails).`,
			);
			process.exitCode = 1;
			return;
		}

		const moduleName =
			String(ctx.args[this.moduleArgument] ?? "").trim() || DEFAULT_MODULE;

		if (!this.modulePattern.test(moduleName)) {
			ctx.log.error(
				`Invalid module "${moduleName}" — use lowercase letters, digits and dashes (example: billing).`,
			);
			process.exitCode = 1;
			return;
		}

		const className = this.className(rawName);
		const relativePath = this.outputPath(rawName, moduleName);
		const absolutePath = join(PROJECT_ROOT, relativePath);
		const alreadyExists = existsSync(absolutePath);

		if (alreadyExists && ctx.flags.force !== true) {
			ctx.log.error(
				`${relativePath} already exists — use --force to overwrite.`,
			);
			process.exitCode = 1;
			return;
		}

		const stub = await readFile(join(resolveStubsDir(), this.stub), "utf8");
		const content = renderStub(stub, {
			className,
			name: rawName,
			module: moduleName,
			moduleRoot: moduleRoot(moduleName),
			package: frameworkImportSpecifier(),
			configFile: appConfigFileLabel(),
			...this.variables(rawName, className, moduleName),
		});

		this.ensureImportAlias(ctx);

		await mkdir(dirname(absolutePath), { recursive: true });
		await writeFile(absolutePath, content, "utf8");
		ctx.log.success(`${alreadyExists ? "Updated" : "Created"} ${relativePath}`);

		if (this.registry !== null) {
			// Everything is generated under modules/, which the framework
			// auto-discovers at boot — no flat-registry wiring is needed.
			ctx.log.info(
				`Auto-discovered from modules/${moduleName} — no config wiring needed`,
			);
		}

		for (const hint of this.hints(
			rawName,
			className,
			relativePath,
			moduleName,
		)) {
			ctx.log.info(`→ ${hint}`);
		}
	}

	/**
	 * Makes sure the app maps `@barq` to the framework, so the import the
	 * generated file carries resolves at runtime and in the editor.
	 */
	private ensureImportAlias(ctx: CommandContext): void {
		const alias = ensureFrameworkAlias();

		if (alias.changed) {
			ctx.log.info(
				`Mapped "${FRAMEWORK_IMPORT}" to the framework in tsconfig.json`,
			);
			return;
		}

		if (!alias.ok) {
			ctx.log.warn(
				`Could not map "${FRAMEWORK_IMPORT}" in tsconfig.json — ${alias.reason}`,
			);
		}
	}
}

function renderStub(stub: string, variables: Record<string, string>): string {
	return stub.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
		key in variables ? variables[key]! : match,
	);
}

/** Reads a stub from this package and renders its `{{variables}}`. */
export async function renderStubFile(
	stub: string,
	variables: Record<string, string>,
): Promise<string> {
	const template = await readFile(join(resolveStubsDir(), stub), "utf8");

	return renderStub(template, variables);
}
