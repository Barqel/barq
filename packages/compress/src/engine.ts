import { Readable } from "node:stream";
import { createBrotliCompress } from "node:zlib";
import type { CompressionAlgorithm } from "./types";

export function compressStream(
	stream: ReadableStream<Uint8Array>,
	algorithm: CompressionAlgorithm,
): ReadableStream<Uint8Array> {
	if (algorithm === "gzip") {
		return stream.pipeThrough(
			new CompressionStream(
				"gzip",
			) as unknown as ReadableWritablePair<Uint8Array>,
		);
	}

	if (algorithm === "deflate") {
		return stream.pipeThrough(
			new CompressionStream(
				"deflate",
			) as unknown as ReadableWritablePair<Uint8Array>,
		);
	}

	if (algorithm === "br") {
		const nodeReadable = Readable.fromWeb(stream as any);
		const brotli = createBrotliCompress();
		const piped = nodeReadable.pipe(brotli);
		return Readable.toWeb(piped) as unknown as ReadableStream<Uint8Array>;
	}

	return stream;
}
