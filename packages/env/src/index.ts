import type { App } from "@barqel/barq";
import { loadDotEnv } from "./dotenv";
import type { CreateEnvOptions, EnvSchema, InferEnv } from "./types";

export * from "./dotenv";
export * from "./types";
export * from "./validators";

export class EnvError extends Error {
	constructor(public readonly errors: Array<{ key: string; message: string }>) {
		const list = errors.map((e) => `  ✖ ${e.key}: ${e.message}`).join("\n");
		super(`Invalid environment variables:\n${list}`);
		this.name = "EnvError";
	}
}

export const EnvValidationError = EnvError;
export type EnvValidationError = EnvError;

function handleErrors(errors: Array<{ key: string; message: string }>): void {
	const isTest = process.env.NODE_ENV === "test";
	const err = new EnvError(errors);

	if (isTest) {
		throw err;
	}

	const RED = "\x1b[31m";
	const RESET = "\x1b[0m";
	const BOLD = "\x1b[1m";

	console.error(
		`\n${BOLD}${RED}⚡ Barq Environment Validation Failed:${RESET}`,
	);
	for (const e of errors) {
		console.error(`  ${RED}✖ ${BOLD}${e.key}:${RESET} ${e.message}`);
	}
	console.error("");

	process.exitCode = 1;
	throw err;
}

export function createEnv<TSchema extends EnvSchema>(
	schema: TSchema,
	options: CreateEnvOptions = {},
): InferEnv<TSchema> {
	if (options.dotEnv !== false) {
		loadDotEnv({
			cwd: options.cwd,
			files: options.files,
			override: options.override,
		});
	}

	const source = options.source ?? process.env;
	const result: Record<string, unknown> = {};
	const errors: Array<{ key: string; message: string }> = [];

	for (const [key, validator] of Object.entries(schema)) {
		try {
			const raw = source[key];
			result[key] = validator.parse(raw, key);
		} catch (err) {
			errors.push({
				key,
				message: err instanceof Error ? err.message : String(err),
			});
		}
	}

	if (errors.length > 0) {
		if (options.onValidationError) {
			options.onValidationError(errors);
		} else {
			handleErrors(errors);
		}
	}

	return result as InferEnv<TSchema>;
}

export function envPlugin<TSchema extends EnvSchema>(
	schema: TSchema,
	options?: CreateEnvOptions,
) {
	const parsed = createEnv(schema, options);

	return <TState extends object = Record<string, unknown>>(
		app: App<TState>,
	) => {
		(app as any).env = parsed;
		app.use({
			before(ctx) {
				(ctx.state as Record<string, unknown>).env = parsed;
			},
		});
	};
}
