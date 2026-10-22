import { randomBytes } from "node:crypto";
import type { CommandContext } from "@barqel/barq-cli";
import { Command } from "../command";

/** Prints a fresh `APP_KEY` — 32 random bytes, base64 (Laravel's format). */
export class KeyGenerateCommand extends Command {
	readonly signature = "key:generate";

	override readonly description =
		"Generate a new APP_KEY (base64, 32 bytes) for the encryption service";

	handle(ctx: CommandContext): void {
		const key = randomBytes(32).toString("base64");

		ctx.log.success(`APP_KEY="base64:${key}"`);
		ctx.log.info(
			"Put it in your .env file — keep the old key in APP_PREVIOUS_KEYS to decrypt what is already stored.",
		);
	}
}
