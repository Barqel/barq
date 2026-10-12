import { EnvValidationError } from "./schema";
import type { EnvOptions, EnvSchema, InferEnv } from "./types";

export function createEnv<T extends EnvSchema>(
	schema: T,
	options: EnvOptions = {},
): InferEnv<T> {
	const source = options.source ?? process.env ?? {};
	const result = Object.create(null) as InferEnv<T>;
	const errors: Array<{ key: string; message: string }> = [];

	for (const [key, parser] of Object.entries(schema)) {
		try {
			const rawVal = source[key];
			(result as any)[key] = parser(rawVal, key);
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
		}
		throw new EnvValidationError(errors);
	}

	return Object.freeze(result);
}
