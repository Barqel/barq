import type { Context } from "./context";
import type { Middleware } from "./types";

export interface CorsOptions {
	origin?: string | string[] | ((origin: string) => boolean | string);
	methods?: string[];
	allowedHeaders?: string[];
	exposedHeaders?: string[];
	credentials?: boolean;
	maxAge?: number;
}

export function cors(options: CorsOptions = {}): Middleware {
	const methods = (
		options.methods ?? ["GET", "HEAD", "PUT", "POST", "DELETE", "PATCH"]
	).join(", ");
	const allowedHeaders = options.allowedHeaders?.join(", ");
	const exposedHeaders = options.exposedHeaders?.join(", ");
	const maxAge = options.maxAge !== undefined ? String(options.maxAge) : null;
	const credentials = options.credentials === true;

	function resolveOrigin(reqOrigin: string | null): string | null {
		if (!options.origin || options.origin === "*") {
			return credentials ? (reqOrigin ?? "*") : "*";
		}
		if (!reqOrigin) return null;
		if (typeof options.origin === "string") {
			return options.origin === reqOrigin ? reqOrigin : null;
		}
		if (Array.isArray(options.origin)) {
			return options.origin.includes(reqOrigin) ? reqOrigin : null;
		}
		if (typeof options.origin === "function") {
			const result = options.origin(reqOrigin);
			if (typeof result === "string") return result;
			return result ? reqOrigin : null;
		}
		return null;
	}

	function setCorsHeaders(
		headers: Headers,
		matchedOrigin: string | null,
	): void {
		if (matchedOrigin) {
			headers.set("access-control-allow-origin", matchedOrigin);
			if (matchedOrigin !== "*") {
				headers.append("vary", "Origin");
			}
		}
		if (credentials) {
			headers.set("access-control-allow-credentials", "true");
		}
		if (exposedHeaders) {
			headers.set("access-control-expose-headers", exposedHeaders);
		}
	}

	return {
		before(ctx: Context) {
			const reqOrigin = ctx.req.headers.get("origin");
			const matchedOrigin = resolveOrigin(reqOrigin);

			if (ctx.req.method === "OPTIONS") {
				const headers = new Headers();
				setCorsHeaders(headers, matchedOrigin);
				headers.set("access-control-allow-methods", methods);
				if (allowedHeaders) {
					headers.set("access-control-allow-headers", allowedHeaders);
				} else {
					const reqHeaders = ctx.req.headers.get(
						"access-control-request-headers",
					);
					if (reqHeaders) {
						headers.set("access-control-allow-headers", reqHeaders);
					}
				}
				if (maxAge) {
					headers.set("access-control-max-age", maxAge);
				}
				headers.set("content-length", "0");
				return new Response(null, { status: 204, headers });
			}

			(ctx.state as Record<string, unknown>)._corsOrigin = matchedOrigin;
		},
		after(ctx: Context, res: Response) {
			const matchedOrigin = (ctx.state as Record<string, unknown>)
				._corsOrigin as string | null | undefined;
			if (matchedOrigin !== undefined) {
				const headers = new Headers(res.headers);
				setCorsHeaders(headers, matchedOrigin);
				return new Response(res.body, {
					status: res.status,
					statusText: res.statusText,
					headers,
				});
			}
			return res;
		},
	};
}
