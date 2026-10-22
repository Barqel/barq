import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CommandContext, CommandFlag } from "@barqel/barq-cli";
import { PROJECT_ROOT } from "../../kernel/paths";
import { Command } from "../command";
import { renderStubFile } from "../generator";

/** Placeholder committed in `.env.example`; `env:make` writes a real key to `.env`. */
const EXAMPLE_APP_KEY = "base64:REPLACE_ME_WITH_THE_GENERATED_KEY=";

export class MakeEnvCommand extends Command {
	readonly signature = "env:make";

	override readonly description =
		"Create .env and .env.example with the framework variables";

	override readonly flags = {
		force: {
			type: "boolean",
			alias: "f",
			description: "Overwrite the files if they already exist",
		},
	} satisfies Record<string, CommandFlag>;

	async handle(ctx: CommandContext): Promise<void> {
		const force = ctx.flags.force === true;
		const appKey = `base64:${randomBytes(32).toString("base64")}`;

		const targets = [
			{ file: ".env", appKey },
			{ file: ".env.example", appKey: EXAMPLE_APP_KEY },
		];

		let written = 0;
		let skipped = 0;
		let wroteEnv = false;

		for (const target of targets) {
			const path = join(PROJECT_ROOT, target.file);
			const existed = existsSync(path);

			if (existed && !force) {
				ctx.log.warn(
					`Skipped ${target.file} — already exists (use --force to overwrite)`,
				);
				skipped += 1;
				continue;
			}

			const content = await renderStubFile("env.stub", {
				appKey: target.appKey,
			});

			await writeFile(path, content, "utf8");
			ctx.log.success(`${existed ? "Updated" : "Created"} ${target.file}`);
			written += 1;
			wroteEnv ||= target.file === ".env";
		}

		if (written === 0 && skipped > 0) {
			ctx.log.error(
				"Both .env and .env.example already exist — use --force to overwrite.",
			);
			process.exitCode = 1;
			return;
		}

		if (wroteEnv) {
			ctx.log.info("→ A fresh APP_KEY was generated in .env");
		}

		ctx.log.info("→ Keep .env out of version control");
	}
}
