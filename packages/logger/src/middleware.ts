import type { Context, Middleware } from "@barqel/barq";
import { Logger, defaultGenerateId } from "./logger";
import type { LogLevel, LoggerOptions } from "./types";

export function requestLogger(options: LoggerOptions = {}): Middleware {
	const logger = new Logger(options);
	const headerName = options.headerName?.toLowerCase() ?? "x-request-id";
	const idGenerator = options.generateId ?? defaultGenerateId;

	return {
		before(ctx: Context) {
			if (options.skip?.(ctx)) return;

			const existingId = ctx.req.headers.get(headerName);
			const requestId = existingId && existingId.trim().length > 0 ? existingId : idGenerator();

			const state = ctx.state as Record<string, unknown>;
			state.requestId = requestId;
			state.log = logger.createRequestLogger(requestId);
			state._loggerStartTime = performance.now();
		},

		after(ctx: Context, res: Response) {
			const state = ctx.state as Record<string, unknown>;
			const startTime = state._loggerStartTime as number | undefined;
			if (startTime === undefined) return res;

			const durationMs = Number((performance.now() - startTime).toFixed(2));
			const requestId = state.requestId as string;
			const status = res.status;

			let level: LogLevel = "info";
			if (status >= 500) {
				level = "error";
			} else if (status >= 400) {
				level = "warn";
			}

			logger.log({
				level,
				time: new Date().toISOString(),
				requestId,
				method: ctx.req.method,
				path: ctx.pathname,
				status,
				durationMs,
				ip: ctx.ip,
				userAgent: ctx.req.headers.get("user-agent") ?? undefined,
			});

			const headers = new Headers(res.headers);
			if (!headers.has(headerName)) {
				headers.set(headerName, requestId);
			}

			return new Response(res.body, {
				status: res.status,
				statusText: res.statusText,
				headers,
			});
		},
	};
}
