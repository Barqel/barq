import type { App } from "@barqel/barq";
import { cache } from "./middleware";
import type { CacheOptions } from "./types";

export * from "./types";
export * from "./store";
export * from "./etag";
export * from "./middleware";

export function cachePlugin(options: CacheOptions = {}) {
	const mw = cache(options);
	return <TState extends object = Record<string, unknown>>(
		app: App<TState>,
	) => {
		app.use(mw);
	};
}
