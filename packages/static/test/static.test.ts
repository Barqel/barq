import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { App } from "@barqel/barq";
import { staticFiles } from "../src/index";

const TEST_DIR = join(import.meta.dir, "tmp_static_test");

describe("@barqel/barq-static", () => {
	beforeAll(async () => {
		await mkdir(join(TEST_DIR, "sub"), { recursive: true });
		await writeFile(join(TEST_DIR, "index.html"), "<h1>Index</h1>");
		await writeFile(join(TEST_DIR, "style.css"), "body { color: red; }");
		await writeFile(join(TEST_DIR, "data.json"), '{"key":"val"}');
		await writeFile(join(TEST_DIR, ".secret"), "forbidden");
		await writeFile(join(TEST_DIR, "sub/nested.txt"), "nested content");
	});

	afterAll(async () => {
		await rm(TEST_DIR, { recursive: true, force: true });
	});

	it("serves static files with correct MIME types", async () => {
		const app = new App();
		app.plugin(staticFiles({ root: TEST_DIR, prefix: "/public" }));
		const server = app.listen(0);

		try {
			const resCss = await fetch(
				`http://localhost:${server.port}/public/style.css`,
			);
			expect(resCss.status).toBe(200);
			expect(resCss.headers.get("content-type")).toContain("text/css");
			expect(await resCss.text()).toBe("body { color: red; }");

			const resJson = await fetch(
				`http://localhost:${server.port}/public/data.json`,
			);
			expect(resJson.status).toBe(200);
			expect(resJson.headers.get("content-type")).toContain("application/json");
			expect(await resJson.json()).toEqual({ key: "val" });
		} finally {
			await app.stop();
		}
	});

	it("serves index.html when directory is requested", async () => {
		const app = new App();
		app.plugin(staticFiles({ root: TEST_DIR, prefix: "/public" }));
		const server = app.listen(0);

		try {
			const res = await fetch(`http://localhost:${server.port}/public/`);
			expect(res.status).toBe(200);
			expect(res.headers.get("content-type")).toContain("text/html");
			expect(await res.text()).toBe("<h1>Index</h1>");
		} finally {
			await app.stop();
		}
	});

	it("prevents directory traversal attacks", async () => {
		const app = new App();
		app.plugin(staticFiles({ root: TEST_DIR, prefix: "/public" }));
		const server = app.listen(0);

		try {
			const res = await fetch(
				`http://localhost:${server.port}/public/../../package.json`,
			);
			expect(res.status).toBe(404);
		} finally {
			await app.stop();
		}
	});

	it("ignores dotfiles by default", async () => {
		const app = new App();
		app.plugin(staticFiles({ root: TEST_DIR, prefix: "/public" }));
		const server = app.listen(0);

		try {
			const res = await fetch(`http://localhost:${server.port}/public/.secret`);
			expect(res.status).toBe(404);
		} finally {
			await app.stop();
		}
	});

	it("handles ETags and returns 304 Not Modified", async () => {
		const app = new App();
		app.plugin(staticFiles({ root: TEST_DIR, prefix: "/public" }));
		const server = app.listen(0);

		try {
			const res1 = await fetch(
				`http://localhost:${server.port}/public/style.css`,
			);
			const etag = res1.headers.get("etag");
			expect(etag).toBeDefined();

			const res2 = await fetch(
				`http://localhost:${server.port}/public/style.css`,
				{
					headers: { "if-none-match": etag! },
				},
			);
			expect(res2.status).toBe(304);
		} finally {
			await app.stop();
		}
	});

	it("supports SPA fallback for html navigation requests", async () => {
		const app = new App();
		app.plugin(staticFiles({ root: TEST_DIR, spa: true }));
		const server = app.listen(0);

		try {
			const res = await fetch(
				`http://localhost:${server.port}/dashboard/user`,
				{
					headers: { accept: "text/html,application/xhtml+xml" },
				},
			);
			expect(res.status).toBe(200);
			expect(res.headers.get("content-type")).toContain("text/html");
			expect(await res.text()).toBe("<h1>Index</h1>");
		} finally {
			await app.stop();
		}
	});

	it("supports byte range requests", async () => {
		const app = new App();
		app.plugin(staticFiles({ root: TEST_DIR, prefix: "/public" }));
		const server = app.listen(0);

		try {
			const res = await fetch(
				`http://localhost:${server.port}/public/style.css`,
				{
					headers: { range: "bytes=0-3" },
				},
			);
			expect(res.status).toBe(206);
			expect(res.headers.get("content-range")).toContain("bytes 0-3/");
			expect(await res.text()).toBe("body");
		} finally {
			await app.stop();
		}
	});
});
