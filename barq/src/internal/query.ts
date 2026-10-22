function decodeQueryComponent(value: string): string {
	const hasPlus = value.indexOf("+") !== -1;
	const hasPercent = value.indexOf("%") !== -1;
	if (!hasPlus && !hasPercent) return value;
	const formValue = hasPlus ? value.replace(/\+/g, " ") : value;
	if (!hasPercent) return formValue;
	try {
		return decodeURIComponent(formValue);
	} catch {
		return new URLSearchParams(`v=${value}`).get("v") ?? "";
	}
}

export function findQueryParam(
	url: string,
	name: string,
	startPos?: number,
): string | null {
	const queryStart =
		startPos !== undefined && startPos >= 0 ? startPos : url.indexOf("?");
	if (queryStart === -1) return null;

	const hashPos = url.indexOf("#", queryStart);
	const len = hashPos === -1 ? url.length : hashPos;
	let s = queryStart + 1;
	const nameLen = name.length;

	while (s < len) {
		if (url.startsWith(name, s)) {
			const eqPos = s + nameLen;
			if (eqPos >= len) return "";
			const nextChar = url.charCodeAt(eqPos);
			if (nextChar === 61) {
				const valStart = eqPos + 1;
				let amp = url.indexOf("&", valStart);
				if (amp === -1 || amp > len) amp = len;
				const val = url.slice(valStart, amp);
				if (val.indexOf("+") === -1 && val.indexOf("%") === -1) {
					return val;
				}
				return decodeQueryComponent(val);
			}
			if (nextChar === 38) {
				return "";
			}
		}

		const amp = url.indexOf("&", s);
		if (amp === -1 || amp >= len) break;
		s = amp + 1;
	}
	return null;
}

export function findQueryParamAll(url: string, name: string): string[] {
	const res: string[] = [];
	const queryStart = url.indexOf("?");
	if (queryStart === -1) return res;
	const hashPos = url.indexOf("#", queryStart);
	const len = hashPos === -1 ? url.length : hashPos;
	let s = queryStart + 1;
	const nLen = name.length;

	while (s < len) {
		let amp = url.indexOf("&", s);
		if (amp === -1 || amp > len) amp = len;
		let eq = url.indexOf("=", s);
		if (eq === -1 || eq > amp) eq = amp;
		if (eq - s === nLen && url.startsWith(name, s)) {
			const val = eq < amp ? url.slice(eq + 1, amp) : "";
			if (val.indexOf("%") === -1 && val.indexOf("+") === -1) {
				res.push(val);
			} else {
				try {
					res.push(decodeURIComponent(val.replace(/\+/g, " ")));
				} catch {
					res.push(val);
				}
			}
		}
		s = amp + 1;
	}
	return res;
}

export function parseAllQueryParams(url: string): Record<string, string> {
	const qIdx = url.indexOf("?");
	if (qIdx === -1) return Object.create(null);
	const hashPos = url.indexOf("#", qIdx);
	const len = hashPos === -1 ? url.length : hashPos;
	const res: Record<string, string> = Object.create(null);
	let s = qIdx + 1;

	while (s < len) {
		let amp = url.indexOf("&", s);
		if (amp === -1 || amp > len) amp = len;
		let eq = url.indexOf("=", s);
		if (eq === -1 || eq > amp) eq = amp;
		const k = decodeQueryComponent(url.slice(s, eq));
		const v = eq < amp ? decodeQueryComponent(url.slice(eq + 1, amp)) : "";
		if (res[k] === undefined) res[k] = v;
		s = amp + 1;
	}
	return res;
}

export function parseFastQuery(
	url: string,
	startPos: number,
): Record<string, string> {
	const out: Record<string, string> = Object.create(null);
	const hashPos = url.indexOf("#", startPos);
	const len = hashPos === -1 ? url.length : hashPos;
	let s = startPos;

	while (s < len) {
		let eq = url.indexOf("=", s);
		if (eq === -1 || eq > len) eq = len;
		let amp = url.indexOf("&", eq < len ? eq + 1 : s);
		if (amp === -1 || amp > len) amp = len;
		const k = url.slice(s, eq);
		const v = eq < amp ? url.slice(eq + 1, amp) : "";
		out[k] =
			v.indexOf("+") === -1 && v.indexOf("%") === -1
				? v
				: decodeURIComponent(v.replace(/\+/g, " "));
		s = amp + 1;
	}
	return out;
}
