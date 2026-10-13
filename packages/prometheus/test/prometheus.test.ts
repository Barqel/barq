import { describe, expect, it } from "bun:test";
import { App, json } from "@barqel/barq";
import { prometheusPlugin } from "../src/index";

describe("@barqel/barq-prometheus", () => {
	it("collects HTTP metrics and exposes them at /metrics", async () => {
		const app = new App();
		app.plugin(
			prometheusPlugin({
				normalizePath: (path) =>
					path.startsWith("/users/") ? "/users/:id" : path,
			}),
		);

		app.get("/ping", () => json({ ok: true }));
		app.get("/users/:id", () => json({ ok: true }));
		app.post("/errors", () => new Response("Error", { status: 500 }));

		const server = app.listen(0);

		try {
			await fetch(`http://localhost:${server.port}/ping`);
			await fetch(`http://localhost:${server.port}/ping`);
			await fetch(`http://localhost:${server.port}/users/123`);
			await fetch(`http://localhost:${server.port}/errors`, { method: "POST" });

			const res = await fetch(`http://localhost:${server.port}/metrics`);
			expect(res.status).toBe(200);
			expect(res.headers.get("content-type")).toContain("text/plain");

			const text = await res.text();

			// Counter checks
			expect(text).toContain(
				'http_requests_total{method="GET",path="/ping",status="200"} 2',
			);
			expect(text).toContain(
				'http_requests_total{method="GET",path="/users/:id",status="200"} 1',
			);
			expect(text).toContain(
				'http_requests_total{method="POST",path="/errors",status="500"} 1',
			);

			// Histogram checks
			expect(text).toContain(
				'http_request_duration_seconds_count{method="GET",path="/ping",status="200"} 2',
			);
			expect(text).toContain(
				'http_request_duration_seconds_sum{method="GET",path="/ping",status="200"}',
			);

			// Default metrics checks
			expect(text).toContain("process_resident_memory_bytes");
			expect(text).toContain("nodejs_heap_size_total_bytes");
		} finally {
			await app.stop();
		}
	});

	it("skips tracking for skipped routes", async () => {
		const app = new App();
		app.plugin(
			prometheusPlugin({
				skip: (ctx) => ctx.pathname === "/skip",
			}),
		);

		app.get("/skip", () => new Response("skipped"));
		app.get("/tracked", () => new Response("tracked"));

		const server = app.listen(0);

		try {
			await fetch(`http://localhost:${server.port}/skip`);
			await fetch(`http://localhost:${server.port}/tracked`);

			const res = await fetch(`http://localhost:${server.port}/metrics`);
			const text = await res.text();

			expect(text).toContain(
				'http_requests_total{method="GET",path="/tracked",status="200"} 1',
			);
			expect(text).not.toContain('path="/skip"');
		} finally {
			await app.stop();
		}
	});
});
