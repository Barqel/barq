import { describe, expect, it } from "bun:test";
import { App, json } from "@barqel/barq";
import { CircuitBreakerOpenError, createClient } from "../src/index";

describe("@barqel/barq-client", () => {
	it("performs GET and POST requests and extracts typed data", async () => {
		const serverApp = new App();
		serverApp.get("/users/:id", (ctx) => json({ id: ctx.params.id, name: "Grace Hopper" }));
		serverApp.post("/echo", async (ctx) => json(await ctx.json()));

		const server = serverApp.listen(0);

		try {
			const client = createClient({ baseUrl: `http://localhost:${server.port}` });

			const getRes = await client.get("/users/42");
			expect(getRes.status).toBe(200);
			const user = await getRes.data<{ id: string; name: string }>();
			expect(user).toEqual({ id: "42", name: "Grace Hopper" });

			const postRes = await client.post("/echo", { json: { ping: "pong" } });
			expect(postRes.status).toBe(200);
			expect(await postRes.data()).toEqual({ ping: "pong" });
		} finally {
			await server.stop();
		}
	});

	it("retries failed requests with backoff and succeeds", async () => {
		let attempts = 0;
		const serverApp = new App();
		serverApp.get("/flakey", () => {
			attempts++;
			if (attempts < 3) {
				return new Response("Transient Failure", { status: 503 });
			}
			return json({ success: true, attempts });
		});

		const server = serverApp.listen(0);

		try {
			const client = createClient({
				baseUrl: `http://localhost:${server.port}`,
				retry: { retries: 3, minDelayMs: 10, maxDelayMs: 50 },
			});

			const res = await client.get("/flakey");
			expect(res.status).toBe(200);
			const body = await res.data<{ success: boolean; attempts: number }>();
			expect(body.attempts).toBe(3);
		} finally {
			await server.stop();
		}
	});

	it("trips circuit breaker on repeated failures", async () => {
		const serverApp = new App();
		serverApp.get("/down", () => new Response("Outage", { status: 500 }));
		const server = serverApp.listen(0);

		try {
			const client = createClient({
				baseUrl: `http://localhost:${server.port}`,
				retry: false,
				circuitBreaker: { failureThreshold: 3, recoveryTimeMs: 1000 },
			});

			for (let i = 0; i < 3; i++) {
				const res = await client.get("/down");
				expect(res.status).toBe(500);
			}

			expect(client.get("/down")).rejects.toThrow(CircuitBreakerOpenError);
		} finally {
			await server.stop();
		}
	});

	it("propagates tracing headers from Barq Context", async () => {
		let receivedTrace: string | null = null;
		const upstreamApp = new App();
		upstreamApp.get("/trace-check", (ctx) => {
			receivedTrace = ctx.req.headers.get("x-request-id");
			return json({ ok: true });
		});
		const upstreamServer = upstreamApp.listen(0);

		try {
			const client = createClient({ baseUrl: `http://localhost:${upstreamServer.port}` });
			const mockCtx = {
				state: { requestId: "trace-barq-777" },
				req: { headers: new Headers() },
			} as any;

			await client.get("/trace-check", { ctx: mockCtx });
			expect(receivedTrace).toBe("trace-barq-777");
		} finally {
			await upstreamServer.stop();
		}
	});
});
