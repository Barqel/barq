import type { App } from "@barqel/barq";
import { rateLimit } from "./middleware";
import type { RateLimitOptions } from "./types";

export * from "./types";
export * from "./store";
export * from "./middleware";

export function rateLimiter(options: RateLimitOptions = {}) {
	const mw = rateLimit(options);
	return <TState extends object = Record<string, unknown>>(
		app: App<TState>,
	) => {
		app.use(mw);
	};
}
