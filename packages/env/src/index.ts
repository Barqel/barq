import type { App, Context } from "@barqel/barq";
import { createEnv } from "./validator";
import type { EnvOptions, EnvSchema, InferEnv } from "./types";

export * from "./types";
export * from "./schema";
export * from "./validator";

export function envPlugin<T extends EnvSchema>(schema: T, options?: EnvOptions) {
	const validatedEnv = createEnv(schema, options);

	return (app: App<any>) => {
		(app as any).env = validatedEnv;

		app.use({
			before(ctx: Context) {
				(ctx.state as any).env = validatedEnv;
			},
		});
	};
}
