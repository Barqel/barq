import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { type Context, HttpError, type Middleware } from "@barqel/barq";
import type { UploadOptions, UploadedFile } from "./types";

const isBun = typeof Bun !== "undefined";

export function upload(options: UploadOptions = {}): Middleware {
	const maxFileSize = options.maxFileSize ?? Number.POSITIVE_INFINITY;
	const maxFiles = options.maxFiles ?? Number.POSITIVE_INFINITY;
	const accept = options.accept
		? new Set(options.accept.map((a) => a.toLowerCase()))
		: null;
	let destCreated = false;

	return {
		async before(ctx: Context) {
			if (ctx.req.method === "GET" || ctx.req.method === "HEAD") return;

			const contentType = ctx.req.headers.get("content-type") || "";
			if (!contentType.includes("multipart/form-data")) return;

			let form: FormData;
			try {
				form = await ctx.formData();
			} catch {
				throw new HttpError(400, {
					error: "Invalid multipart/form-data payload",
				});
			}

			const files: UploadedFile[] = [];
			let fileCount = 0;

			if (options.dest && options.createDestDir !== false && !destCreated) {
				try {
					await mkdir(options.dest, { recursive: true });
					destCreated = true;
				} catch (err) {
					throw new HttpError(500, {
						error: "Failed to create upload destination directory",
					});
				}
			}

			// `FormData.entries()` is declared as `[string, string]` in bun-types,
			// so widen it to the runtime shape to keep file entries reachable.
			const entries = form.entries() as unknown as IterableIterator<
				[string, string | File]
			>;

			for (const [field, value] of entries) {
				if (value instanceof File) {
					fileCount++;

					if (fileCount > maxFiles) {
						throw new HttpError(413, {
							error: "Too Many Files",
							message: `Maximum allowed files is ${maxFiles}`,
						});
					}

					if (value.size > maxFileSize) {
						throw new HttpError(413, {
							error: "Payload Too Large",
							message: `File '${value.name}' exceeds the size limit of ${maxFileSize} bytes`,
						});
					}

					// استخراج النوع الأساسي وتجاهل الـ charset إذا وُجد
					const fileType = value.type.split(";")[0]?.trim().toLowerCase() || "";

					if (
						accept !== null &&
						!accept.has(fileType) &&
						!accept.has(value.type.toLowerCase())
					) {
						throw new HttpError(415, {
							error: "Unsupported Media Type",
							message: `File type '${value.type}' is not allowed`,
						});
					}

					const uploaded: UploadedFile = {
						field,
						name: value.name,
						type: value.type,
						size: value.size,
						file: value,
					};

					if (options.dest) {
						const filename = options.generateFilename
							? options.generateFilename(value)
							: `${randomUUID()}${extname(value.name)}`;
						const savePath = join(options.dest, filename);

						if (isBun) {
							await Bun.write(savePath, value);
						} else {
							const buffer = Buffer.from(await value.arrayBuffer());
							await writeFile(savePath, buffer);
						}

						uploaded.savedAs = filename;
						uploaded.path = savePath;
					}

					files.push(uploaded);
				}
			}

			(ctx.state as Record<string, unknown>).files = files;
		},
	};
}
