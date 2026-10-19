import type { App } from "@barqel/barq";
import { rateLimit } from "./middleware";
import type { RateLimitOptions } from "./types";

export * from "./middleware";
export * from "./store";
export * from "./types";

export function rateLimiter(options: RateLimitOptions = {}) {
	const mw = rateLimit(options);
	return (app: App<any>) => {
		app.use(mw);
	};
}
