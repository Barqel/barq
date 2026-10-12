import type { Context, Middleware } from "@barqel/barq";
import { compressStream } from "./engine";
import { negotiateEncoding } from "./encoding";
import { defaultCompressFilter } from "./filter";
import type { CompressOptions, CompressionAlgorithm } from "./types";

export function compress(options: CompressOptions = {}): Middleware {
	const threshold = options.threshold ?? 1024;
	const supportedEncodings: CompressionAlgorithm[] = options.encodings ?? ["br", "gzip", "deflate"];
	const filterFn = options.filter ?? defaultCompressFilter;

	return {
		async after(ctx: Context, res: Response) {
			if (ctx.req.method === "HEAD") return res;
			if (res.status === 204 || res.status === 205 || res.status === 304 || res.body === null) return res;
			if (res.headers.has("content-encoding")) return res;

			const contentType = res.headers.get("content-type") ?? "";
			if (!filterFn(contentType, ctx)) return res;

			const encoding = negotiateEncoding(ctx.req.headers.get("accept-encoding"), supportedEncodings);
			if (!encoding || encoding === "identity") return res;

			const rawLength = res.headers.get("content-length");
			if (rawLength !== null) {
				const lengthNum = Number.parseInt(rawLength, 10);
				if (!Number.isNaN(lengthNum) && lengthNum < threshold) {
					return res;
				}
			}

			const compressedStream = compressStream(res.body, encoding);
			const headers = new Headers(res.headers);

			headers.set("content-encoding", encoding);
			headers.delete("content-length");

			const currentVary = headers.get("vary");
			if (!currentVary) {
				headers.set("vary", "Accept-Encoding");
			} else if (!currentVary.toLowerCase().includes("accept-encoding")) {
				headers.set("vary", `${currentVary}, Accept-Encoding`);
			}

			return new Response(compressedStream, {
				status: res.status,
				statusText: res.statusText,
				headers,
			});
		},
	};
}
