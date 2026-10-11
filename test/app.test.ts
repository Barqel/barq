import { describe, expect, it } from "bun:test";
import { App } from "../src/app";

describe("App request handling", () => {
	it("passes route params through params-only native handlers", async () => {
		const app = new App();
		app.get("/users/:id", (ctx) => ({ id: ctx.params.id, name: "Ada" }));
		const server = app.listen(0);

		try {
			const response = await fetch(`http://localhost:${server.port}/users/42`);

			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({ id: "42", name: "Ada" });
		} finally {
			await app.stop();
		}
	});

	it("matches and serializes parameter routes without bypassing path matching", async () => {
		const app = new App();
		app.get("/users/:id", (ctx) => ({ id: ctx.params.id, name: "Ada" }));
		const server = app.listen(0);

		try {
			const encodedParamResponse = await fetch(
				`http://localhost:${server.port}/users/a%22b`,
			);
			expect(await encodedParamResponse.json()).toEqual({
				id: 'a"b',
				name: "Ada",
			});

			for (const id of ["42", "43", "42"]) {
				const response = await fetch(
					`http://localhost:${server.port}/users/${id}`,
				);
				expect(await response.json()).toEqual({ id, name: "Ada" });
			}

			const unmatchedResponse = await fetch(
				`http://localhost:${server.port}/prefix/users/42`,
			);
			expect(unmatchedResponse.status).toBe(404);

			const unsupportedMethodResponse = await fetch(
				`http://localhost:${server.port}/users/42`,
				{ method: "POST" },
			);
			expect(unsupportedMethodResponse.status).toBe(405);
			expect(unsupportedMethodResponse.headers.get("allow")).toContain("GET");
		} finally {
			await app.stop();
		}
	});

	it("serves HEAD requests without response bodies", async () => {
		const app = new App();
		app.get("/text", () => new Response("payload"));
		app.get("/users/:id", (ctx) => ({ id: ctx.params.id }));
		app.get(
			"/dynamic/:id",
			() => new Response("dynamic", { headers: { "x-route": "dynamic" } }),
		);
		const server = app.listen(0);

		try {
			for (const path of ["/text", "/users/42", "/dynamic/42"]) {
				const response = await fetch(`http://localhost:${server.port}${path}`, {
					method: "HEAD",
				});
				expect(response.status).toBe(200);
				expect(await response.text()).toBe("");
				if (path === "/users/42") {
					expect(response.headers.get("content-type")).toContain(
						"application/json",
					);
				} else if (path === "/dynamic/42") {
					expect(response.headers.get("x-route")).toBe("dynamic");
				}
			}
		} finally {
			await app.stop();
		}
	});

	it("uses native routes with middleware, params, direct values, and cookies", async () => {
		const app = new App({ development: false }).use({
			before: () => ({ requestMarker: "seen" }),
		});
		app.get("/json", () => ({ hello: "world" }));
		app.get("/users/:id", (ctx) => ({
			id: ctx.params.id,
			marker: ctx.state.requestMarker,
		}));
		app.get("/cookie", (ctx) => {
			ctx.cookies.set("session", "abc");
			return "ok";
		});
		const server = app.listen(0);

		try {
			const jsonResponse = await fetch(`http://localhost:${server.port}/json`);
			expect(await jsonResponse.json()).toEqual({ hello: "world" });

			const userResponse = await fetch(
				`http://localhost:${server.port}/users/user-7`,
			);
			expect(await userResponse.json()).toEqual({
				id: "user-7",
				marker: "seen",
			});

			const cookieResponse = await fetch(
				`http://localhost:${server.port}/cookie`,
			);
			expect(await cookieResponse.text()).toBe("ok");
			expect(cookieResponse.headers.get("set-cookie")).toContain("session=abc");
		} finally {
			await app.stop();
		}
	});

	it("normalizes async route values after the handler resolves", async () => {
		const app = new App();
		app.post("/echo", (ctx) => ctx.json());
		const server = app.listen(0);

		try {
			const response = await fetch(`http://localhost:${server.port}/echo`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: '{"message":"ok"}',
			});

			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({ message: "ok" });
		} finally {
			await app.stop();
		}
	});

	it("uses query-only handlers with direct query parameter lookups", async () => {
		const app = new App();
		app.get("/search", (ctx) => ({
			q: ctx.queryParam("q"),
			page: Number(ctx.queryParam("page") ?? 1),
			tags: ctx.queryParamAll("tag"),
		}));
		const server = app.listen(0);

		try {
			const response = await fetch(
				`http://localhost:${server.port}/search?q=hello+world&page=2&tag=a&tag=b`,
			);

			expect(await response.json()).toEqual({
				q: "hello world",
				page: 2,
				tags: ["a", "b"],
			});
		} finally {
			await app.stop();
		}
	});

	it("keeps cluster startup safe when reusePort is unavailable", async () => {
		const app = new App();
		if (process.platform === "linux") {
			expect(() => app.cluster(0)).toThrow("fixed, non-zero port");
			return;
		}

		const server = app.cluster(0);
		expect(server?.port).toBeGreaterThan(0);
		await app.stop();
	});

	it("exposes state returned by middleware to route handlers", async () => {
		const app = new App({ development: false })
			.use({ before: async () => ({ identity: { id: "user-1" } }) })
			.get("/identity", (ctx) => new Response(ctx.state.identity.id));
		const server = app.listen(0);

		try {
			const response = await fetch(`http://localhost:${server.port}/identity`);
			expect(await response.text()).toBe("user-1");
		} finally {
			await app.stop();
		}
	});

	it("serves requests without requiring a cookie signing secret", async () => {
		const app = new App({ development: false });
		app.get("/", (ctx) => new Response(ctx.cookies.get("session") ?? "ok"));
		const server = app.listen(0);

		try {
			const response = await fetch(`http://localhost:${server.port}/`, {
				headers: { cookie: "broken=%" },
			});
			expect(response.status).toBe(200);
			expect(await response.text()).toBe("ok");
		} finally {
			await app.stop();
		}
	});

	it("does not partially register optional route expansions", async () => {
		const app = new App({ cookieSecret: "test-secret-with-enough-entropy" });
		app.get("/items/:id", () => new Response("item"));
		expect(() =>
			app.get("/items/:id?", () => new Response("optional")),
		).toThrow("Duplicate route");
		const server = app.listen(0);

		try {
			const response = await fetch(`http://localhost:${server.port}/items`);
			expect(response.status).toBe(404);
		} finally {
			await app.stop();
		}
	});

	it("rejects too many optional route parameters", () => {
		const app = new App({ cookieSecret: "test-secret-with-enough-entropy" });
		const pattern = Array.from({ length: 9 }, (_, i) => `:p${i}?`).join("/");
		expect(() => app.get(`/${pattern}`, () => new Response("ok"))).toThrow(
			"limit of 8 optional parameters",
		);
	});

	it("rejects route patterns deep enough to risk recursive matcher overflow", () => {
		const app = new App();
		const pattern = `/${Array.from({ length: 257 }, () => "x").join("/")}`;
		expect(() => app.get(pattern, () => new Response("ok"))).toThrow(
			"limit of 256 segments",
		);
	});

	it("does not partially register methods from a failed all route", async () => {
		const app = new App({ cookieSecret: "test-secret-with-enough-entropy" });
		app.post("/shared", () => new Response("post"));
		expect(() => app.all("/shared", () => new Response("all"))).toThrow(
			"Duplicate route",
		);
		const server = app.listen(0);

		try {
			const response = await fetch(`http://localhost:${server.port}/shared`);
			expect(response.status).toBe(405);
			expect(response.headers.get("allow")).toContain("POST");
			expect(response.headers.get("allow")).not.toContain("GET");
		} finally {
			await app.stop();
		}
	});

	it("rejects invalid proxy CIDR configuration at construction", () => {
		expect(() => new App({ trustProxy: "10.0.0.0/33" })).toThrow(
			"Invalid trustProxy IP range",
		);
	});

	it("rejects unsafe numeric server limits before binding", () => {
		expect(
			() => new App({ maxRequestBodySize: Number.POSITIVE_INFINITY }),
		).toThrow("maxRequestBodySize");
		expect(() => new App({ maxRequestBodySize: -1 })).toThrow(
			"maxRequestBodySize",
		);
		expect(() => new App({ idleTimeout: Number.NaN })).toThrow("idleTimeout");
		expect(() => new App({ idleTimeout: 256 })).toThrow("idleTimeout");
		expect(() => new App({ port: 65536 })).toThrow("port");
		expect(() => new App().listen(-1)).toThrow("port");
		expect(
			() => new App({ websocket: { maxPayloadLength: Infinity } }),
		).toThrow("maxPayloadLength");
		expect(() => new App({ websocket: { backpressureLimit: 0 } })).toThrow(
			"backpressureLimit",
		);
		expect(() => new App({ websocket: { idleTimeout: 256 } })).toThrow(
			"websocket.idleTimeout",
		);
	});

	it("does not expose a mutable redirect allowlist to handlers", async () => {
		const app = new App({ allowedRedirectHosts: ["safe.example"] });
		app.get("/mutate", (ctx) => {
			(ctx.redirectHosts as Set<string>).add("evil.example");
			return ctx.redirect("https://evil.example/");
		});
		app.get("/safe", (ctx) => ctx.redirect("https://safe.example/"));
		const server = app.listen(0);

		try {
			const blocked = await fetch(`http://localhost:${server.port}/mutate`, {
				redirect: "manual",
			});
			const allowed = await fetch(`http://localhost:${server.port}/safe`, {
				redirect: "manual",
			});
			expect(blocked.status).toBe(500);
			expect(blocked.headers.get("location")).toBeNull();
			expect(allowed.status).toBe(302);
		} finally {
			await app.stop();
		}
	});

	it("uses a secure error-detail default when NODE_ENV is unset", () => {
		const previous = process.env.NODE_ENV;
		try {
			delete process.env.NODE_ENV;
			expect(new App().development).toBe(false);
		} finally {
			if (previous === undefined) delete process.env.NODE_ENV;
			else process.env.NODE_ENV = previous;
		}
	});

	it("does not route interior empty path segments as normalized paths", async () => {
		const app = new App({ development: false });
		app.get("/users/:id", (ctx) => new Response(ctx.params.id));
		const server = app.listen(0);

		try {
			const response = await fetch(`http://localhost:${server.port}/users//42`);
			expect(response.status).toBe(404);
		} finally {
			await app.stop();
		}
	});
});
