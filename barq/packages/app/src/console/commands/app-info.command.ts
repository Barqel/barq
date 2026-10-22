import type { CommandContext } from "@barqel/barq-cli";
import { runtimeInfo } from "../../kernel/runtime";
import { Command } from "../command";

export class AppInfoCommand extends Command {
	readonly signature = "app:info";

	override readonly description = "Show application info and endpoint URLs";

	async handle(ctx: CommandContext): Promise<void> {
		const info = runtimeInfo();
		const base = `http://localhost:${info.port}`;

		ctx.log.table([
			{ key: "name", value: info.name },
			{ key: "env", value: info.env },
			{ key: "base", value: base },
			{ key: "health", value: `${base}/health` },
			{ key: "docs", value: `${base}${info.docsPath}` },
			{ key: "spec", value: `${base}${info.specPath}` },
		]);
		ctx.log.success("Done");
	}
}
