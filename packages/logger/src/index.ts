import type { App } from "@barqel/barq";
import { requestLogger } from "./middleware";
import type { LoggerOptions } from "./types";

export * from "./types";
export * from "./format";
export * from "./logger";
export * from "./middleware";

export function loggerPlugin(options: LoggerOptions = {}) {
	const mw = requestLogger(options);
	return <TState extends object = Record<string, unknown>>(
		app: App<TState>,
	) => {
		app.use(mw);
	};
}
