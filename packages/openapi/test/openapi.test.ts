import { describe, expect, it } from "bun:test";
import { App, json } from "@barqel/barq";
import { openapi } from "../src/index";

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
});
