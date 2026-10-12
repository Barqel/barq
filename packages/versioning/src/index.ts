import type { App, Context } from "@barqel/barq";
import { defaultNormalizeVersion, extractVersion } from "./extractor";
import { version } from "./handler";
import type { VersioningOptions } from "./types";

export * from "./types";
export * from "./extractor";
export * from "./handler";

export function versioningPlugin(options: VersioningOptions = {}) {
	const defaultVer = options.defaultVersion
		? (options.normalize ?? defaultNormalizeVersion)(options.defaultVersion)
		: null;

	return (app: App<any>) => {
		app.use({
			async before(ctx: Context) {
				const resolved = await extractVersion(ctx, options);
				const state = ctx.state as Record<string, unknown>;
				state._explicitVersion = resolved;
				state.version = resolved ?? defaultVer ?? undefined;
			},
		});
	};
}
