// Native Server-Sent Events helper (zero dependencies) on top of Web Streams.
//
//   app.get("/events", (ctx) =>
//     sse(ctx, async (emitter) => {
//       emitter.send({ event: "hello", data: { n: 1 } });
//       emitter.close();
//     }),
//   );
import type { Context } from "@barqel/barq";

export interface SseMessage {
	id?: string | number;
	event?: string;
	data: unknown;
}

export interface SseEmitter {
	readonly isClosed: boolean;
	send(message: SseMessage): void;
	close(): void;
}

export type SseHandler = (emitter: SseEmitter) => void | Promise<void>;

const HEARTBEAT_MS = 15_000;

function formatMessage({ id, event, data }: SseMessage): string {
	const body = typeof data === "string" ? data : JSON.stringify(data);
	let out = "";

	if (id !== undefined) {
		out += `id: ${id}\n`;
	}

	if (event !== undefined) {
		out += `event: ${event}\n`;
	}

	for (const line of body.split("\n")) {
		out += `data: ${line}\n`;
	}

	return `${out}\n`;
}

export function sse(ctx: Context, handler: SseHandler): Response {
	const encoder = new TextEncoder();
	let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
	let closed = false;
	let heartbeat: ReturnType<typeof setInterval> | undefined;

	const push = (text: string): void => {
		if (!closed && controller) {
			controller.enqueue(encoder.encode(text));
		}
	};

	const emitter: SseEmitter = {
		get isClosed() {
			return closed;
		},
		send: (message) => {
			push(formatMessage(message));
		},
		close: () => {
			if (closed) {
				return;
			}

			closed = true;

			if (heartbeat !== undefined) {
				clearInterval(heartbeat);
			}

			controller?.close();
			controller = null;
		},
	};

	const stream = new ReadableStream<Uint8Array>({
		start(c) {
			controller = c;
			heartbeat = setInterval(() => push(": ping\n\n"), HEARTBEAT_MS);

			if (typeof heartbeat === "object" && heartbeat !== null) {
				(heartbeat as unknown as { unref?: () => void }).unref?.();
			}

			void Promise.resolve()
				.then(() => handler(emitter))
				.catch((error: unknown) => {
					console.error("[sse] handler failed:", error);
					emitter.close();
				});
		},
		cancel() {
			emitter.close();
		},
	});

	ctx.req.signal.addEventListener("abort", () => emitter.close(), {
		once: true,
	});

	return new Response(stream, {
		headers: {
			"content-type": "text/event-stream; charset=utf-8",
			"cache-control": "no-cache, no-transform",
			connection: "keep-alive",
			"X-Accel-Buffering": "no",
		},
	});
}

// Streams an async iterable (e.g. LLM tokens) as named SSE events.
export function sseStream<T>(
	ctx: Context,
	iterable: AsyncIterable<T>,
	map: (chunk: T) => SseMessage,
): Response {
	return sse(ctx, async (emitter) => {
		for await (const chunk of iterable) {
			if (emitter.isClosed) {
				break;
			}

			emitter.send(map(chunk));
		}

		emitter.close();
	});
}
