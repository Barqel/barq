import { type Context, type Handler, type HandlerResult, HttpError } from "@barqel/barq";
import { defaultNormalizeVersion, extractVersion } from "./extractor";
import type { VersionMap, VersioningOptions } from "./types";

export function version<
	TParams extends object = Record<string, string>,
	TState extends object = Record<string, unknown>,
>(
	handlers: VersionMap<TParams, TState>,
	options: VersioningOptions = {},
): Handler<TParams, TState> {
	const normalize = options.normalize ?? defaultNormalizeVersion;
	const normalizedMap = new Map<string, Handler<TParams, TState>>();
	const rawKeys = Object.keys(handlers);

	for (const key of rawKeys) {
		normalizedMap.set(normalize(key), handlers[key]!);
	}

	const defaultVer = options.defaultVersion ? normalize(options.defaultVersion) : null;

	return async (ctx: Context<TParams, TState>): Promise<HandlerResult> => {
		const state = ctx.state as Record<string, unknown>;
		const isFromPlugin = state._explicitVersion !== undefined;
		const requestedVersion = isFromPlugin
			? (state._explicitVersion as string | null)
			: await extractVersion(ctx as unknown as Context, options);

		if (requestedVersion) {
			if (normalizedMap.has(requestedVersion)) {
				state.version = requestedVersion;
				return normalizedMap.get(requestedVersion)!(ctx);
			}

			if (options.onInvalidVersion) {
				return options.onInvalidVersion(ctx as unknown as Context, requestedVersion, rawKeys);
			}

			throw new HttpError(400, {
				error: "Bad Request",
				message: `Unsupported API version: '${requestedVersion}'. Supported versions: ${rawKeys.join(", ")}`,
				supportedVersions: rawKeys,
			});
		}

		const fallback = defaultVer ?? (state.version as string | undefined);
		if (fallback && normalizedMap.has(fallback)) {
			state.version = fallback;
			return normalizedMap.get(fallback)!(ctx);
		}

		if (options.onInvalidVersion) {
			return options.onInvalidVersion(ctx as unknown as Context, "none", rawKeys);
		}

		throw new HttpError(400, {
			error: "Bad Request",
			message: `Missing API version. Supported versions: ${rawKeys.join(", ")}`,
			supportedVersions: rawKeys,
		});
	};
}
