import type { App } from "@barqel/barq";
import { upload } from "./middleware";
import type { UploadOptions } from "./types";

export * from "./types";
export * from "./middleware";

export function uploadPlugin(options: UploadOptions = {}) {
	const mw = upload(options);
	return (app: App<any>) => {
		app.use(mw);
	};
}
