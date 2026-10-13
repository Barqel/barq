import { describe, expect, it } from "bun:test";
import { App } from "../src/app";
import { json } from "../src/http";

describe("async handlers on fast-path routes", () => {
	it("resolves promises on params-only routes instead of serializing them", async () => {
		const app = new App();
		app.get("/a/:id", async ({ params }) => ({ id: params.id }));
		const server = app.listen(0);

		try {
			const res = await fetch(`http://localhost:${server.port}/a/42`);
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ id: "42" });
		} finally {
			await app.stop();
		}
	});

	it("resolves promises of primitives on params-only routes", async () => {
		const app = new App();
		app.get("/a/:id", async ({ params }) => `hi ${params.id}`);
		app.get("/n/:id", async ({ params }) => Number(params.id));
		const server = app.listen(0);

		try {
			const textRes = await fetch(`http://localhost:${server.port}/a/42`);
			expect(textRes.status).toBe(200);
			expect(textRes.headers.get("content-type")).toContain("text/plain");
			expect(await textRes.text()).toBe("hi 42");

			const numRes = await fetch(`http://localhost:${server.port}/n/7`);
			expect(numRes.status).toBe(200);
			expect(await numRes.text()).toBe("7");
		} finally {
			await app.stop();
		}
	});

	it("passes through Response instances returned from async params-only routes", async () => {
		const app = new App();
		app.get("/a/:id", async ({ params }) => json({ id: params.id }));
		const server = app.listen(0);

		try {
			const res = await fetch(`http://localhost:${server.port}/a/42`);
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ id: "42" });
		} finally {
			await app.stop();
		}
	});

	it("resolves promises on context-free routes", async () => {
		const app = new App();
		app.get("/z", async () => ({ ok: true }));
		app.get("/s", async () => "hello");
		const server = app.listen(0);

		try {
			const objRes = await fetch(`http://localhost:${server.port}/z`);
			expect(objRes.status).toBe(200);
			expect(await objRes.json()).toEqual({ ok: true });

			const strRes = await fetch(`http://localhost:${server.port}/s`);
			expect(strRes.status).toBe(200);
			expect(await strRes.text()).toBe("hello");
		} finally {
			await app.stop();
		}
	});

	it("does not throw when a context-free handler returns undefined", async () => {
		const app = new App();
		app.get("/z", () => undefined);
		const server = app.listen(0);

		try {
			const res = await fetch(`http://localhost:${server.port}/z`);
			expect(res.status).toBe(200);
		} finally {
			await app.stop();
		}
	});

	it("does not throw when params-only and lightweight handlers return undefined", async () => {
		const app = new App();
		// The destructured props must keep their exact names: the scanner derives the
		// fast-path branch from `params` / `req`, so renaming them would move these
		// routes off the branch under test. `void <x>` reads the prop and still
		// evaluates to undefined, which is the return value being asserted.
		app.get("/a/:id", ({ params }) => void params);
		app.get("/b/:id", ({ params, req }) => void (params && req));
		const server = app.listen(0);

		try {
			const a = await fetch(`http://localhost:${server.port}/a/1`);
			expect(a.status).toBe(200);

			const b = await fetch(`http://localhost:${server.port}/b/1`);
			expect(b.status).toBe(200);
		} finally {
			await app.stop();
		}
	});

	it("converts rejections on fast-path routes into error responses", async () => {
		const app = new App({ development: true });
		app.get("/a/:id", async ({ params }) => {
			throw new Error(`params ${params.id}`);
		});
		app.get("/z", async () => {
			throw new Error("context-free boom");
		});
		app.get("/b/:id", async ({ params, req }) => {
			void req;
			throw new Error(`light ${params.id}`);
		});
		const server = app.listen(0);

		try {
			for (const [path, message] of [
				["/a/1", "params 1"],
				["/z", "context-free boom"],
				["/b/1", "light 1"],
			] as const) {
				const res = await fetch(`http://localhost:${server.port}${path}`);
				expect(res.status).toBe(500);
				expect(await res.text()).toContain(message);
			}
		} finally {
			await app.stop();
		}
	});

	it("serves HEAD for async context-free handlers without a body", async () => {
		const app = new App();
		app.get("/z", async () => ({ ok: true }));
		const server = app.listen(0);

		try {
			const res = await fetch(`http://localhost:${server.port}/z`, {
				method: "HEAD",
			});
			expect(res.status).toBe(200);
			expect(await res.text()).toBe("");
		} finally {
			await app.stop();
		}
	});

	it("does not leak pooled lightweight contexts across requests", async () => {
		const app = new App();
		app.get("/b/:id", async ({ params, req }) => ({
			id: params.id,
			ok: req.url.includes(`/b/${params.id}`),
		}));
		const server = app.listen(0);

		try {
			for (const id of ["1", "2", "3", "4", "5"]) {
				const res = await fetch(`http://localhost:${server.port}/b/${id}`);
				expect(res.status).toBe(200);
				expect(await res.json()).toEqual({ id, ok: true });
			}
		} finally {
			await app.stop();
		}
	});

	it("returns the real payload for a controller-style async handler", async () => {
		class UserController {
			async getUser(id: string) {
				if (id !== "1") return json({ success: false, message: "not found" });
				return json({ success: true, data: { id: "1", name: "Hassan" } });
			}
		}
		const controller = new UserController();

		const app = new App();
		app.group("/v1", (api) => {
			api.get("/users/:id", (ctx) => controller.getUser(ctx.params.id));
		});
		const server = app.listen(0);

		try {
			const res = await fetch(`http://localhost:${server.port}/v1/users/1`);
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({
				success: true,
				data: { id: "1", name: "Hassan" },
			});
		} finally {
			await app.stop();
		}
	});
});
