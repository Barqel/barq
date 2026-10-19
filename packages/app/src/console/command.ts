// Base class for console commands — subclass it and write `handle()` only:
//
//   export class HelloCommand extends Command {
//     readonly signature = "hello <name>";
//     override readonly description = "Say hello";
//
//     async handle(ctx: CommandContext): Promise<void> {
//       ctx.log.success(`Hello, ${ctx.args.name}!`);
//     }
//   }
//
// Register the class in `barq.config.ts` (`commands: [...]`), then run it
// through the `barq` CLI: `bun run cli hello World`. Signatures support
// positionals (`job:make <name>` or `[name]` for optional) and flags via
// the `flags` property. Commands may inject services — add `@injectable()`
// when they do (resolution happens through the same DI container as the app).

import type { Cli, CommandContext, CommandFlag } from "@barqel/barq-cli";
import { container, type InjectionToken } from "tsyringe";

export abstract class Command {
	/** Command name, optionally followed by positional args (e.g. "job:make <name>"). */
	abstract readonly signature: string;

	/** One-line help text shown in `--help`. */
	readonly description: string = "";

	/** Flags accepted by the command, parsed as `--flag` / `--no-flag` / `-a`. */
	readonly flags: Record<string, CommandFlag> = {};

	/** Command logic. */
	abstract handle(ctx: CommandContext): void | Promise<void>;
}

export type CommandClass = new (...args: never[]) => Command;

/** Registers every `Command` class on the CLI. */
export function registerCommands(
	cli: Cli,
	commandClasses: CommandClass[],
): void {
	for (const CommandClass of commandClasses) {
		const command = container.resolve(
			CommandClass as unknown as InjectionToken<Command>,
		);

		cli.command(
			command.signature,
			{ description: command.description, flags: command.flags },
			(ctx) => command.handle(ctx),
		);
	}
}
