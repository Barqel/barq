import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import type { CommandContext, CommandFlag } from "@barqel/barq-cli";
import { PROJECT_ROOT } from "../../kernel/paths";
import { Command } from "../command";
import {
	ensureFrameworkAlias,
	frameworkImportSpecifier,
} from "../framework-import";
import { camelCase, renderStubFile } from "../generator";

export class MakeModuleCommand extends Command {
	readonly signature = "module:make <name>";

	override readonly description =
		"Create a module in modules/<name> with an auto-loaded routes/routes.ts";

	override readonly flags = {
		force: {
			type: "boolean",
			alias: "f",
			description: "Overwrite the route file if it already exists",
		},
	} satisfies Record<string, CommandFlag>;

	async handle(ctx: CommandContext): Promise<void> {
		const name = String(ctx.args.name ?? "").trim();
		const force = ctx.flags.force === true;

		if (!/^[a-z][a-z0-9-]*$/.test(name)) {
			ctx.log.error(
				`Invalid module name "${name}" — use lowercase letters, digits and dashes (example: billing).`,
			);
			process.exitCode = 1;
			return;
		}

		const moduleDir = join(PROJECT_ROOT, "modules", name);

		if (existsSync(moduleDir) && !force) {
			ctx.log.error(
				`modules/${name} already exists — use --force to overwrite the route file.`,
			);
			process.exitCode = 1;
			return;
		}

		const target = join(moduleDir, "routes", "routes.ts");
		const alias = ensureFrameworkAlias();

		if (alias.changed) {
			ctx.log.info('Mapped "@barq" to the framework in tsconfig.json');
		} else if (!alias.ok) {
			ctx.log.warn(`Could not map "@barq" in tsconfig.json — ${alias.reason}`);
		}

		const existed = existsSync(target);
		const content = await renderStubFile("module-routes.stub", {
			name,
			camelName: camelCase(name),
			package: frameworkImportSpecifier(),
		});

		await mkdir(dirname(target), { recursive: true });
		await writeFile(target, content, "utf8");

		const display = relative(PROJECT_ROOT, target).replace(/\\/g, "/");

		ctx.log.success(`${existed ? "Updated" : "Created"} ${display}`);
		ctx.log.info("→ Auto-loaded at boot — no registry wiring needed");
		ctx.log.info(`→ Add endpoints in modules/${name}/routes/routes.ts`);
	}
}
