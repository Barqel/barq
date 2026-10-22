// Static-files defaults: serve `public/` under `/public`, cached hard in
// production. Override through `defineConfig({ static })` or disable with
// `static: { enabled: false }`.

export interface AppStaticConfig {
	/** Disable serving `public/` entirely (default: enabled). */
	enabled?: boolean;
	/** URL prefix (default: "/public"). */
	prefix?: string;
	/** Cache-Control max-age in seconds (default: 1 year in production, 0 in dev). */
	maxAge?: number;
	/** Add `immutable` to Cache-Control (default: production only). */
	immutable?: boolean;
}

export interface ResolvedStaticConfig {
	enabled: boolean;
	prefix: string;
	maxAge: number;
	immutable: boolean;
}

export function resolveStatic(
	config: AppStaticConfig = {},
	production: boolean,
): ResolvedStaticConfig {
	return {
		enabled: config.enabled ?? true,
		prefix: config.prefix ?? "/public",
		maxAge: config.maxAge ?? (production ? 31_536_000 : 0),
		immutable: config.immutable ?? production,
	};
}
