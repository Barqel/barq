import type { Context } from "@barqel/barq";

export interface ProxyOptions {
	target: string;
	changeOrigin?: boolean;
	pathRewrite?: (path: string, ctx: Context) => string | Promise<string>;
	headers?: Record<string, string> | ((ctx: Context) => Record<string, string> | Promise<Record<string, string>>);
	onProxyReq?: (proxyReqInit: RequestInit, ctx: Context) => void | Promise<void>;
	onProxyRes?: (proxyRes: Response, ctx: Context) => Response | Promise<Response>;
}
