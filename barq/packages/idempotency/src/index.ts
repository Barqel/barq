import type { App } from "@barqel/barq";
import { idempotency } from "./middleware";
import type { IdempotencyOptions } from "./types";

export * from "./middleware";
export * from "./store";
export * from "./types";

export function idempotencyPlugin(options: IdempotencyOptions = {}) {
	const mw = idempotency(options);
	return (app: App<any>) => {
		app.use(mw);
	};
}
