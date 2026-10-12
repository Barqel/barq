import type { Context } from "@barqel/barq";
import { createSseResponse, sseFromAsyncIterable } from "./stream";
import type { SseHandler, SseMessage, SseOptions } from "./types";

export * from "./types";
export * from "./format";
export * from "./stream";

export function sse(
	ctxOrHandler: Context | SseHandler,
	handlerOrOptions?: SseHandler | SseOptions,
	options?: SseOptions,
): Response {
	if (typeof ctxOrHandler === "function") {
		return createSseResponse(ctxOrHandler, (handlerOrOptions as SseOptions) ?? {});
	}

	const ctx = ctxOrHandler as Context;
	const handler = handlerOrOptions as SseHandler;
	return createSseResponse(handler, options ?? {}, ctx);
}

export function sseStream<T>(
	ctx: Context,
	iterable: AsyncIterable<T>,
	transform?: (item: T) => SseMessage | unknown,
	options?: SseOptions,
): Response {
	return sseFromAsyncIterable(iterable, transform, options, ctx);
}
