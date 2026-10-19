import type { CommandContext } from "@barqel/barq-cli";
import { env } from "../../kernel/env";
import { Command } from "../command";

export class EnvCheckCommand extends Command {
	readonly signature = "env:check";

	override readonly description =
		"Validate environment variables and show public config";

	async handle(ctx: CommandContext): Promise<void> {
		// The env is already validated at import time (the kernel fails fast
		// with a clear per-variable error), so reaching this action proves
		// validity. Safe for CI/Docker: no secrets in this output — keep it
		// that way if new vars are added.
		ctx.log.table([
			{ key: "APP_ENV", value: env.APP_ENV },
			{ key: "APP_HOST", value: env.APP_HOST },
			{ key: "APP_PORT", value: String(env.APP_PORT) },
			{ key: "APP_CORS_ORIGIN", value: env.APP_CORS_ORIGIN },
			{ key: "LOG_LEVEL", value: env.LOG_LEVEL },
			{ key: "RATE_LIMIT_WINDOW_MS", value: String(env.RATE_LIMIT_WINDOW_MS) },
			{ key: "RATE_LIMIT_MAX", value: String(env.RATE_LIMIT_MAX) },
			{
				key: "RATE_LIMIT_STRICT_MAX",
				value: String(env.RATE_LIMIT_STRICT_MAX),
			},
			{ key: "IDEMPOTENCY_TTL_MS", value: String(env.IDEMPOTENCY_TTL_MS) },
			{
				key: "IDEMPOTENCY_ENFORCE_HEADER",
				value: String(env.IDEMPOTENCY_ENFORCE_HEADER),
			},
		]);
		ctx.log.success("Environment is valid");
	}
}
