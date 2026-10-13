import { resolve, sep } from "node:path";

export function sanitizePath(
	baseDir: string,
	requestedPath: string,
): string | null {
	if (requestedPath.includes("\0")) {
		return null;
	}

	const decoded = safeDecodeURIComponent(requestedPath);
	if (decoded === null) {
		return null;
	}

	const normalized = decoded.replace(/\\/g, "/");
	const absolutePath = resolve(
		baseDir,
		`.${normalized.startsWith("/") ? "" : "/"}${normalized}`,
	);
	const canonicalBase = resolve(baseDir);

	if (
		absolutePath !== canonicalBase &&
		!absolutePath.startsWith(`${canonicalBase}${sep}`)
	) {
		return null;
	}

	return absolutePath;
}

export function isDotFile(path: string): boolean {
	const segments = path.split(/[\/\\]/);
	for (const segment of segments) {
		if (segment.startsWith(".") && segment !== "." && segment !== "..") {
			return true;
		}
	}
	return false;
}

function safeDecodeURIComponent(uri: string): string | null {
	try {
		return decodeURIComponent(uri);
	} catch {
		return null;
	}
}
