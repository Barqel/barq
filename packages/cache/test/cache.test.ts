import { describe, expect, it } from "bun:test";
import { App, json } from "@barqel/barq";
import { MemoryCacheStore, cachePlugin } from "../src/index";

describe("@barqel/barq-cache", () => {
	it("caches response and returns HIT on subsequent requests", async () => {
		const app = new App();
		let callCount = 0;

		app.plugin(cachePlugin({ ttlMs: 5000 }));
		app.get("/data", () => {
			callCount++;
			return json({ count: callCount });
		});

		const server = app.listen(0);

		try {
			const res1 = await fetch(`http://localhost:${server.port}/data`);
			expect(res1.status).toBe(200);
			expect(res1.headers.get("x-cache")).toBe("MISS");
			expect(await res1.json()).toEqual({ count: 1 });

			const res2 = await fetch(`http://localhost:${server.port}/data`);
			expect(res2.status).toBe(200);
			expect(res2.headers.get("x-cache")).toBe("HIT");
			expect(await res2.json()).toEqual({ count: 1 }); 
			
			expect(callCount).toBe(1);
		} finally {
			await app.stop();
		}
	});

	it("generates ETag and responds with 304 Not Modified", async () => {
		const app = new App();
		app.plugin(cachePlugin({ ttlMs: 5000, enableEtag: true }));
		app.get("/static", () => new Response("Hello World"));

		const server = app.listen(0);

		try {
			const res1 = await fetch(`http://localhost:${server.port}/static`);
			expect(res1.status).toBe(200);
			const etag = res1.headers.get("etag");
			expect(etag).toBeDefined();

			const res2 = await fetch(`http://localhost:${server.port}/static`, {
				headers: { "If-None-Match": etag! },
			});
			expect(res2.status).toBe(304);
			expect(res2.headers.get("etag")).toBe(etag);
			expect(await res2.text()).toBe(""); 
		} finally {
			await app.stop();
		}
	});

	it("respects skip configuration", async () => {
		const app = new App();
		let callCount = 0;

		app.plugin(
			cachePlugin({
				ttlMs: 5000,
				skip: (ctx) => ctx.req.headers.has("x-no-cache"),
			}),
		);
		app.get("/skip", () => {
			callCount++;
			return json({ count: callCount });
		});

		const server = app.listen(0);

		try {
			const res1 = await fetch(`http://localhost:${server.port}/skip`);
			expect(res1.headers.get("x-cache")).toBe("MISS");

			const res2 = await fetch(`http://localhost:${server.port}/skip`, {
				headers: { "x-no-cache": "true" },
			});
			expect(res2.headers.get("x-cache")).toBeNull(); 
			const data = await res2.json();
			expect(data.count).toBe(2);
		} finally {
			await app.stop();
		}
	});

	it("expires cache after TTL", async () => {
		const app = new App();
		let callCount = 0;
		const store = new MemoryCacheStore(10);

		app.plugin(cachePlugin({ ttlMs: 50, store }));
		app.get("/expire", () => {
			callCount++;
			return json({ count: callCount });
		});

		const server = app.listen(0);

		try {
			await fetch(`http://localhost:${server.port}/expire`);
			expect(callCount).toBe(1);

			await Bun.sleep(60);

			const res2 = await fetch(`http://localhost:${server.port}/expire`);
			expect(res2.headers.get("x-cache")).toBe("MISS");
			expect(callCount).toBe(2);
		} finally {
			store.destroy();
			await app.stop();
		}
	});
});
