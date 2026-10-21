// Shared base for the `*:make` scaffolding commands.
//
// A generator renders a stub from this package's `stubs/` directory into
// the application, and — when a registry key is configured — wires the new
// class into the app config (`app/config/app.ts`, or a root
// `barq.config.*`) automatically, so after `bun run cli job:make
// send-emails` you only write the job logic.
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CommandContext, CommandFlag } from "@barqel/barq-cli";
import {
	appConfigFileLabel,
	findAppConfigFile,
} from "../config/app-config-file";
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

/** "app/jobs/send-emails.ts" → "@/jobs/send-emails". */
function toImportSpecifier(relativePath: string): string {
	const withoutExtension = relativePath.replace(/\.ts$/, "");
	const appRelative = withoutExtension.startsWith("app/")
		? withoutExtension.slice("app/".length)
		: withoutExtension;

	return `@/${appRelative}`;
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

	/** The `<name>` argument must match this pattern. */
	protected readonly namePattern: RegExp = /^[a-z0-9]+(?:[/-][a-z0-9]+)*$/i;

	/** Registry that receives the new class automatically (optional). */
	protected readonly registry: RegistryTarget | null = null;

	/** Class name derived from the argument (e.g. "send-emails" → "SendEmailsJob"). */
	protected abstract className(name: string): string;

	/** Destination file, relative to the project root. */
	protected abstract outputPath(name: string): string;

	/** Extra stub variables, addressed as `{{key}}`. */
	protected variables(
		_name: string,
		_className: string,
	): Record<string, string> {
		return {};
	}

	/** Lines printed after a successful generation. */
	protected hints(
		_name: string,
		_className: string,
		_relativePath: string,
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

		const className = this.className(rawName);
		const relativePath = this.outputPath(rawName);
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
			package: frameworkImportSpecifier(),
			configFile: appConfigFileLabel(),
			...this.variables(rawName, className),
		});

		this.ensureImportAlias(ctx);

		await mkdir(dirname(absolutePath), { recursive: true });
		await writeFile(absolutePath, content, "utf8");
		ctx.log.success(`${alreadyExists ? "Updated" : "Created"} ${relativePath}`);

		if (this.registry !== null) {
			const configLabel = appConfigFileLabel();
			const registered = await this.addToRegistry(
				className,
				toImportSpecifier(relativePath),
			);

			if (registered) {
				ctx.log.info(
					`Registered ${className} in ${configLabel} (${this.registry.key})`,
				);
			} else {
				ctx.log.warn(
					`Add ${className} to the \`${this.registry.key}\` array in ${configLabel} manually`,
				);
			}
		}

		for (const hint of this.hints(rawName, className, relativePath)) {
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

	/** Appends the import + array entry to the app config. Fail-safe. */
	private async addToRegistry(
		className: string,
		importSpecifier: string,
	): Promise<boolean> {
		const registry = this.registry;

		if (registry === null) {
			return false;
		}

		const configPath = findAppConfigFile();

		if (configPath === null) {
			return false;
		}

		let source = await readFile(configPath, "utf8");

		if (source.includes(className)) {
			return true;
		}

		const lines = source.split("\n");

		// Insert the import keeping the block alphabetized by specifier.
		let firstImport = -1;
		let insertAfter = -1;

		for (let index = 0; index < lines.length; index += 1) {
			const line = lines[index]!.trim();
			const match = /^import\b.*\bfrom\s+"([^"]+)"/.exec(line);

			if (match === null) {
				continue;
			}

			firstImport = firstImport === -1 ? index : firstImport;

			if (match[1]! < importSpecifier) {
				insertAfter = index;
			}
		}

		if (firstImport === -1) {
			return false;
		}

		const importLine = `import { ${className} } from "${importSpecifier}";`;

		if (insertAfter === -1) {
			lines.splice(firstImport, 0, importLine);
		} else {
			lines.splice(insertAfter + 1, 0, importLine);
		}

		source = lines.join("\n");

		// Array entry inside `key: [ ... ]`.
		const arrayPattern = new RegExp(
			`(\\n[ \\t]*${registry.key}\\s*:\\s*\\[)([^\\]]*)(\\])`,
		);

		if (!arrayPattern.test(source)) {
			return false;
		}

		source = source.replace(
			arrayPattern,
			(_match, head: string, body: string, tail: string) => {
				const items = body.replace(/\s+$/, "").replace(/,+$/, "");

				// Preserve the multi-line style when the registry uses it.
				if (body.includes("\n")) {
					return `${head}${items},\n\t\t${className},\n\t${tail}`;
				}

				return `${head}${items.length > 0 ? `${items}, ` : ""}${className}${tail}`;
			},
		);

		await writeFile(configPath, source, "utf8");

		return true;
	}
}

function renderStub(stub: string, variables: Record<string, string>): string {
	return stub.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
		key in variables ? variables[key]! : match,
	);
}
