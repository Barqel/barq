import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { App, json } from "@barqel/barq";
import { type UploadedFile, upload } from "../src/index";

const TEST_DIR = join(import.meta.dir, ".tmp_upload_test");

describe("@barqel/barq-upload", () => {
	beforeAll(async () => {
		await mkdir(TEST_DIR, { recursive: true });
	});

	afterAll(async () => {
		await rm(TEST_DIR, { recursive: true, force: true });
	});

	function createMultipartRequest(
		files: { name: string; content: string; type: string }[],
	): Request {
		const formData = new FormData();
		for (const f of files) {
			const file = new File([f.content], f.name, { type: f.type });
			formData.append("document", file);
		}
		return new Request("http://localhost/upload", {
			method: "POST",
			body: formData,
		});
	}

	it("parses and validates uploaded files in memory", async () => {
		const app = new App();
		app.post(
			"/upload",
			upload({
				maxFileSize: 1024,
				maxFiles: 2,
				accept: ["text/plain"],
			}),
			(ctx) => {
				const files = ctx.state.files as UploadedFile[];
				return json({ count: files.length, names: files.map((f) => f.name) });
			},
		);

		const server = app.listen(0);

		try {
			const req = createMultipartRequest([
				{ name: "test1.txt", content: "hello world", type: "text/plain" },
			]);

			const res = await fetch(`http://localhost:${server.port}/upload`, {
				method: req.method,
				headers: req.headers,
				body: req.body,
			});

			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ count: 1, names: ["test1.txt"] });
		} finally {
			await app.stop();
		}
	});

	it("rejects files exceeding maxFileSize", async () => {
		const app = new App();
		app.post("/upload", upload({ maxFileSize: 5 }), (ctx) =>
			json({ ok: true }),
		);
		const server = app.listen(0);

		try {
			const req = createMultipartRequest([
				{ name: "large.txt", content: "123456789", type: "text/plain" },
			]);

			const res = await fetch(`http://localhost:${server.port}/upload`, {
				method: req.method,
				headers: req.headers,
				body: req.body,
			});

			expect(res.status).toBe(413);
			const err = await res.json();
			expect(err.error).toBe("Payload Too Large");
		} finally {
			await app.stop();
		}
	});

	it("rejects invalid MIME types based on accept array", async () => {
		const app = new App();
		app.post("/upload", upload({ accept: ["image/png"] }), (ctx) =>
			json({ ok: true }),
		);
		const server = app.listen(0);

		try {
			const req = createMultipartRequest([
				{
					name: "script.js",
					content: "console.log()",
					type: "application/javascript",
				},
			]);

			const res = await fetch(`http://localhost:${server.port}/upload`, {
				method: req.method,
				headers: req.headers,
				body: req.body,
			});

			expect(res.status).toBe(415);
		} finally {
			await app.stop();
		}
	});

	it("saves files securely to disk with generated filenames", async () => {
		const app = new App();
		app.post(
			"/upload",
			upload({
				dest: TEST_DIR,
				generateFilename: (file) => `secure_${file.name}`,
			}),
			(ctx) => {
				const files = ctx.state.files as UploadedFile[];
				return json({ savedPath: files[0]!.path });
			},
		);

		const server = app.listen(0);

		try {
			const req = createMultipartRequest([
				{ name: "doc.txt", content: "secure content", type: "text/plain" },
			]);

			const res = await fetch(`http://localhost:${server.port}/upload`, {
				method: req.method,
				headers: req.headers,
				body: req.body,
			});

			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data.savedPath).toBeDefined();

			const fileStat = await stat(data.savedPath);
			expect(fileStat.isFile()).toBe(true);
		} finally {
			await app.stop();
		}
	});
});
