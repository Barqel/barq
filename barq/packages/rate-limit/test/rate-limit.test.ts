import { describe, expect, it } from "bun:test";
import { App, json } from "@barqel/barq";
import { MemoryStore, rateLimit } from "../src/index";

describe("@barqel/barq-rate-limit", () => {
	it("allows requests under the maximum limit and attaches headers", async () => {
		const app = new App();
		const store = new MemoryStore();

		app.get(
			"/limited",
			rateLimit({
				windowMs: 5000,
				max: 2,
				store,
			}),
			() => json({ success: true }),
		);

		const server = app.listen(0);

		try {
			const res1 = await fetch(`http://localhost:${server.port}/limited`);
			expect(res1.status).toBe(200);
			expect(res1.headers.get("RateLimit-Limit")).toBe("2");
			expect(res1.headers.get("RateLimit-Remaining")).toBe("1");

			const res2 = await fetch(`http://localhost:${server.port}/limited`);
			expect(res2.status).toBe(200);
			expect(res2.headers.get("RateLimit-Remaining")).toBe("0");

			const res3 = await fetch(`http://localhost:${server.port}/limited`);
			expect(res3.status).toBe(429);
			expect(res3.headers.get("Retry-After")).toBeDefined();
			const data = await res3.json();
			expect(data.error).toBe("Too Many Requests");
		} finally {
			store.destroy();
			await app.stop();
		}
	});

	it("respects skip callback", async () => {
		const app = new App();
		const store = new MemoryStore();

		app.get(
			"/skip",
			rateLimit({
				windowMs: 5000,
				max: 1,
				store,
				skip: (ctx) => ctx.req.headers.get("x-skip") === "true",
			}),
			() => json({ ok: true }),
		);

		const server = app.listen(0);

		try {
			const res1 = await fetch(`http://localhost:${server.port}/skip`);
			expect(res1.status).toBe(200);

			const res2 = await fetch(`http://localhost:${server.port}/skip`);
			expect(res2.status).toBe(429);

			const res3 = await fetch(`http://localhost:${server.port}/skip`, {
				headers: { "x-skip": "true" },
			});
			expect(res3.status).toBe(200);
		} finally {
			store.destroy();
			await app.stop();
		}
	});

	it("supports custom keyGenerator", async () => {
		const app = new App();
		const store = new MemoryStore();

		app.get(
			"/api-key",
			rateLimit({
				windowMs: 5000,
				max: 1,
				store,
				keyGenerator: (ctx) => ctx.req.headers.get("x-api-key") ?? "anon",
			}),
			() => json({ ok: true }),
		);

		const server = app.listen(0);

		try {
			const r1 = await fetch(`http://localhost:${server.port}/api-key`, {
				headers: { "x-api-key": "user_a" },
			});
			expect(r1.status).toBe(200);

			const r2 = await fetch(`http://localhost:${server.port}/api-key`, {
				headers: { "x-api-key": "user_a" },
			});
			expect(r2.status).toBe(429);

			const r3 = await fetch(`http://localhost:${server.port}/api-key`, {
				headers: { "x-api-key": "user_b" },
			});
			expect(r3.status).toBe(200);
		} finally {
			store.destroy();
			await app.stop();
		}
	});
});
