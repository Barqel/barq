import type { App } from "@barqel/barq";
import { idempotency } from "./middleware";
import type { IdempotencyOptions } from "./types";

export * from "./types";
export * from "./store";
export * from "./middleware";

export function idempotencyPlugin(options: IdempotencyOptions = {}) {
	const mw = idempotency(options);
	return (app: App<any>) => {
		app.use(mw);
	};
}
