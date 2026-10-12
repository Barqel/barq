import { describe, expect, it } from "bun:test";
import { App, json, text } from "@barqel/barq";
import { compressPlugin } from "../src/index";

describe("@barqel/barq-compress", () => {
	const largePayload = {
		data: Array.from({ length: 500 }, (_, i) => ({
			id: i,
			name: `User ${i}`,
			email: `user${i}@example.com`,
		})),
	};

	it("compresses large payloads with gzip", async () => {
		const app = new App();
		app.plugin(compressPlugin({ threshold: 512 }));
		app.get("/large", () => json(largePayload));

		const server = app.listen(0);

		try {
			const res = await fetch(`http://localhost:${server.port}/large`, {
				headers: { "Accept-Encoding": "gzip" },
			});
			expect(res.status).toBe(200);
			expect(res.headers.get("content-encoding")).toBe("gzip");
			expect(res.headers.get("vary")).toContain("Accept-Encoding");

			const decoded = await res.json();
			expect(decoded).toEqual(largePayload);
		} finally {
			await app.stop();
		}
	});

	it("compresses with brotli when preferred", async () => {
		const app = new App();
		app.plugin(compressPlugin({ threshold: 512 }));
		app.get("/large-br", () => json(largePayload));

		const server = app.listen(0);

		try {
			const res = await fetch(`http://localhost:${server.port}/large-br`, {
				headers: { "Accept-Encoding": "gzip, deflate, br" },
			});
			expect(res.status).toBe(200);
			expect(res.headers.get("content-encoding")).toBe("br");

			const decoded = await res.json();
			expect(decoded).toEqual(largePayload);
		} finally {
			await app.stop();
		}
	});

	it("skips compression below threshold", async () => {
		const app = new App();
		app.plugin(compressPlugin({ threshold: 2048 }));
		app.get("/small", () => {
			const res = json({ ok: true });
			// Mocking Content-Length since standard Response constructor omits it
			res.headers.set("content-length", "13");
			return res;
		});

		const server = app.listen(0);

		try {
			const res = await fetch(`http://localhost:${server.port}/small`, {
				headers: { "Accept-Encoding": "gzip" },
			});
			expect(res.status).toBe(200);
			expect(res.headers.get("content-encoding")).toBeNull();
		} finally {
			await app.stop();
		}
	});

	it("does not compress non-compressible MIME types", async () => {
		const app = new App();
		app.plugin(compressPlugin({ threshold: 10 }));
		app.get("/binary", () => {
			const res = new Response(new Uint8Array(2000));
			res.headers.set("content-type", "application/octet-stream");
			return res;
		});

		const server = app.listen(0);

		try {
			const res = await fetch(`http://localhost:${server.port}/binary`, {
				headers: { "Accept-Encoding": "gzip" },
			});
			expect(res.headers.get("content-encoding")).toBeNull();
		} finally {
			await app.stop();
		}
	});
});
