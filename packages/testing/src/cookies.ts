import type { ParsedSetCookie } from "./types";

export function parseSetCookieHeaders(headers: Headers): Map<string, ParsedSetCookie> {
	const map = new Map<string, ParsedSetCookie>();
	const rawCookies: string[] = [];

	if (typeof (headers as any).getSetCookie === "function") {
		const list = (headers as any).getSetCookie();
		if (Array.isArray(list)) {
			rawCookies.push(...list);
		}
	} else {
		const single = headers.get("set-cookie");
		if (single) {
			rawCookies.push(single);
		}
	}

	for (const raw of rawCookies) {
		const parts = raw.split(";").map((p) => p.trim());
		const first = parts[0];
		if (!first) continue;

		const eqIdx = first.indexOf("=");
		if (eqIdx === -1) continue;

		const name = first.slice(0, eqIdx).trim();
		const value = decodeURIComponent(first.slice(eqIdx + 1).trim());

		const cookie: ParsedSetCookie = { name, value };

		for (let i = 1; i < parts.length; i++) {
			const part = parts[i]!;
			const sep = part.indexOf("=");
			const key = (sep === -1 ? part : part.slice(0, sep)).trim().toLowerCase();
			const val = sep === -1 ? "" : part.slice(sep + 1).trim();

			if (key === "path") cookie.path = val;
			else if (key === "domain") cookie.domain = val;
			else if (key === "max-age") cookie.maxAge = Number.parseInt(val, 10);
			else if (key === "expires") cookie.expires = new Date(val);
			else if (key === "httponly") cookie.httpOnly = true;
			else if (key === "secure") cookie.secure = true;
			else if (key === "samesite") cookie.sameSite = val as any;
		}

		map.set(name, cookie);
	}

	return map;
}
