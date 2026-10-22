// Base environment: every knob the framework itself reads, validated once
// at import time (fails fast with a clear per-variable error).
//
// Applications may validate their OWN variables with `createEnv` + `envRules`
// re-exported from this package — keep them in a separate file and import it
// where needed.
import { createEnv, env as rules } from "@barqel/barq-env";

export const ENV = {
	DEVELOPMENT: "development",
	PRODUCTION: "production",
} as const;

export type AppEnvName = (typeof ENV)[keyof typeof ENV];

export const env = createEnv({
	APP_ENV: rules.enum([ENV.DEVELOPMENT, ENV.PRODUCTION] as const, {
		default: ENV.DEVELOPMENT,
	}),

	APP_HOST: rules.string({ default: "0.0.0.0" }),

	APP_PORT: rules.port({ default: 3000 }),

	// Comma-separated list of allowed origins, or "*" to allow all.
	// Example: "https://example.com,https://admin.example.com"
	APP_CORS_ORIGIN: rules.string({ default: "*" }),

	LOG_LEVEL: rules.enum(["debug", "info", "warn", "error", "silent"] as const, {
		default: "info",
	}),

	RATE_LIMIT_WINDOW_MS: rules.number({ default: 60_000 }),

	RATE_LIMIT_MAX: rules.number({ default: 100 }),

	RATE_LIMIT_STRICT_MAX: rules.number({ default: 20 }),

	IDEMPOTENCY_TTL_MS: rules.number({ default: 86_400_000 }),

	IDEMPOTENCY_ENFORCE_HEADER: rules.boolean({ default: true }),

	// --- Mail (the email plugin) --------------------------------------------
	// The transport is picked automatically: a host means real SMTP
	// delivery, no host means the messages are logged, not sent.
	MAIL_TRANSPORT: rules.enum(
		["auto", "smtp", "log", "json", "stream", "sendmail"] as const,
		{ default: "auto" },
	),

	MAIL_HOST: rules.string({ default: "" }),

	MAIL_PORT: rules.port({ default: 587 }),

	MAIL_SECURE: rules.boolean({ default: false }),

	MAIL_USER: rules.string({ default: "" }),

	MAIL_PASSWORD: rules.string({ default: "" }),

	MAIL_FROM: rules.string({ default: "barq@example.com" }),

	MAIL_FROM_NAME: rules.string({ default: "Barq" }),

	MAIL_REPLY_TO: rules.string({ default: "" }),

	MAIL_SUBJECT_PREFIX: rules.string({ default: "" }),

	MAIL_RETRIES: rules.number({ default: 2 }),

	MAIL_RETRY_DELAY: rules.number({ default: 500 }),

	MAIL_POOL: rules.boolean({ default: false }),

	MAIL_TIMEOUT: rules.number({ default: 10_000 }),
});

export type AppEnv = typeof env;

/** `true` when `APP_ENV=production`. */
export function isProduction(): boolean {
	return env.APP_ENV === ENV.PRODUCTION;
}
