import { statSync } from "node:fs";
import { open, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { type Context, empty } from "@barqel/barq";
import { getMimeType } from "./mime";
import { isDotFile, sanitizePath } from "./security";
import type { StaticHandler, StaticOptions } from "./types";

const isBun = typeof Bun !== "undefined";

export function createStaticHandler(options: StaticOptions): StaticHandler {
	const rootDir = options.root;
	const indexFile = options.index === false ? null : (options.index ?? "index.html");
	const spaFallback = options.spa === true ? "index.html" : (options.spa || null);
	const maxAge = options.maxAge ?? 0;
	const immutable = options.immutable ?? false;
	const enableEtag = options.etag ?? true;
	const dotfiles = options.dotfiles ?? "ignore";

	const cacheControlHeader = maxAge > 0
		? `public, max-age=${maxAge}${immutable ? ", immutable" : ""}`
		: "public, max-age=0, must-revalidate";

	return async (ctx: Context): Promise<Response> => {
		if (ctx.req.method !== "GET" && ctx.req.method !== "HEAD") {
			return new Response("Method Not Allowed", {
				status: 405,
				headers: { allow: "GET, HEAD" },
			});
		}

		let relative = (ctx.params as Record<string, string>).path ?? ctx.pathname;
		if (options.prefix && relative.startsWith(options.prefix)) {
			relative = relative.slice(options.prefix.length);
		}
		if (!relative.startsWith("/")) {
			relative = `/${relative}`;
		}

		if (dotfiles !== "allow" && isDotFile(relative)) {
			return dotfiles === "deny" ? new Response("Forbidden", { status: 403 }) : new Response("Not Found", { status: 404 });
		}

		let absolute = sanitizePath(rootDir, relative);
		if (!absolute) {
			return new Response("Not Found", { status: 404 });
		}

		let fileStat = await getFileStat(absolute);

		if (fileStat?.isDirectory && indexFile) {
			const indexCandidate = sanitizePath(absolute, indexFile);
			if (indexCandidate) {
				const indexStat = await getFileStat(indexCandidate);
				if (indexStat && !indexStat.isDirectory) {
					absolute = indexCandidate;
					fileStat = indexStat;
				}
			}
		}

		if (!fileStat || fileStat.isDirectory) {
			if (spaFallback) {
				const accept = ctx.req.headers.get("accept") ?? "";
				if (accept.includes("text/html")) {
					const spaCandidate = sanitizePath(rootDir, spaFallback);
					if (spaCandidate) {
						const spaStat = await getFileStat(spaCandidate);
						if (spaStat && !spaStat.isDirectory) {
							absolute = spaCandidate;
							fileStat = spaStat;
						}
					}
				}
			}

			if (!fileStat || fileStat.isDirectory) {
				return new Response("Not Found", { status: 404 });
			}
		}

		const etag = enableEtag ? `W/"${fileStat.size.toString(16)}-${Math.floor(fileStat.mtimeMs).toString(16)}"` : null;

		if (etag && ctx.req.headers.get("if-none-match") === etag) {
			const res304 = empty(304);
			res304.headers.set("etag", etag);
			res304.headers.set("cache-control", cacheControlHeader);
			return res304;
		}

		const mimeType = getMimeType(absolute);
		const rangeHeader = ctx.req.headers.get("range");

		if (rangeHeader && rangeHeader.startsWith("bytes=") && !rangeHeader.includes(",")) {
			const rangeRes = await handleRangeRequest(absolute, fileStat.size, rangeHeader, mimeType, etag, cacheControlHeader);
			if (rangeRes) return rangeRes;
		}

		if (ctx.req.method === "HEAD") {
			const res = empty(200);
			res.headers.set("content-type", mimeType);
			res.headers.set("content-length", String(fileStat.size));
			res.headers.set("cache-control", cacheControlHeader);
			res.headers.set("accept-ranges", "bytes");
			if (etag) res.headers.set("etag", etag);
			options.setHeaders?.(res, absolute, fileStat);
			return res;
		}

		if (isBun) {
			const bunFile = Bun.file(absolute);
			const res = new Response(bunFile);
			res.headers.set("content-type", mimeType);
			res.headers.set("cache-control", cacheControlHeader);
			res.headers.set("accept-ranges", "bytes");
			if (etag) res.headers.set("etag", etag);
			options.setHeaders?.(res, absolute, fileStat);
			return res;
		}

		const handle = await open(absolute, "r");
		const stream = handle.createReadStream();
		const webStream = Readable.toWeb(stream);

		const res = new Response(webStream as unknown as ReadableStream, {
			status: 200,
			headers: {
				"content-type": mimeType,
				"content-length": String(fileStat.size),
				"cache-control": cacheControlHeader,
				"accept-ranges": "bytes",
				...(etag ? { etag } : {}),
			},
		});

		options.setHeaders?.(res, absolute, fileStat);
		return res;
	};
}

async function getFileStat(path: string): Promise<{ size: number; mtimeMs: number; isDirectory: boolean } | null> {
	try {
		const s = await stat(path);
		return { size: s.size, mtimeMs: s.mtimeMs, isDirectory: s.isDirectory() };
	} catch {
		return null;
	}
}

async function handleRangeRequest(
	filePath: string,
	totalSize: number,
	range: string,
	mimeType: string,
	etag: string | null,
	cacheControl: string,
): Promise<Response | null> {
	const parts = range.replace(/bytes=/, "").split("-");
	const startStr = parts[0]!;
	const endStr = parts[1]!;

	let start = Number.parseInt(startStr, 10);
	let end = endStr ? Number.parseInt(endStr, 10) : totalSize - 1;

	if (Number.isNaN(start)) {
		start = totalSize - Number.parseInt(endStr, 10);
		end = totalSize - 1;
	}

	if (start < 0 || start >= totalSize || end < start || end >= totalSize) {
		return new Response(null, {
			status: 416,
			headers: { "content-range": `bytes */${totalSize}` },
		});
	}

	const chunkSize = end - start + 1;

	if (isBun) {
		const slice = Bun.file(filePath).slice(start, end + 1);
		const res = new Response(slice, {
			status: 206,
			headers: {
				"content-type": mimeType,
				"content-length": String(chunkSize),
				"content-range": `bytes ${start}-${end}/${totalSize}`,
				"cache-control": cacheControl,
				"accept-ranges": "bytes",
				...(etag ? { etag } : {}),
			},
		});
		return res;
	}

	const handle = await open(filePath, "r");
	const stream = handle.createReadStream({ start, end });
	const webStream = Readable.toWeb(stream);

	return new Response(webStream as unknown as ReadableStream, {
		status: 206,
		headers: {
			"content-type": mimeType,
			"content-length": String(chunkSize),
			"content-range": `bytes ${start}-${end}/${totalSize}`,
			"cache-control": cacheControl,
			"accept-ranges": "bytes",
			...(etag ? { etag } : {}),
		},
	});
}
