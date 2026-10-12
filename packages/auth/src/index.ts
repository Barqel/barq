import type { App } from "@barqel/barq";
import { bearerAuth } from "./middleware";
import type { AuthPluginOptions } from "./types";

export * from "./types";
export * from "./jwt";
export * from "./password";
export * from "./middleware";

export function auth(options: AuthPluginOptions = {}) {
	return <TState extends object = Record<string, unknown>>(
		app: App<TState>,
	) => {
		if (options.secret) {
			(app as any).auth = {
				bearer: (overrideSecret?: string) =>
					bearerAuth({
						secret: overrideSecret ?? options.secret!,
						cookieName: options.cookieName,
					}),
			};
		}
	};
}
