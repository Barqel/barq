export function computeEtag(buffer: ArrayBuffer | Uint8Array | string): string {
	const hasher = new Bun.CryptoHasher("sha1");
	hasher.update(buffer);
	const hash = hasher.digest("hex").slice(0, 27);
	return `W/"${hash}"`;
}
