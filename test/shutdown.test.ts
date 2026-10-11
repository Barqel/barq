import { beforeEach, describe, expect, it } from "bun:test";
import { App } from "../src/app";

describe("Graceful Shutdown", () => {
	let app: App;

	beforeEach(() => {
		app = new App({ development: true, cookieSecret: "secret" });
	});

	it("should shutdown gracefully", async () => {
		app.get("/", () => new Response("ok"));
		const server = app.listen(0);
		const port = server.port;

		const res = await fetch(`http://localhost:${port}/`);
		expect(res.status).toBe(200);

		const result = await app.stop();
		expect(result.forced).toBe(false);
		expect(result.pending).toBe(0);
	});

	it("should force shutdown after timeout", async () => {
		app.get(
			"/slow",
			() =>
				new Promise((resolve) =>
					setTimeout(() => resolve(new Response("ok")), 1000),
				),
		);
		const server = app.listen(0);
		const port = server.port;

		const fetchPromise = fetch(`http://localhost:${port}/slow`);
		await new Promise((r) => setTimeout(r, 10));

		const result = await app.stop(50);
		expect(result.forced).toBe(true);

		await fetchPromise.catch(() => {});
	});

	it("should handle shutdown when not listening", async () => {
		const result = await app.stop();
		expect(result.forced).toBe(false);
		expect(result.pending).toBe(0);
	});

	it("rejects invalid shutdown timeouts", async () => {
		await expect(app.stop(Number.NaN)).rejects.toThrow("hardTimeoutMs");
		await expect(app.stop(-1)).rejects.toThrow("hardTimeoutMs");
	});

	it("should handle multiple shutdown calls", async () => {
		app.get("/", () => new Response("ok"));
		const _server = app.listen(0);

		await app.stop();
		const result2 = await app.stop();
		expect(result2.forced).toBe(false);
	});

	it("does not restart while shutdown is still in progress", async () => {
		app.get(
			"/slow",
			() =>
				new Promise((resolve) =>
					setTimeout(() => resolve(new Response("ok")), 100),
				),
		);
		const server = app.listen(0);
		const responsePromise = fetch(`http://localhost:${server.port}/slow`);
		await new Promise((resolve) => setTimeout(resolve, 10));
		const stopPromise = app.stop(1000);
		expect(() => app.listen(0)).toThrow("shutdown is in progress");
		await stopPromise;
		await responsePromise.catch(() => {});
	});
});
