import type { Context, Handler, HandlerResult } from "@barqel/barq";

export type VersioningType = "header" | "query" | "media-type" | "custom";

export interface VersioningOptions {
	type?: VersioningType | VersioningType[];
	header?: string;
	query?: string;
	mediaTypePrefix?: string;
	defaultVersion?: string;
	normalize?: (version: string) => string;
	extractor?: (ctx: Context) => string | null | Promise<string | null>;
	onInvalidVersion?: (
		ctx: Context,
		requested: string,
		available: string[],
	) => Response | HandlerResult | Promise<Response | HandlerResult>;
}

export type VersionMap<
	TParams extends object = Record<string, string>,
	TState extends object = Record<string, unknown>,
> = Record<string, Handler<TParams, TState>>;
