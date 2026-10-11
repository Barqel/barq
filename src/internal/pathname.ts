export interface ParsedTarget {
	pathname: string;
	query: string | undefined;
}

function decodeSegment(seg: string): string {
	if (seg.indexOf("%") === -1) return seg;
	try {
		return decodeURIComponent(seg);
	} catch {
		return seg;
	}
}

function decodePercentSegment(seg: string): string {
	try {
		return decodeURIComponent(seg);
	} catch {
		return seg;
	}
}

function isDotSegment(seg: string): boolean {
	return seg === "." || seg === "..";
}

function hasDotSegment(path: string): boolean {
	let i = 0;
	const len = path.length;
	while (i < len) {
		while (i < len && path.charCodeAt(i) === 47) i++;
		if (i >= len) break;
		const endIdx = path.indexOf("/", i);
		const segEnd = endIdx === -1 ? len : endIdx;
		const segmentLength = segEnd - i;
		if (
			(segmentLength === 1 && path.charCodeAt(i) === 46) ||
			(segmentLength === 2 &&
				path.charCodeAt(i) === 46 &&
				path.charCodeAt(i + 1) === 46)
		) {
			return true;
		}

		const percent = path.indexOf("%", i);
		if (percent !== -1 && percent < segEnd) {
			const decoded = decodePercentSegment(path.slice(i, segEnd));
			if (isDotSegment(decoded)) return true;
		}
		if (endIdx === -1) break;
		i = endIdx + 1;
	}
	return false;
}

export function hasEncodedSlash(path: string): boolean {
	return path.includes("%2f") || path.includes("%2F");
}

function targetStart(url: string): number {
	if (url.charCodeAt(0) === 47) return 0;
	if (
		url.charCodeAt(4) === 58 &&
		url.charCodeAt(5) === 47 &&
		url.charCodeAt(6) === 47
	)
		return 7;
	if (
		url.charCodeAt(5) === 58 &&
		url.charCodeAt(6) === 47 &&
		url.charCodeAt(7) === 47
	)
		return 8;
	const scheme = url.indexOf("://");
	return scheme === -1 ? 0 : scheme + 3;
}

export function normalizeDotSegments(path: string): string {
	const len = path.length;
	const segments: string[] = [];
	let start = 0;

	while (start < len) {
		while (start < len && path.charCodeAt(start) === 47) start++;
		if (start >= len) break;
		const end = path.indexOf("/", start);
		const segEnd = end === -1 ? len : end;
		const rawSeg = path.slice(start, segEnd);
		const decodedSeg = decodeSegment(rawSeg);

		if (decodedSeg === ".") {
		} else if (decodedSeg === "..") {
			segments.pop();
		} else {
			segments.push(rawSeg);
		}
		if (end === -1) break;
		start = end + 1;
	}

	const res = `/${segments.join("/")}`;
	const endsWithSlash =
		path.endsWith("/") || path.endsWith("/.") || path.endsWith("/..");
	return path.length > 1 && endsWithSlash && res !== "/" ? `${res}/` : res;
}

export function scanPathname(url: string): string {
	const s = targetStart(url);
	const slash = url.indexOf("/", s);
	if (slash === -1) return "/";
	let end = url.indexOf("?", slash);
	if (end === -1) {
		end = url.indexOf("#", slash);
		if (end === -1) end = url.length;
	} else {
		const hash = url.indexOf("#", slash);
		if (hash !== -1 && hash < end) end = hash;
	}
	const raw = url.slice(slash, end);
	if (raw.indexOf(".") === -1 && raw.indexOf("%") === -1) return raw;

	if (hasEncodedSlash(raw)) {
		return raw;
	}

	return hasDotSegment(raw) ? normalizeDotSegments(raw) : raw;
}

export function parseRequestTarget(url: string): ParsedTarget {
	const s = targetStart(url);
	const slash = url.indexOf("/", s);

	let pathname: string;
	let query: string | undefined;

	if (slash === -1) {
		pathname = "/";
		const q = url.indexOf("?", s);
		const h = url.indexOf("#", s);
		if (q !== -1 && (h === -1 || q < h)) {
			query = h === -1 ? url.slice(q + 1) : url.slice(q + 1, h);
		}
	} else {
		let end = url.indexOf("?", slash);
		const hash = url.indexOf("#", slash);

		if (hash !== -1 && (end === -1 || hash < end)) end = hash;

		if (end === -1) {
			end = url.length;
		} else if (url.charCodeAt(end) === 63) {
			query =
				hash !== -1 && hash > end
					? url.slice(end + 1, hash)
					: url.slice(end + 1);
		}

		const raw = url.slice(slash, end);

		if (hasEncodedSlash(raw)) {
			pathname = raw;
		} else {
			pathname = hasDotSegment(raw) ? normalizeDotSegments(raw) : raw;
		}
	}

	return { pathname, query };
}
