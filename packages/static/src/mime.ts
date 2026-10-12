const MIME_MAP: Record<string, string> = {
	html: "text/html; charset=utf-8",
	htm: "text/html; charset=utf-8",
	css: "text/css; charset=utf-8",
	js: "application/javascript; charset=utf-8",
	mjs: "application/javascript; charset=utf-8",
	json: "application/json; charset=utf-8",
	map: "application/json; charset=utf-8",
	svg: "image/svg+xml",
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	avif: "image/avif",
	ico: "image/x-icon",
	txt: "text/plain; charset=utf-8",
	xml: "application/xml; charset=utf-8",
	pdf: "application/pdf",
	wasm: "application/wasm",
	woff: "font/woff",
	woff2: "font/woff2",
	ttf: "font/ttf",
	otf: "font/otf",
	mp3: "audio/mpeg",
	mp4: "video/mp4",
	webm: "video/webm",
	zip: "application/zip",
	tar: "application/x-tar",
	gz: "application/gzip",
};

export function getMimeType(filePath: string): string {
	const lastDot = filePath.lastIndexOf(".");
	if (lastDot === -1) return "application/octet-stream";
	const ext = filePath.slice(lastDot + 1).toLowerCase();
	return MIME_MAP[ext] ?? "application/octet-stream";
}
