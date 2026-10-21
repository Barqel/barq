import type { CommandContext, CommandFlag } from "@barqel/barq-cli";
import { discover } from "../../auto-register";
import {
	appConfigFileLabel,
	findAppConfigFile,
} from "../../config/app-config-file";
import { PROJECT_ROOT } from "../../kernel/paths";
import { Command } from "../command";

export class AutoRegisterCommand extends Command {
	readonly signature = "auto:register";

	override readonly description =
		"Discover and inspect automatically registered application components";

	override readonly flags = {
		strict: {
			type: "boolean",
			description:
				"Fail with exit code 1 if any discovery warning or error occurs",
		},
	} satisfies Record<string, CommandFlag>;

	async handle(ctx: CommandContext): Promise<void> {
		const strict = ctx.flags.strict === true;
		const configPath = findAppConfigFile();
		const configLabel = appConfigFileLabel();

		ctx.log.info(`Discovering application components under ${PROJECT_ROOT}...`);

		const result = await discover(PROJECT_ROOT, {
			jobs: true,
			listeners: true,
			commands: true,
			translations: true,
			strict,
		});

		ctx.log.table([
			{ key: "Jobs discovered", value: String(result.jobs.length) },
			{ key: "Listeners discovered", value: String(result.listeners.length) },
			{ key: "Commands discovered", value: String(result.commands.length) },
			{
				key: "Locales discovered",
				value: Object.keys(result.translations).join(", ") || "none",
			},
			{ key: "Config file", value: configPath ? configLabel : "Not found" },
		]);

		if (result.warnings.length > 0) {
			for (const w of result.warnings) {
				ctx.log.warn(
					`[${w.code}] ${w.kind}${w.file ? ` (${w.file})` : ""}: ${w.message}`,
				);
			}
			if (strict) {
				ctx.log.error(
					`Discovery encountered ${result.warnings.length} warning(s) in strict mode.`,
				);
				process.exitCode = 1;
				return;
			}
		}

		ctx.log.success(
			`Auto-register discovery complete: ${result.jobs.length} jobs, ${result.listeners.length} listeners, ${result.commands.length} commands, ${Object.keys(result.translations).length} locales.`,
		);
	}
}
