import { createBrotliCompress } from "node:zlib";
import { Readable } from "node:stream";
import type { CompressionAlgorithm } from "./types";

export function compressStream(
	stream: ReadableStream<Uint8Array>,
	algorithm: CompressionAlgorithm,
): ReadableStream<Uint8Array> {
	if (algorithm === "gzip") {
		return stream.pipeThrough(new CompressionStream("gzip"));
	}

	if (algorithm === "deflate") {
		return stream.pipeThrough(new CompressionStream("deflate"));
	}

	if (algorithm === "br") {
		const nodeReadable = Readable.fromWeb(stream as any);
		const brotli = createBrotliCompress();
		const piped = nodeReadable.pipe(brotli);
		return Readable.toWeb(piped) as unknown as ReadableStream<Uint8Array>;
	}

	return stream;
}
