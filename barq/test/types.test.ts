import { describe, expect, it } from "bun:test";
import { App } from "../src/app";
import { validateJson } from "../src/validation";

function verifyRouteParameterTypes(): void {
	const app = new App();
	app.get("/users/:userId", (ctx) => {
		const userId: string = ctx.params.userId;
		// @ts-expect-error Route params are strings, not numbers.
		const numericId: number = ctx.params.userId;
		return new Response(`${userId}:${numericId}`);
	});

	app
		.use({ before: () => ({ session: { userId: "user-1" } }) })
		.get("/session", (ctx) => {
			const userId: string = ctx.state.session.userId;
			// @ts-expect-error Session state is inferred from middleware output.
			const missing: number = ctx.state.session.userId;
			return new Response(`${userId}:${missing}`);
		});

	app
		.use(
			{ before: () => ({ requestId: "request-1" }) },
			{ before: () => ({ tenantId: "tenant-1" }) },
		)
		.get("/tenant", (ctx) => {
			const requestId: string = ctx.state.requestId;
			const tenantId: string = ctx.state.tenantId;
			return new Response(`${requestId}:${tenantId}`);
		});

	app.post(
		"/users",
		validateJson(
			{
				parse(data: unknown) {
					return data as { name: string };
				},
			},
			(_ctx, body) => {
				const name: string = body.name;
				// @ts-expect-error The schema output is inferred as an object with a string name.
				const age: number = body.name;
				return new Response(`${name}:${age}`);
			},
		),
	);

	new App()
		.use({ before: () => new Response("short-circuit") })
		.get("/short-circuit", (ctx) => {
			// @ts-expect-error A Response short-circuits; it is not request state.
			const status: number = ctx.state.status;
			return new Response(String(status));
		});
}

void verifyRouteParameterTypes;

describe("Route Group Types", () => {
	it("should infer params for simple group", () => {
		const app = new App({ cookieSecret: "secret" });
		app.group("/api", (g) => {
			g.get("/users", (_ctx) => {
				return new Response("ok");
			});
		});
	});

	it("infers state provided by group middleware", () => {
		const app = new App();
		app.group("/typed", (group) => {
			group.use({ before: () => ({ groupValue: "typed" }) }).get("/", (ctx) => {
				const value: string = ctx.state.groupValue;
				return new Response(value);
			});
		});
	});

	it("should infer params for group with params", () => {
		const app = new App({ cookieSecret: "secret" });
		app.group("/api/:version", (g) => {
			g.get("/users/:id", (_ctx) => {
				return new Response("ok");
			});
		});
	});

	it("should infer params for nested groups", () => {
		const app = new App({ cookieSecret: "secret" });
		app.group("/api", (g) => {
			g.group("/v1", (g2) => {
				g2.get("/users/:id", (_ctx) => {
					return new Response("ok");
				});
			});
		});
	});

	it("should infer params for wildcard in group", () => {
		const app = new App({ cookieSecret: "secret" });
		app.group("/files", (g) => {
			g.get("/*path", (_ctx) => {
				return new Response("ok");
			});
		});
	});

	it("should work with middleware in group", () => {
		const app = new App({ cookieSecret: "secret" });
		app.group("/api", { before: () => {} }, (g) => {
			g.get("/test", (_ctx) => new Response("ok"));
		});
	});

	it("should work with multiple middleware in group", () => {
		const app = new App({ cookieSecret: "secret" });
		app.group("/api", { before: () => {} }, { before: () => {} }, (g) => {
			g.get("/test", (_ctx) => new Response("ok"));
		});
	});
});

describe("JoinPath type behavior (runtime)", () => {
	const joinPrefix = (prefix: string, pattern: string): string => {
		if (!prefix) return pattern;
		let p = pattern.trim();
		if (p.length === 0 || p === "/") return prefix;
		if (p.charCodeAt(0) !== 47) p = `/${p}`;
		return prefix + p;
	};

	it("should join empty prefix with pattern", () => {
		expect(joinPrefix("", "/foo")).toBe("/foo");
	});

	it("should join prefix with pattern starting with /", () => {
		expect(joinPrefix("/api", "/foo")).toBe("/api/foo");
	});

	it("should join prefix with pattern not starting with /", () => {
		expect(joinPrefix("/api", "foo")).toBe("/api/foo");
	});

	it("should return prefix when pattern is /", () => {
		expect(joinPrefix("/api", "/")).toBe("/api");
	});

	it("should return prefix when pattern is empty", () => {
		expect(joinPrefix("/api", "")).toBe("/api");
	});

	it("should handle empty prefix with empty pattern", () => {
		expect(joinPrefix("", "")).toBe("");
	});
});
