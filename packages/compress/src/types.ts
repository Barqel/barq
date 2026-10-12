import type { Context } from "@barqel/barq";

export type CompressionAlgorithm = "br" | "gzip" | "deflate" | "identity";

export interface CompressOptions {
	threshold?: number;
	encodings?: CompressionAlgorithm[];
	filter?: (contentType: string, ctx: Context) => boolean;
}
