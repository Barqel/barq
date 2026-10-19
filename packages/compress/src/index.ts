import type { App } from "@barqel/barq";
import { compress } from "./middleware";
import type { CompressOptions } from "./types";

export * from "./encoding";
export * from "./engine";
export * from "./filter";
export * from "./middleware";
export * from "./types";

export function compressPlugin(options: CompressOptions = {}) {
	const mw = compress(options);
	return (app: App<any>) => {
		app.use(mw);
	};
}
