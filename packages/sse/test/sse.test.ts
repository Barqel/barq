import { describe, expect, it } from "bun:test";
import { App } from "@barqel/barq";
import { formatSseChunk, sse, sseFromAsyncIterable } from "../src/index";

describe("@barqel/barq-sse", () => {
	it("formats SSE messages according to spec", () => {
		const chunk = formatSseChunk({
			id: "1",
			event: "update",
			data: { count: 42 },
			retry: 5000,
		});
		const text = new TextDecoder().decode(chunk);

		expect(text).toContain("id: 1\n");
		expect(text).toContain("event: update\n");
		expect(text).toContain('data: {"count":42}\n');
		expect(text).toContain("retry: 5000\n");
		expect(text.endsWith("\n\n")).toBe(true);
	});

	it("handles multi-line text payloads with multiple data lines", () => {
		const chunk = formatSseChunk({ data: "line1\nline2\nline3" });
		const text = new TextDecoder().decode(chunk);

		expect(text).toBe("data: line1\ndata: line2\ndata: line3\n\n");
	});

	it("streams SSE events via HTTP endpoint", async () => {
		const app = new App();

		app.get("/events", (ctx) => {
			return sse(ctx, async (emitter) => {
				emitter.send({ id: "evt_1", event: "ping", data: "hello" });
				emitter.send({ id: "evt_2", event: "message", data: { text: "world" } });
				emitter.close();
			});
		});

		const server = app.listen(0);

		try {
			const res = await fetch(`http://localhost:${server.port}/events`);
			expect(res.status).toBe(200);
			expect(res.headers.get("content-type")).toContain("text/event-stream");
			expect(res.headers.get("cache-control")).toContain("no-cache");

			const body = await res.text();
			expect(body).toContain("event: ping\n");
			expect(body).toContain("data: hello\n");
			expect(body).toContain("id: evt_2\n");
			expect(body).toContain('data: {"text":"world"}\n');
		} finally {
			await app.stop();
		}
	});

	it("streams from async iterables seamlessly", async () => {
		const app = new App();

		async function* generateTokens() {
			yield "token-1";
			yield "token-2";
			yield "token-3";
		}

		app.get("/llm-tokens", (ctx) => {
			return sseFromAsyncIterable(
				generateTokens(),
				(tok) => ({ event: "delta", data: tok }),
				{},
				ctx,
			);
		});

		const server = app.listen(0);

		try {
			const res = await fetch(`http://localhost:${server.port}/llm-tokens`);
			expect(res.status).toBe(200);

			const body = await res.text();
			expect(body).toContain("event: delta\ndata: token-1\n\n");
			expect(body).toContain("event: delta\ndata: token-2\n\n");
			expect(body).toContain("event: delta\ndata: token-3\n\n");
		} finally {
			await app.stop();
		}
	});
});
