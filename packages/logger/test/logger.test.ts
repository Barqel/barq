import { describe, expect, it } from "bun:test";
import { App, json } from "@barqel/barq";
import {
	type LogRecord,
	loggerPlugin,
	type RequestLogger,
	requestLogger,
} from "../src/index";

describe("@barqel/barq-logger", () => {
	it("generates and attaches x-request-id to responses", async () => {
		const app = new App();
		app.plugin(loggerPlugin());
		app.get("/ping", () => json({ ok: true }));

		const server = app.listen(0);

		try {
			const res = await fetch(`http://localhost:${server.port}/ping`);
			expect(res.status).toBe(200);
			const reqId = res.headers.get("x-request-id");
			expect(reqId).toBeDefined();
			expect(reqId!.length).toBeGreaterThan(10);
		} finally {
			await app.stop();
		}
	});

	it("preserves incoming x-request-id", async () => {
		const app = new App();
		app.plugin(loggerPlugin());
		app.get("/trace", (ctx) => json({ id: ctx.state.requestId }));

		const server = app.listen(0);

		try {
			const customId = "trace-custom-999";
			const res = await fetch(`http://localhost:${server.port}/trace`, {
				headers: { "x-request-id": customId },
			});
			expect(res.status).toBe(200);
			expect(res.headers.get("x-request-id")).toBe(customId);
			const data = await res.json();
			expect(data.id).toBe(customId);
		} finally {
			await app.stop();
		}
	});

	it("captures structured logs with latency and status", async () => {
		const captured: LogRecord[] = [];
		const app = new App();

		app.use(
			requestLogger({
				output: (record) => captured.push(record),
			}),
		);

		app.get("/users", (ctx) => {
			const log = ctx.state.log as RequestLogger;
			log.info("Fetching users list", { count: 3 });
			return json(["Ada", "Grace", "Linus"]);
		});

		const server = app.listen(0);

		try {
			const res = await fetch(`http://localhost:${server.port}/users`);
			expect(res.status).toBe(200);

			expect(captured.length).toBe(2);

			const customLog = captured[0]!;
			expect(customLog.level).toBe("info");
			expect(customLog.message).toBe("Fetching users list");
			expect(customLog.data?.count).toBe(3);

			const requestLog = captured[1]!;
			expect(requestLog.level).toBe("info");
			expect(requestLog.method).toBe("GET");
			expect(requestLog.path).toBe("/users");
			expect(requestLog.status).toBe(200);
			expect(requestLog.durationMs).toBeDefined();
		} finally {
			await app.stop();
		}
	});

	it("respects skip configuration", async () => {
		const captured: LogRecord[] = [];
		const app = new App();

		app.use(
			requestLogger({
				skip: (ctx) => ctx.pathname === "/health",
				output: (record) => captured.push(record),
			}),
		);

		app.get("/health", () => json({ status: "healthy" }));
		app.get("/data", () => json({ data: 123 }));

		const server = app.listen(0);

		try {
			await fetch(`http://localhost:${server.port}/health`);
			expect(captured.length).toBe(0);

			await fetch(`http://localhost:${server.port}/data`);
			expect(captured.length).toBe(1);
			expect(captured[0]!.path).toBe("/data");
		} finally {
			await app.stop();
		}
	});
});
