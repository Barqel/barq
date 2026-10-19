import type { App } from "@barqel/barq";
import { i18nMiddleware } from "./middleware";
import type { I18nOptions } from "./types";

export * from "./middleware";
export * from "./negotiator";
export * from "./translator";
export * from "./types";

export function i18nPlugin(options: I18nOptions) {
	const mw = i18nMiddleware(options);
	return (app: App<any>) => {
		app.use(mw);
	};
}
