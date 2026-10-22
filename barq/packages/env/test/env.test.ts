import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { App } from "@barqel/barq";
import {
	createEnv,
	EnvValidationError,
	env,
	envPlugin,
	expandVariables,
	loadDotEnv,
	parseDotEnv,
} from "../src/index";

describe("@barqel/barq-env", () => {
	const tmpDir = path.join(import.meta.dir, ".tmp_env_test");

	beforeEach(() => {
		if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
	});

	afterEach(() => {
		if (fs.existsSync(tmpDir))
			fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("parses and validates string, number, boolean and port types", () => {
		const raw = `
APP_NAME="Barq Core"
PORT=8080 # Port value
MULTI="Line 1\nLine 2"
SINGLE='Raw Value'
EMPTY=
`;
		const parsed = parseDotEnv(raw);
		expect(parsed.APP_NAME).toBe("Barq Core");
		expect(parsed.PORT).toBe("8080");
		expect(parsed.MULTI).toBe("Line 1\nLine 2");
		expect(parsed.SINGLE).toBe("Raw Value");
	});

	it("falls back to default values when source is missing", () => {
		const parsed = createEnv(
			{
				PORT: env.port({ default: 3000 }),
				NAME: env.string({ default: "Barq" }),
			},
			{ dotEnv: false, source: {} },
		);
		expect(parsed.PORT).toBe(3000);
		expect(parsed.NAME).toBe("Barq");
	});

	it("throws EnvValidationError on missing required variables", () => {
		expect(() =>
			createEnv(
				{
					MISSING_KEY: env.string(),
					INVALID_PORT: env.port(),
				},
				{ dotEnv: false, source: { INVALID_PORT: "not-a-port" } },
			),
		).toThrow(EnvValidationError);
	});

	it("expands variable references (${VAR})", () => {
		const parsed = {
			HOST: "127.0.0.1",
			PORT: "3000",
			URL: "http://${HOST}:${PORT}/api",
		};
		const expanded = expandVariables(parsed, {});
		expect(expanded.URL).toBe("http://127.0.0.1:3000/api");
	});

	it("loads .env files from disk into process.env", () => {
		const envFile = path.join(tmpDir, ".env");
		fs.writeFileSync(envFile, "LOADED_VAR=from_disk\nTEST_PORT=9999");

		const loaded = loadDotEnv({ cwd: tmpDir, files: [".env"] });
		expect(loaded.LOADED_VAR).toBe("from_disk");
		expect(process.env.LOADED_VAR).toBe("from_disk");
		expect(process.env.TEST_PORT).toBe("9999");
	});

	it("validates and coerces environment schemas", () => {
		const mockSource = {
			PORT: "4000",
			NODE_ENV: "production",
			DEBUG: "1",
			API_URL: "https://api.example.com",
			JWT_SECRET: "12345678901234567890123456789012",
		};

		const parsed = createEnv(
			{
				PORT: env.port(),
				NODE_ENV: env.enum(["development", "production", "test"] as const),
				DEBUG: env.boolean(),
				API_URL: env.url(),
				JWT_SECRET: env.string({ min: 32 }),
				OPTIONAL_TAG: env.string({ optional: true }),
			},
			{ dotEnv: false, source: mockSource },
		);

		expect(parsed.PORT).toBe(4000);
		expect(parsed.NODE_ENV).toBe("production");
		expect(parsed.DEBUG).toBe(true);
		expect(parsed.API_URL).toBe("https://api.example.com");
		expect(parsed.OPTIONAL_TAG).toBeUndefined();
	});

	it("integrates with Barq via envPlugin", async () => {
		const app = new App();
		app.plugin(
			envPlugin(
				{
					SERVICE_PORT: env.port({ default: 3500 }),
				},
				{ dotEnv: false },
			),
		);

		app.get("/config", (ctx) => {
			const cfg = (ctx.state as any).env;
			return Response.json({ port: cfg.SERVICE_PORT });
		});

		const server = app.listen(0);

		try {
			const res = await fetch(`http://localhost:${server.port}/config`);
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data.port).toBe(3500);
		} finally {
			await app.stop();
		}
	});
});
