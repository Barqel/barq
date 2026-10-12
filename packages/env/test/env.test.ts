import { describe, expect, it } from "bun:test";
import { App, json } from "@barqel/barq";
import { EnvValidationError, createEnv, env, envPlugin } from "../src/index";

describe("@barqel/barq-env", () => {
	it("parses and validates string, number, boolean and port types", () => {
		const source = {
			PORT: "8080",
			APP_NAME: "BarqServer",
			DEBUG: "true",
			API_URL: "https://api.example.com",
			NODE_ENV: "production",
		};

		const config = createEnv(
			{
				PORT: env.port({ default: 3000 }),
				APP_NAME: env.string({ min: 3 }),
				DEBUG: env.boolean({ default: false }),
				API_URL: env.url({ protocols: ["https"] }),
				NODE_ENV: env.enum(["development", "production", "test"] as const),
			},
			{ source },
		);

		expect(config.PORT).toBe(8080);
		expect(config.APP_NAME).toBe("BarqServer");
		expect(config.DEBUG).toBe(true);
		expect(config.API_URL).toBe("https://api.example.com");
		expect(config.NODE_ENV).toBe("production");
	});

	it("falls back to default values when source is missing", () => {
		const config = createEnv(
			{
				PORT: env.port({ default: 4000 }),
				ENABLE_TELEMETRY: env.boolean({ default: false }),
			},
			{ source: {} },
		);

		expect(config.PORT).toBe(4000);
		expect(config.ENABLE_TELEMETRY).toBe(false);
	});

	it("throws EnvValidationError on missing required variables", () => {
		expect(() =>
			createEnv(
				{
					DATABASE_URL: env.string(),
					SECRET_KEY: env.string({ min: 32 }),
				},
				{ source: { SECRET_KEY: "short" } },
			),
		).toThrow(EnvValidationError);
	});

	it("integrates with Barq via envPlugin", async () => {
		const app = new App();
		app.plugin(
			envPlugin(
				{
					SERVICE_NAME: env.string({ default: "orders-api" }),
				},
				{ source: {} },
			),
		);

		app.get("/service", (ctx) => {
			return json({ service: (ctx.state as any).env.SERVICE_NAME });
		});

		const server = app.listen(0);

		try {
			const res = await fetch(`http://localhost:${server.port}/service`);
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ service: "orders-api" });
		} finally {
			await app.stop();
		}
	});
});
