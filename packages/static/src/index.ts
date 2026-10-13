import type { App } from "@barqel/barq";
import { createStaticHandler } from "./handler";
import type { StaticHandler, StaticOptions } from "./types";

export * from "./types";
export * from "./mime";
export * from "./security";
export { createStaticHandler } from "./handler";

export function serveStatic(options: StaticOptions): StaticHandler {
	return createStaticHandler(options);
}

export function staticFiles(options: StaticOptions) {
	const handler = createStaticHandler(options);
	const prefix = options.prefix ?? "";
	const normalizedPrefix = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;

	return (app: App<any>) => {
		if (normalizedPrefix) {
			app.get(`${normalizedPrefix}/*path`, handler);
			app.head(`${normalizedPrefix}/*path`, handler);
			app.get(normalizedPrefix, handler);
			app.head(normalizedPrefix, handler);
		} else {
			app.get("/*path", handler);
			app.head("/*path", handler);
			app.get("/", handler);
			app.head("/", handler);
		}
	};
}
