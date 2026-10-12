import type { App } from "@barqel/barq";
import { i18nMiddleware } from "./middleware";
import type { I18nOptions } from "./types";

export * from "./types";
export * from "./negotiator";
export * from "./translator";
export * from "./middleware";

export function i18nPlugin(options: I18nOptions) {
	const mw = i18nMiddleware(options);
	return <TState extends object = Record<string, unknown>>(
		app: App<TState>,
	) => {
		app.use(mw);
	};
}
