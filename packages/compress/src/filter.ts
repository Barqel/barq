import type { Context } from "@barqel/barq";

const COMPRESSIBLE_REGEX = /^(text\/|application\/(json|javascript|xml|wasm|x-javascript)|image\/svg\+xml)/i;

export function defaultCompressFilter(contentType: string, _ctx: Context): boolean {
	if (!contentType) return false;
	return COMPRESSIBLE_REGEX.test(contentType);
}
