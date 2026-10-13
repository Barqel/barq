import { describe, expect, it } from "bun:test";
import { App, json } from "@barqel/barq";
import { version, versioningPlugin } from "../src/index";

describe("@barqel/barq-versioning", () => {
	it("dispatches by Accept-Version header", async () => {
		const app = new App();

		app.get(
			"/users",
			version(
				{
					"1": () => json({ version: 1, name: "Ada Lovelace" }),
					"2": () =>
						json({ version: 2, firstName: "Ada", lastName: "Lovelace" }),
				},
				{ defaultVersion: "1" },
			),
		);

		const server = app.listen(0);

		try {
			const resDefault = await fetch(`http://localhost:${server.port}/users`);
			expect(resDefault.status).toBe(200);
			expect(await resDefault.json()).toEqual({
				version: 1,
				name: "Ada Lovelace",
			});

			const resV1 = await fetch(`http://localhost:${server.port}/users`, {
				headers: { "Accept-Version": "v1" },
			});
			expect(resV1.status).toBe(200);
			expect(await resV1.json()).toEqual({ version: 1, name: "Ada Lovelace" });

			const resV2 = await fetch(`http://localhost:${server.port}/users`, {
				headers: { "Accept-Version": "2.0" },
			});
			expect(resV2.status).toBe(400);

			const resV2Exact = await fetch(`http://localhost:${server.port}/users`, {
				headers: { "Accept-Version": "2" },
			});
			expect(resV2Exact.status).toBe(200);
			expect(await resV2Exact.json()).toEqual({
				version: 2,
				firstName: "Ada",
				lastName: "Lovelace",
			});
		} finally {
			await app.stop();
		}
	});

	it("dispatches by query parameter", async () => {
		const app = new App();

		app.get(
			"/items",
			version(
				{
					"1": () => json({ items: ["a", "b"] }),
					"2": () => json({ data: [{ id: "a" }, { id: "b" }] }),
				},
				{ type: "query", query: "api-version", defaultVersion: "1" },
			),
		);

		const server = app.listen(0);

		try {
			const resV2 = await fetch(
				`http://localhost:${server.port}/items?api-version=2`,
			);
			expect(resV2.status).toBe(200);
			expect(await resV2.json()).toEqual({ data: [{ id: "a" }, { id: "b" }] });
		} finally {
			await app.stop();
		}
	});

	it("dispatches by vendor media-type", async () => {
		const app = new App();

		app.get(
			"/profile",
			version(
				{
					"1": () => json({ legacy: true }),
					"2": () => json({ modern: true }),
				},
				{
					type: "media-type",
					mediaTypePrefix: "application/vnd.barq",
					defaultVersion: "1",
				},
			),
		);

		const server = app.listen(0);

		try {
			const resV2 = await fetch(`http://localhost:${server.port}/profile`, {
				headers: { Accept: "application/vnd.barq.v2+json" },
			});
			expect(resV2.status).toBe(200);
			expect(await resV2.json()).toEqual({ modern: true });
		} finally {
			await app.stop();
		}
	});

	it("works in tandem with global versioningPlugin", async () => {
		const app = new App();
		app.plugin(versioningPlugin({ header: "X-Version", defaultVersion: "1" }));

		app.get(
			"/info",
			version({
				"1": (ctx) => json({ resolved: ctx.state.version, v: 1 }),
				"2": (ctx) => json({ resolved: ctx.state.version, v: 2 }),
			}),
		);

		const server = app.listen(0);

		try {
			const res = await fetch(`http://localhost:${server.port}/info`, {
				headers: { "X-Version": "2" },
			});
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ resolved: "2", v: 2 });
		} finally {
			await app.stop();
		}
	});
});
