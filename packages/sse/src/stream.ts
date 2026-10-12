import type { Context } from "@barqel/barq";
import { formatCommentChunk, formatSseChunk } from "./format";
import type { SseEmitter, SseHandler, SseMessage, SseOptions } from "./types";

export function createSseResponse(
	handler: SseHandler,
	options: SseOptions = {},
	ctx?: Context,
): Response {
	ctx?.disableTimeout?.();

	const heartbeatInterval = options.heartbeatIntervalMs ?? 15_000;
	let timer: ReturnType<typeof setInterval> | null = null;
	let closed = false;
	const signal = ctx?.req?.signal;

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const emitter: SseEmitter = {
				get isClosed() {
					return closed;
				},
				get signal() {
					return signal;
				},
				send(arg1: unknown, arg2?: Omit<SseMessage, "data">) {
					if (closed) return;
					let msg: SseMessage;
					if (arg2 !== undefined) {
						msg = { ...arg2, data: arg1 };
					} else if (typeof arg1 === "object" && arg1 !== null && ("data" in arg1 || "comment" in arg1 || "event" in arg1)) {
						msg = arg1 as SseMessage;
					} else {
						msg = { data: arg1 };
					}
					controller.enqueue(formatSseChunk(msg));
				},
				comment(text: string) {
					if (closed) return;
					controller.enqueue(formatCommentChunk(text));
				},
				close() {
					if (closed) return;
					closed = true;
					if (timer) {
						clearInterval(timer);
						timer = null;
					}
					try {
						controller.close();
					} catch {}
				},
			};

			if (options.retry !== undefined) {
				emitter.send({ retry: options.retry });
			}

			if (heartbeatInterval > 0) {
				timer = setInterval(() => {
					if (closed) {
						if (timer) clearInterval(timer);
						return;
					}
					emitter.comment("ping");
				}, heartbeatInterval);
				if (typeof timer.unref === "function") {
					timer.unref();
				}
			}

			signal?.addEventListener("abort", () => {
				emitter.close();
			});

			try {
				await Promise.resolve(handler(emitter));
			} catch (err) {
				if (!closed) {
					emitter.close();
				}
				throw err;
			}
		},
		cancel() {
			closed = true;
			if (timer) {
				clearInterval(timer);
				timer = null;
			}
		},
	});

	const headers = new Headers({
		"content-type": "text/event-stream; charset=utf-8",
		"cache-control": "no-cache, no-transform",
		connection: "keep-alive",
		"x-accel-buffering": "no",
		...options.headers,
	});

	return new Response(stream, {
		status: 200,
		headers,
	});
}

export function sseFromAsyncIterable<T>(
	iterable: AsyncIterable<T>,
	transform?: (item: T) => SseMessage | unknown,
	options: SseOptions = {},
	ctx?: Context,
): Response {
	return createSseResponse(
		async (emitter) => {
			for await (const item of iterable) {
				if (emitter.isClosed) break;
				const payload = transform ? transform(item) : item;
				emitter.send(payload);
			}
			emitter.close();
		},
		options,
		ctx,
	);
}
