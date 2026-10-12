import type { Context } from "@barqel/barq";

export interface StaticOptions {
	root: string;
	prefix?: string;
	index?: string | false;
	spa?: boolean | string;
	maxAge?: number;
	immutable?: boolean;
	etag?: boolean;
	dotfiles?: "allow" | "deny" | "ignore";
	setHeaders?: (res: Response, path: string, stat: { size: number; mtimeMs: number }) => void;
}

export type StaticHandler = (ctx: Context<Record<string, string>>) => Promise<Response>;
