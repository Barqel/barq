import { describe, expect, it } from "bun:test";
import { App, json } from "@barqel/barq";
import { type HandlerRouteMeta, openapi, ROUTE_META } from "../src/index";

describe("@barqel/barq-openapi", () => {
	it("registers routes, produces openapi.json and renders docs", async () => {
		const app = new App();

		app.plugin(
			openapi({
				title: "User Service",
				version: "2.0.0",
				docsPath: "/docs",
				specPath: "/openapi.json",
				ui: "scalar",
			}),
		);

		app.post(
			"/users/:id",
			{
				schema: {
					tags: ["Users"],
					summary: "Create user",
					params: {
						type: "object",
						properties: { id: { type: "string" } },
						required: ["id"],
					},
					body: {
						type: "object",
						properties: { name: { type: "string" } },
						required: ["name"],
					},
					responses: {
						201: { description: "User created" },
					},
				},
			},
			(ctx) => {
				const valid = ctx.valid as {
					body: { name: string };
					params: { id: string };
				};
				return json({ id: valid.params.id, name: valid.body.name }, 201);
			},
		);

		const server = app.listen(0);

		try {
			const specRes = await fetch(
				`http://localhost:${server.port}/openapi.json`,
			);
			expect(specRes.status).toBe(200);
			const spec = await specRes.json();
			expect(spec.openapi).toBe("3.1.0");
			expect(spec.info.title).toBe("User Service");
			expect(spec.paths["/users/{id}"]).toBeDefined();
			expect(spec.paths["/users/{id}"].post.summary).toBe("Create user");

			const docsRes = await fetch(`http://localhost:${server.port}/docs`);
			expect(docsRes.status).toBe(200);
			const html = await docsRes.text();
			expect(html).toContain("@scalar/api-reference");

			const postRes = await fetch(`http://localhost:${server.port}/users/u42`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ name: "Ada" }),
			});
			expect(postRes.status).toBe(201);
			expect(await postRes.json()).toEqual({ id: "u42", name: "Ada" });
		} finally {
			await app.stop();
		}
	});

	it("supports nested route groups with prefix inheritance", async () => {
		const app = new App();

		app.plugin(
			openapi({
				docsPath: "/docs",
				specPath: "/openapi.json",
			}),
		);

		app.group("/api/v1", (v1) => {
			v1.get(
				"/items",
				{
					schema: {
						tags: ["Items"],
						summary: "List items",
					},
				},
				() => json([]),
			);
		});

		const server = app.listen(0);

		try {
			const specRes = await fetch(
				`http://localhost:${server.port}/openapi.json`,
			);
			const spec = await specRes.json();
			expect(spec.paths["/api/v1/items"]).toBeDefined();
			expect(spec.paths["/api/v1/items"].get.tags).toEqual(["Items"]);
		} finally {
			await app.stop();
		}
	});

	it("derives docs from handler metadata (action contract)", async () => {
		const app = new App();

		app.plugin(openapi({ specPath: "/openapi.json" }));

		// Simulates what `@barqel/barq-app`'s `action` attaches.
		const handler = () => json({ ok: true });
		(handler as unknown as Record<PropertyKey, unknown>)[ROUTE_META] = {
			source: "params",
			schema: {
				type: "object",
				properties: { id: { type: "string", minLength: 1 } },
				required: ["id"],
			},
			docs: {
				tags: ["Users"],
				summary: "Get user by id",
				responses: {
					200: { description: "User found" },
					404: { description: "User not found" },
				},
			},
		} satisfies HandlerRouteMeta;

		app.group("/api/v1", (api) => {
			api.get("/users/:id", handler);
		});

		const server = app.listen(0);

		try {
			const spec = await (
				await fetch(`http://localhost:${server.port}/openapi.json`)
			).json();
			const operation = spec.paths["/api/v1/users/{id}"].get;

			expect(operation.summary).toBe("Get user by id");
			expect(operation.tags).toEqual(["Users"]);
			expect(operation.parameters[0]).toMatchObject({
				name: "id",
				in: "path",
				required: true,
				schema: { type: "string", minLength: 1 },
			});
			expect(operation.responses["200"].description).toBe("User found");
			expect(operation.responses["404"].description).toBe("User not found");

			// The route itself keeps working untouched.
			const res = await fetch(
				`http://localhost:${server.port}/api/v1/users/42`,
			);
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ ok: true });
		} finally {
			await app.stop();
		}
	});

	it("registers docs-only metadata (unvalidated action)", async () => {
		const app = new App();

		app.plugin(openapi({ specPath: "/openapi.json" }));

		// Simulates what `action(run, docs)` attaches when no request class
		// is declared: operation docs, but no request schema.
		const handler = () => json({ ok: true });
		(handler as unknown as Record<PropertyKey, unknown>)[ROUTE_META] = {
			docs: { tags: ["Health"], summary: "Health check" },
		} satisfies HandlerRouteMeta;

		app.get("/health", handler);

		const server = app.listen(0);

		try {
			const spec = await (
				await fetch(`http://localhost:${server.port}/openapi.json`)
			).json();
			const operation = spec.paths["/health"].get;

			expect(operation.summary).toBe("Health check");
			expect(operation.tags).toEqual(["Health"]);
			expect(operation.parameters).toBeUndefined();
			expect(operation.responses["200"]).toBeDefined();
		} finally {
			await app.stop();
		}
	});
});
