import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
	createTestApp,
	defineConfig,
	json,
	type TestServer,
} from "../src/index";

const config = defineConfig({
	name: "Test App",
	routes: (app) => {
		app.get("/ping", () => json({ pong: true }));
	},
});

describe("createApp kernel", () => {
	let server: TestServer;

	beforeAll(() => {
		server = createTestApp(config);
	});

	afterAll(async () => {
		await server.close();
	});

	it("serves the health probe", async () => {
		const response = await fetch(`${server.baseUrl}/health`);

		expect(response.status).toBe(200);

		const body = (await response.json()) as Record<string, unknown>;
		expect(body.success).toBe(true);
		expect(body.status).toBe("ok");
	});

	it("serves the root summary with the app name", async () => {
		const response = await fetch(`${server.baseUrl}/`);

		expect(response.status).toBe(200);

		const body = (await response.json()) as Record<string, unknown>;
		expect(body.name).toBe("Test App");
		expect(body.docs).toBe("/docs");
	});

	it("routes application routes", async () => {
		const response = await fetch(`${server.baseUrl}/ping`);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ pong: true });
	});

	it("returns a localized 404 for unknown routes", async () => {
		const response = await fetch(`${server.baseUrl}/nope`, {
			headers: { "accept-language": "ar" },
		});

		expect(response.status).toBe(404);

		const body = (await response.json()) as Record<string, unknown>;
		expect(body.success).toBe(false);
		expect(body.message).toBe("العنصر غير موجود");
		expect(body.path).toBe("/nope");
	});

	it("serves the OpenAPI spec and docs UI", async () => {
		const spec = await fetch(`${server.baseUrl}/openapi.json`);
		expect(spec.status).toBe(200);

		const document = (await spec.json()) as { openapi: string };
		expect(document.openapi).toBeDefined();

		const docs = await fetch(`${server.baseUrl}/docs`);
		expect(docs.status).toBe(200);
		expect(docs.headers.get("content-type")).toContain("text/html");
	});
});
