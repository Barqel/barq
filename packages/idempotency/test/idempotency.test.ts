import { describe, expect, it } from "bun:test";
import { App, json } from "@barqel/barq";
import {
	MemoryIdempotencyStore,
	idempotency,
	idempotencyPlugin,
} from "../src/index";

describe("@barqel/barq-idempotency", () => {
	it("processes and caches response for a new idempotency key", async () => {
		const app = new App();
		let callCount = 0;

		app.plugin(idempotencyPlugin());
		app.post("/charge", () => {
			callCount++;
			return json({ success: true, count: callCount });
		});

		const server = app.listen(0);

		try {
			const res1 = await fetch(`http://localhost:${server.port}/charge`, {
				method: "POST",
				headers: { "Idempotency-Key": "key-1" },
			});
			expect(res1.status).toBe(200);
			expect(res1.headers.get("x-idempotent-replayed")).toBeNull();
			expect(await res1.json()).toEqual({ success: true, count: 1 });

			const res2 = await fetch(`http://localhost:${server.port}/charge`, {
				method: "POST",
				headers: { "Idempotency-Key": "key-1" },
			});
			expect(res2.status).toBe(200);
			expect(res2.headers.get("x-idempotent-replayed")).toBe("true");
			expect(await res2.json()).toEqual({ success: true, count: 1 });

			expect(callCount).toBe(1);
		} finally {
			await app.stop();
		}
	});

	it("returns 409 Conflict for concurrent requests with the same key", async () => {
		const app = new App();
		const store = new MemoryIdempotencyStore();

		app.post("/slow", idempotency({ store }), async () => {
			await Bun.sleep(100);
			return json({ done: true });
		});

		const server = app.listen(0);

		try {
			const p1 = fetch(`http://localhost:${server.port}/slow`, {
				method: "POST",
				headers: { "Idempotency-Key": "key-concurrent" },
			});

			await Bun.sleep(20);

			const p2 = fetch(`http://localhost:${server.port}/slow`, {
				method: "POST",
				headers: { "Idempotency-Key": "key-concurrent" },
			});

			const [res1, res2] = await Promise.all([p1, p2]);

			expect(res1.status).toBe(200);
			expect(await res1.json()).toEqual({ done: true });

			expect(res2.status).toBe(409);
			expect(res2.headers.get("retry-after")).toBe("1");
			const err = await res2.json();
			expect(err.error).toBe("Conflict");
		} finally {
			store.destroy();
			await app.stop();
		}
	});

	it("enforces header presence when enforceHeader is true", async () => {
		const app = new App();
		app.post("/strict", idempotency({ enforceHeader: true }), () =>
			json({ ok: true }),
		);

		const server = app.listen(0);

		try {
			const res = await fetch(`http://localhost:${server.port}/strict`, {
				method: "POST",
			});
			expect(res.status).toBe(400);
			const err = await res.json();
			expect(err.error).toBe("Bad Request");
		} finally {
			await app.stop();
		}
	});

	it("ignores GET requests automatically", async () => {
		const app = new App();
		let callCount = 0;

		app.get("/data", idempotency({ enforceHeader: true }), () => {
			callCount++;
			return json({ count: callCount });
		});

		const server = app.listen(0);

		try {
			const res = await fetch(`http://localhost:${server.port}/data`);
			expect(res.status).toBe(200);
			expect(callCount).toBe(1);
		} finally {
			await app.stop();
		}
	});
});
