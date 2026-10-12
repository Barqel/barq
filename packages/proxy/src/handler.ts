import { type Context, HttpError } from "@barqel/barq";
import type { ProxyOptions } from "./types";

const HOP_BY_HOP_HEADERS = new Set([
	"connection",
	"keep-alive",
	"proxy-authenticate",
	"proxy-authorization",
	"te",
	"trailer",
	"transfer-encoding",
	"upgrade",
]);

export function createProxy(options: ProxyOptions) {
	const targetUrl = new URL(options.target);

	return async (ctx: Context): Promise<Response> => {
		try {
			const originalPath = ctx.pathname;
			const rewrittenPath = options.pathRewrite
				? await options.pathRewrite(originalPath, ctx)
				: originalPath;

			const url = new URL(rewrittenPath, targetUrl);
			
			const query = ctx.query.toString();
			if (query) {
				url.search = query;
			}

			const headers = new Headers();
			ctx.req.headers.forEach((value, key) => {
				if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
					headers.set(key, value);
				}
			});

			if (options.changeOrigin) {
				headers.set("host", targetUrl.host);
			}

			if (options.headers) {
				const customHeaders =
					typeof options.headers === "function" ? await options.headers(ctx) : options.headers;
				for (const [k, v] of Object.entries(customHeaders)) {
					headers.set(k, v);
				}
			}

			const reqInit: RequestInit & { duplex?: "half" } = {
				method: ctx.req.method,
				headers,
				redirect: "manual",
			};

			if (ctx.req.method !== "GET" && ctx.req.method !== "HEAD") {
				reqInit.body = ctx.req.body;
				reqInit.duplex = "half";
			}

			if (options.onProxyReq) {
				await options.onProxyReq(reqInit, ctx);
			}

			const proxyRes = await fetch(url.toString(), reqInit);

			const resHeaders = new Headers();
			proxyRes.headers.forEach((value, key) => {
				if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
					resHeaders.set(key, value);
				}
			});

			let response = new Response(proxyRes.body, {
				status: proxyRes.status,
				statusText: proxyRes.statusText,
				headers: resHeaders,
			});

			if (options.onProxyRes) {
				response = await options.onProxyRes(response, ctx);
			}

			return response;
		} catch (err) {
			throw new HttpError(502, { error: "Bad Gateway", details: err instanceof Error ? err.message : String(err) });
		}
	};
}
