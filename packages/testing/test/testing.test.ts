import { describe, expect, it } from "bun:test";
import { App, json } from "@barqel/barq";
import { testClient } from "../src/index";

describe("@barqel/barq-testing", () => {
	it("executes GET requests in-memory without starting a network port", async () => {
		const app = new App();
		app.get("/users/:id", (ctx) =>
			json({ id: ctx.params.id, name: "Ada Lovelace" }),
		);

		const client = testClient(app);
		const res = await client.get("/users/42");

		expect(res.status).toBe(200);
		expect(res.header("content-type")).toContain("application/json");
		expect(await res.json()).toEqual({ id: "42", name: "Ada Lovelace" });
	});

	it("handles POST requests with json payloads and query parameters", async () => {
		const app = new App();
		app.post("/items", async (ctx) => {
			const body = (await ctx.json()) as { name: string };
			const notify = ctx.queryParam("notify") === "true";
			return json({ created: true, name: body.name, notify }, 201);
		});

		const client = testClient(app);
		const res = await client.post("/items", {
			query: { notify: true },
			json: { name: "Mechanical Keyboard" },
		});

		expect(res.status).toBe(201);
		expect(await res.json()).toEqual({
			created: true,
			name: "Mechanical Keyboard",
			notify: true,
		});
	});

	it("parses set-cookie headers automatically", async () => {
		const app = new App();
		app.get("/login", (ctx) => {
			ctx.cookies.set("token", "secret_jwt", {
				path: "/",
				httpOnly: true,
				secure: true,
				sameSite: "Strict",
			});
			return json({ success: true });
		});

		const client = testClient(app);
		const res = await client.get("/login");

		expect(res.status).toBe(200);
		expect(res.cookies.has("token")).toBe(true);

		const cookie = res.cookies.get("token")!;
		expect(cookie.value).toBe("secret_jwt");
		expect(cookie.httpOnly).toBe(true);
		expect(cookie.secure).toBe(true);
		expect(cookie.sameSite).toBe("Strict");
		expect(cookie.path).toBe("/");
	});

	it("simulates client IP address in requests", async () => {
		const app = new App({ trustProxy: true });
		app.get("/whoami", (ctx) => json({ ip: ctx.ip }));

		const client = testClient(app);
		const res = await client.get("/whoami", {
			ip: "198.51.100.42",
		});

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ip: "198.51.100.42" });
	});

	it("executes high volume in-memory requests in microseconds", async () => {
		const app = new App();
		app.get("/benchmark", () => "ok");

		const client = testClient(app);
		const t0 = performance.now();

		for (let i = 0; i < 500; i++) {
			const res = await client.get("/benchmark");
			expect(res.status).toBe(200);
		}

		const elapsed = performance.now() - t0;
		expect(elapsed).toBeLessThan(100);
	});
});
