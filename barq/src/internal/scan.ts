/**
 * Token-based lexical scanner + semantic analyzer for handler functions.
 * Runs ONCE per route at registration time. Zero dependencies.
 */

export interface LiteralInfo {
	kind: "string" | "json";
	value: string;
}

export type HandlerFunction = (...args: never[]) => unknown;
export type ParamSerializer = (
	params: Record<string, string> | string,
) => string;

export interface ParamEntry {
	key: string;
	isParam: boolean;
	paramKey?: string;
	literalValue?: string;
}

export interface HandlerAnalysis {
	isNoArg: boolean;
	contextProps: Set<string>;
	hasDynamicAccess: boolean;
	isDestructured: boolean;
	destructuredProps: Set<string>;
	literal: LiteralInfo | null;
	arglessJsonCall: boolean;
	isParamJson?: boolean;
	paramJsonKey?: string;
	paramSerializer?: ParamSerializer | null;
	paramParts?: ParamEntry[] | null;
}

interface Token {
	type: "ident" | "str" | "num" | "regex" | "punct" | "eof";
	value: string;
	start: number;
	end: number;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: JSON control chars must be escaped
export const ESCAPE_JSON_CHARS_RE = /[\u0000-\u001f"\\]/;

export function escapeJsonString(value: string): string {
	if (!ESCAPE_JSON_CHARS_RE.test(value)) return value;
	return JSON.stringify(value).slice(1, -1);
}

function isIdentStart(c: number): boolean {
	return (
		(c >= 97 && c <= 122) ||
		(c >= 65 && c <= 90) ||
		c === 95 ||
		c === 36 ||
		c > 127
	);
}
function isIdentPart(c: number): boolean {
	return isIdentStart(c) || (c >= 48 && c <= 57);
}
function isSpace(c: number): boolean {
	return c === 32 || c === 9 || c === 10 || c === 13 || c === 12 || c === 11;
}

const KEYWORDS_BEFORE_REGEX = new Set([
	"return",
	"typeof",
	"instanceof",
	"in",
	"of",
	"new",
	"delete",
	"void",
	"throw",
	"case",
	"do",
	"else",
	"yield",
	"await",
]);

const PUNCT_BEFORE_REGEX = new Set([
	"(",
	"[",
	"{",
	",",
	";",
	":",
	"?",
	"!",
	"=",
	"==",
	"===",
	"!=",
	"!==",
	"&&",
	"||",
	"??",
	"+",
	"-",
	"*",
	"/",
	"%",
	"&",
	"|",
	"^",
	"~",
	"<",
	">",
	"<=",
	">=",
	"=>",
	"+=",
	"-=",
	"*=",
	"/=",
	"%=",
	"&=",
	"|=",
	"^=",
	"&&=",
	"||=",
	"??=",
	"<<",
	">>",
	">>>",
	"<<=",
	">>=",
	">>>=",
]);

function tokenize(src: string): Token[] {
	const tokens: Token[] = [];
	const len = src.length;
	let i = 0;
	let last = "";

	while (i < len) {
		const c = src.charCodeAt(i);
		if (isSpace(c)) {
			i++;
			continue;
		}

		if (c === 47 && src.charCodeAt(i + 1) === 47) {
			i += 2;
			while (i < len && src.charCodeAt(i) !== 10) i++;
			continue;
		}
		if (c === 47 && src.charCodeAt(i + 1) === 42) {
			i += 2;
			while (
				i < len &&
				!(src.charCodeAt(i) === 42 && src.charCodeAt(i + 1) === 47)
			)
				i++;
			i += 2;
			continue;
		}

		if (c === 34 || c === 39) {
			const q = c;
			const start = i;
			i++;
			while (i < len) {
				const cc = src.charCodeAt(i);
				if (cc === 92) {
					i += 2;
					continue;
				}
				if (cc === q) {
					i++;
					break;
				}
				if (cc === 10) break;
				i++;
			}
			tokens.push({
				type: "str",
				value: src.slice(start + 1, i - 1),
				start,
				end: i,
			});
			last = "str";
			continue;
		}

		if (c === 96) {
			i = tokenizeTemplate(src, i, tokens);
			last = "template";
			continue;
		}

		if (c === 47) {
			let isRegex: boolean;
			if (last === "" || last === "regex" || last === "num") isRegex = true;
			else if (last === "str" || last === "template") isRegex = false;
			else if (last === "ident") isRegex = KEYWORDS_BEFORE_REGEX.has(last);
			else isRegex = PUNCT_BEFORE_REGEX.has(last);

			if (isRegex) {
				const start = i;
				i++;
				let inClass = false;
				while (i < len) {
					const cc = src.charCodeAt(i);
					if (cc === 92) {
						i += 2;
						continue;
					}
					if (cc === 91) {
						inClass = true;
						i++;
						continue;
					}
					if (cc === 93) {
						inClass = false;
						i++;
						continue;
					}
					if (cc === 47 && !inClass) {
						i++;
						break;
					}
					if (cc === 10) break;
					i++;
				}
				while (i < len && isIdentPart(src.charCodeAt(i))) i++;
				tokens.push({ type: "regex", value: "", start, end: i });
				last = "regex";
				continue;
			}
			tokens.push({ type: "punct", value: "/", start: i, end: i + 1 });
			last = "/";
			i++;
			continue;
		}

		if (isIdentStart(c)) {
			const start = i;
			i++;
			while (i < len && isIdentPart(src.charCodeAt(i))) i++;
			const value = src.slice(start, i);
			tokens.push({ type: "ident", value, start, end: i });
			last = value;
			continue;
		}

		if (c >= 48 && c <= 57) {
			const start = i;
			i++;
			while (i < len) {
				const cc = src.charCodeAt(i);
				if (
					(cc >= 48 && cc <= 57) ||
					cc === 46 ||
					cc === 95 ||
					(cc >= 97 && cc <= 122) ||
					(cc >= 65 && cc <= 90)
				)
					i++;
				else if (
					(cc === 43 || cc === 45) &&
					(src.charCodeAt(i - 1) === 101 || src.charCodeAt(i - 1) === 69)
				)
					i++;
				else break;
			}
			tokens.push({ type: "num", value: src.slice(start, i), start, end: i });
			last = "num";
			continue;
		}

		const start = i;
		const cc2 = src.charCodeAt(i + 1);
		const cc3 = src.charCodeAt(i + 2);
		const cc4 = src.charCodeAt(i + 3);
		let op = src[i]!;

		if (c === 62 && cc2 === 62 && cc3 === 62 && cc4 === 61) op = ">>>=";
		else if (c === 61 && cc2 === 61 && cc3 === 61) op = "===";
		else if (c === 33 && cc2 === 61 && cc3 === 61) op = "!==";
		else if (c === 42 && cc2 === 42 && cc3 === 61) op = "**=";
		else if (c === 60 && cc2 === 60 && cc3 === 61) op = "<<=";
		else if (c === 62 && cc2 === 62 && cc3 === 61) op = ">>=";
		else if (c === 62 && cc2 === 62 && cc3 === 62) op = ">>>";
		else if (c === 46 && cc2 === 46 && cc3 === 46) op = "...";
		else if (c === 63 && cc2 === 63 && cc3 === 61) op = "??=";
		else if (c === 38 && cc2 === 38 && cc3 === 61) op = "&&=";
		else if (c === 124 && cc2 === 124 && cc3 === 61) op = "||=";
		else if (c === 61 && cc2 === 62) op = "=>";
		else if (c === 61 && cc2 === 61) op = "==";
		else if (c === 33 && cc2 === 61) op = "!=";
		else if (c === 60 && cc2 === 61) op = "<=";
		else if (c === 62 && cc2 === 61) op = ">=";
		else if (c === 38 && cc2 === 38) op = "&&";
		else if (c === 124 && cc2 === 124) op = "||";
		else if (c === 63 && cc2 === 46) op = "?.";
		else if (c === 63 && cc2 === 63) op = "??";
		else if (c === 43 && cc2 === 43) op = "++";
		else if (c === 45 && cc2 === 45) op = "--";
		else if (c === 42 && cc2 === 42) op = "**";
		else if (c === 60 && cc2 === 60) op = "<<";
		else if (c === 62 && cc2 === 62) op = ">>";
		else if (c === 43 && cc2 === 61) op = "+=";
		else if (c === 45 && cc2 === 61) op = "-=";
		else if (c === 42 && cc2 === 61) op = "*=";
		else if (c === 47 && cc2 === 61) op = "/=";
		else if (c === 37 && cc2 === 61) op = "%=";
		else if (c === 38 && cc2 === 61) op = "&=";
		else if (c === 124 && cc2 === 61) op = "|=";
		else if (c === 94 && cc2 === 61) op = "^=";

		i += op.length;
		tokens.push({ type: "punct", value: op, start, end: i });
		last = op;
	}

	tokens.push({ type: "eof", value: "", start: len, end: len });
	return tokens;
}

function tokenizeTemplate(src: string, start: number, out: Token[]): number {
	let i = start + 1;
	const len = src.length;
	let strStart = i;

	while (i < len) {
		const c = src.charCodeAt(i);
		if (c === 92) {
			i += 2;
			continue;
		}
		if (c === 96) {
			if (i > strStart) {
				out.push({
					type: "str",
					value: src.slice(strStart, i),
					start: strStart,
					end: i,
				});
			}
			return i + 1;
		}
		if (c === 36 && src.charCodeAt(i + 1) === 123) {
			if (i > strStart) {
				out.push({
					type: "str",
					value: src.slice(strStart, i),
					start: strStart,
					end: i,
				});
			}
			out.push({ type: "punct", value: "${", start: i, end: i + 2 });
			i += 2;

			const exprStart = i;
			let depth = 1;
			while (i < len && depth > 0) {
				const cc = src.charCodeAt(i);
				if (cc === 92) {
					i += 2;
					continue;
				}
				if (cc === 34 || cc === 39) {
					const q = cc;
					i++;
					while (i < len) {
						const c2 = src.charCodeAt(i);
						if (c2 === 92) {
							i += 2;
							continue;
						}
						if (c2 === q) {
							i++;
							break;
						}
						i++;
					}
					continue;
				}
				if (cc === 96) {
					i = tokenizeTemplate(src, i, out);
					continue;
				}
				if (cc === 123) {
					depth++;
					i++;
					continue;
				}
				if (cc === 125) {
					depth--;
					if (depth === 0) break;
					i++;
					continue;
				}
				i++;
			}

			const inner = src.slice(exprStart, i);
			const innerTokens = tokenize(inner);
			for (const t of innerTokens) {
				if (t.type === "eof") continue;
				out.push({ ...t, start: t.start + exprStart, end: t.end + exprStart });
			}
			out.push({ type: "punct", value: "}", start: i, end: i + 1 });
			i++;
			strStart = i;
			continue;
		}
		i++;
	}

	if (i > strStart) {
		out.push({
			type: "str",
			value: src.slice(strStart, i),
			start: strStart,
			end: i,
		});
	}
	return i;
}

export function analyzeHandler(fn: HandlerFunction): HandlerAnalysis {
	let src: string;
	try {
		src = fn.toString();
	} catch {
		return makeUnknown();
	}

	const tokens = tokenize(src);
	let i = 0;

	if (tokens[i]?.type === "ident" && tokens[i]!.value === "async") i++;
	if (tokens[i]?.type === "ident" && tokens[i]!.value === "function") {
		i++;
		if (tokens[i]?.type === "ident") i++;
	}

	if (tokens[i]?.type === "punct" && tokens[i]!.value === "(") {
		i++;
		const first = tokens[i];

		if (first?.type === "punct" && first.value === ")") {
			i++;
			const body = walkBody(tokens, i, null);
			return {
				isNoArg: true,
				contextProps: new Set(),
				hasDynamicAccess: false,
				isDestructured: false,
				destructuredProps: new Set(),
				literal: body.literal,
				arglessJsonCall: false,
				paramSerializer: null,
				paramParts: null,
			};
		}

		if (first?.type === "punct" && first.value === "{") {
			const { names, next } = parseDestructure(tokens, i);
			const body = walkBody(tokens, next, null);
			return {
				isNoArg: false,
				contextProps: new Set(),
				hasDynamicAccess: false,
				isDestructured: true,
				destructuredProps: names,
				literal: body.literal,
				arglessJsonCall: false,
				paramSerializer: body.paramSerializer,
				paramParts: body.paramParts,
			};
		}

		if (first?.type === "ident") {
			const name = first.value;
			i++;
			const body = walkBody(tokens, i, name);
			return {
				isNoArg: false,
				contextProps: body.props,
				hasDynamicAccess: body.hasDynamic,
				isDestructured: false,
				destructuredProps: new Set(),
				literal: body.literal,
				arglessJsonCall: body.arglessJsonCall,
				paramSerializer: body.paramSerializer,
				paramParts: body.paramParts,
			};
		}

		return makeUnknown();
	}

	if (tokens[i]?.type === "ident") {
		const name = tokens[i]!.value;
		i++;
		const body = walkBody(tokens, i, name);
		return {
			isNoArg: false,
			contextProps: body.props,
			hasDynamicAccess: body.hasDynamic,
			isDestructured: false,
			destructuredProps: new Set(),
			literal: body.literal,
			arglessJsonCall: body.arglessJsonCall,
			paramSerializer: body.paramSerializer,
			paramParts: body.paramParts,
		};
	}

	return makeUnknown();
}

function parseDestructure(
	tokens: Token[],
	braceStart: number,
): { names: Set<string>; next: number } {
	const names = new Set<string>();
	let i = braceStart + 1;
	let depth = 1;
	while (i < tokens.length) {
		const t = tokens[i]!;
		if (t.type === "eof") break;
		if (t.type === "punct") {
			if (t.value === "{") depth++;
			else if (t.value === "}") {
				depth--;
				i++;
				if (depth === 0) break;
				continue;
			} else if (t.value === "[") depth += 100;
			else if (t.value === "]") depth -= 100;
		}
		if (t.type === "ident" && depth === 1) {
			const prev = tokens[i - 1];
			const next = tokens[i + 1];
			if (prev?.type === "punct" && prev.value === ":") {
				names.add(t.value);
			} else if (next?.type !== "punct" || next.value !== ":") {
				names.add(t.value);
			}
		}
		i++;
	}
	while (i < tokens.length) {
		const t = tokens[i]!;
		if (t.type === "eof") break;
		if (t.type === "punct" && t.value === ")") {
			i++;
			break;
		}
		i++;
	}
	return { names, next: i };
}

interface BodyResult {
	props: Set<string>;
	hasDynamic: boolean;
	literal: LiteralInfo | null;
	arglessJsonCall: boolean;
	paramSerializer: ParamSerializer | null;
	paramParts: ParamEntry[] | null;
}

function walkBody(
	tokens: Token[],
	from: number,
	paramName: string | null,
): BodyResult {
	const props = new Set<string>();
	let hasDynamic = false;
	let arglessJsonCall = false;

	let bodyStart = -1;
	let i = from;
	let parenDepth = 0;

	if (tokens[from]?.type === "punct" && tokens[from]!.value === "{") {
		bodyStart = from + 1;
	} else {
		while (i < tokens.length) {
			const t = tokens[i]!;
			if (t.type === "eof") break;
			if (t.type === "punct") {
				if (t.value === "(" || t.value === "[" || t.value === "{") {
					parenDepth++;
				} else if (t.value === ")" || t.value === "]" || t.value === "}") {
					if (parenDepth > 0) parenDepth--;
				} else if (t.value === "=>" && parenDepth === 0) {
					const next = tokens[i + 1];
					if (next?.type === "punct" && next.value === "{") {
						bodyStart = i + 2;
					} else {
						bodyStart = i + 1;
					}
					break;
				}
				if (t.value === ")" && parenDepth === 0 && i + 1 < tokens.length) {
					const next = tokens[i + 1];
					if (next?.type === "punct" && next.value === "{") {
						bodyStart = i + 2;
						break;
					}
				}
			}
			i++;
		}
	}

	if (bodyStart < 0) {
		return {
			props,
			hasDynamic,
			literal: null,
			arglessJsonCall: false,
			paramSerializer: null,
			paramParts: null,
		};
	}

	if (paramName !== null) {
		for (let j = bodyStart; j < tokens.length; j++) {
			const t = tokens[j]!;
			if (t.type === "eof") break;
			if (t.type !== "ident" || t.value !== paramName) continue;

			const n = tokens[j + 1];
			if (!n) continue;

			if (n.type === "punct" && (n.value === "." || n.value === "?.")) {
				const key = tokens[j + 2];
				if (key?.type === "ident") {
					props.add(key.value);

					if (key.value === "json") {
						const pOpen = tokens[j + 3];
						const pClose = tokens[j + 4];
						if (
							pOpen?.type === "punct" &&
							pOpen.value === "(" &&
							pClose?.type === "punct" &&
							pClose.value === ")"
						) {
							const prev1 = tokens[j - 1];
							const prev2 = tokens[j - 2];
							const isPrecededByReturn =
								(prev1?.type === "punct" && prev1.value === "=>") ||
								(prev1?.type === "ident" && prev1.value === "return") ||
								(prev1?.type === "ident" &&
									prev1.value === "await" &&
									((prev2?.type === "punct" && prev2.value === "=>") ||
										(prev2?.type === "ident" && prev2.value === "return")));

							const next1 = tokens[j + 5];
							const next2 = tokens[j + 6];
							const isEndOfBody =
								isBodyEnd(next1) && (next1?.value !== ";" || isBodyEnd(next2));

							if (isPrecededByReturn && isEndOfBody) {
								arglessJsonCall = true;
							}
						}
					}

					j += 2;
					continue;
				}
				hasDynamic = true;
				continue;
			}

			if (n.type === "punct" && n.value === "[") {
				const key = tokens[j + 2];
				const close = tokens[j + 3];
				if (
					key?.type === "str" &&
					close?.type === "punct" &&
					close.value === "]"
				) {
					props.add(key.value);
					j += 3;
					continue;
				}
				hasDynamic = true;
				continue;
			}

			const prev = tokens[j - 1];
			if (prev?.type === "punct" && prev.value === "...") {
				hasDynamic = true;
			}
		}
	}

	const literal = tryExtractLiteral(tokens, bodyStart);
	const paramExtraction =
		literal === null
			? tryExtractParamSerializer(tokens, bodyStart, paramName)
			: null;
	const paramSerializer = paramExtraction?.serializer ?? null;
	const paramParts = paramExtraction?.parts ?? null;

	return {
		props,
		hasDynamic,
		literal,
		arglessJsonCall,
		paramSerializer,
		paramParts,
	};
}

function isBodyEnd(t: Token | undefined): boolean {
	if (!t) return true;
	if (t.type === "eof") return true;
	if (t.type === "punct" && (t.value === ";" || t.value === "}")) return true;
	return false;
}

function tryExtractLiteral(
	tokens: Token[],
	bodyStart: number,
): LiteralInfo | null {
	const t = tokens[bodyStart];
	if (!t || t.type === "eof") return null;

	if (t.type === "ident" && t.value === "return") {
		return tryExtractLiteral(tokens, bodyStart + 1);
	}

	if (t.type === "str") {
		if (isBodyEnd(tokens[bodyStart + 1])) {
			return { kind: "string", value: t.value };
		}
		return null;
	}

	if (t.type === "punct" && t.value === "(") {
		const inner = tokens[bodyStart + 1];
		if (inner?.type === "punct" && inner.value === "{") {
			const obj = extractFlatObject(tokens, bodyStart + 1);
			if (!obj.ok) return null;
			const afterBrace = tokens[obj.end];
			if (afterBrace?.type !== "punct" || afterBrace.value !== ")") return null;
			if (!isBodyEnd(tokens[obj.end + 1])) return null;
			return { kind: "json", value: JSON.stringify(obj.value) };
		}
		return null;
	}

	if (t.type === "punct" && t.value === "{") {
		const next = tokens[bodyStart + 1];
		if (
			next &&
			(next.type === "ident" || next.type === "str" || next.type === "num") &&
			tokens[bodyStart + 2]?.type === "punct" &&
			tokens[bodyStart + 2]!.value === ":"
		) {
			const obj = extractFlatObject(tokens, bodyStart);
			if (obj.ok) {
				if (isBodyEnd(tokens[obj.end])) {
					return { kind: "json", value: JSON.stringify(obj.value) };
				}
				return null;
			}
			return null;
		}
		let j = bodyStart + 1;
		while (j < tokens.length) {
			const tt = tokens[j]!;
			if (tt.type === "eof") return null;
			if (tt.type === "punct" && tt.value === "}") return null;
			if (tt.type === "ident" && tt.value === "return") {
				return tryExtractLiteral(tokens, j + 1);
			}
			if (tt.type === "punct" && tt.value === ";") return null;
			if (tt.type === "ident" && tt.value !== "return") return null;
			j++;
		}
		return null;
	}

	return null;
}

interface FlatObjectResult {
	ok: true;
	end: number;
	value: Record<string, unknown>;
}
interface FlatObjectError {
	ok: false;
}

function extractFlatObject(
	tokens: Token[],
	braceStart: number,
): FlatObjectResult | FlatObjectError {
	let i = braceStart + 1;
	const obj: Record<string, unknown> = {};
	let expectKey = true;
	let key: string | null = null;

	while (i < tokens.length) {
		const t = tokens[i]!;
		if (t.type === "eof") return { ok: false };

		if (t.type === "punct" && t.value === "}") {
			if (!expectKey) return { ok: false };
			return { ok: true, end: i + 1, value: obj };
		}

		if (expectKey) {
			if (t.type === "ident" || t.type === "str" || t.type === "num")
				key = t.value;
			else return { ok: false };
			i++;
			const colon = tokens[i];
			if (colon?.type !== "punct" || colon.value !== ":") return { ok: false };
			i++;
			expectKey = false;
			continue;
		}

		if (t.type === "str") {
			obj[key!] = t.value;
			i++;
		} else if (t.type === "num") {
			obj[key!] = Number(t.value);
			i++;
		} else if (t.type === "ident") {
			if (t.value === "true") obj[key!] = true;
			else if (t.value === "false") obj[key!] = false;
			else if (t.value === "null") obj[key!] = null;
			else return { ok: false };
			i++;
		} else if (
			t.type === "punct" &&
			t.value === "!" &&
			tokens[i + 1]?.type === "num"
		) {
			const n = tokens[i + 1]!.value;
			obj[key!] = !Number(n);
			i += 2;
		} else if (
			t.type === "punct" &&
			t.value === "-" &&
			tokens[i + 1]?.type === "num"
		) {
			obj[key!] = -Number(tokens[i + 1]!.value);
			i += 2;
		} else {
			return { ok: false };
		}

		const sep = tokens[i];
		if (sep?.type === "punct" && sep.value === ",") {
			i++;
			expectKey = true;
			continue;
		}
		if (sep?.type === "punct" && sep.value === "}") {
			return { ok: true, end: i + 1, value: obj };
		}
		return { ok: false };
	}

	return { ok: false };
}

interface ParamObjectResult {
	ok: true;
	end: number;
	parts: ParamEntry[];
}

function extractParamObject(
	tokens: Token[],
	braceStart: number,
	paramName: string | null,
): ParamObjectResult | FlatObjectError {
	let i = braceStart + 1;
	const parts: ParamEntry[] = [];
	let expectKey = true;
	let key: string | null = null;
	let hasParam = false;

	while (i < tokens.length) {
		const t = tokens[i]!;
		if (t.type === "eof") return { ok: false };

		if (t.type === "punct" && t.value === "}") {
			if (!expectKey) return { ok: false };
			return hasParam ? { ok: true, end: i + 1, parts } : { ok: false };
		}

		if (expectKey) {
			if (t.type === "ident" || t.type === "str" || t.type === "num") {
				key = t.value;
			} else {
				return { ok: false };
			}
			i++;
			const colon = tokens[i];
			if (colon?.type !== "punct" || colon.value !== ":") return { ok: false };
			i++;
			expectKey = false;
			continue;
		}

		if (paramName !== null && t.type === "ident" && t.value === paramName) {
			const dot1 = tokens[i + 1];
			const pIdent = tokens[i + 2];
			const dot2 = tokens[i + 3];
			const pKey = tokens[i + 4];
			if (
				dot1?.type === "punct" &&
				(dot1.value === "." || dot1.value === "?.") &&
				pIdent?.type === "ident" &&
				pIdent.value === "params" &&
				dot2?.type === "punct" &&
				(dot2.value === "." || dot2.value === "?.") &&
				pKey?.type === "ident"
			) {
				hasParam = true;
				parts.push({ key: key!, isParam: true, paramKey: pKey.value });
				i += 5;
				const sep = tokens[i];
				if (sep?.type === "punct" && sep.value === ",") {
					i++;
					expectKey = true;
					continue;
				}
				if (sep?.type === "punct" && sep.value === "}") {
					return { ok: true, end: i + 1, parts };
				}
				return { ok: false };
			}
		}

		if (t.type === "ident" && t.value === "params") {
			const dot = tokens[i + 1];
			const pKey = tokens[i + 2];
			if (
				dot?.type === "punct" &&
				(dot.value === "." || dot.value === "?.") &&
				pKey?.type === "ident"
			) {
				hasParam = true;
				parts.push({ key: key!, isParam: true, paramKey: pKey.value });
				i += 3;
				const sep = tokens[i];
				if (sep?.type === "punct" && sep.value === ",") {
					i++;
					expectKey = true;
					continue;
				}
				if (sep?.type === "punct" && sep.value === "}") {
					return { ok: true, end: i + 1, parts };
				}
				return { ok: false };
			}
		}

		if (t.type === "str") {
			parts.push({
				key: key!,
				isParam: false,
				literalValue: JSON.stringify(t.value),
			});
			i++;
		} else if (t.type === "num") {
			parts.push({
				key: key!,
				isParam: false,
				literalValue: t.value,
			});
			i++;
		} else if (t.type === "ident") {
			if (t.value === "true" || t.value === "false" || t.value === "null") {
				parts.push({
					key: key!,
					isParam: false,
					literalValue: t.value,
				});
				i++;
			} else {
				return { ok: false };
			}
		} else if (
			t.type === "punct" &&
			t.value === "!" &&
			tokens[i + 1]?.type === "num"
		) {
			parts.push({
				key: key!,
				isParam: false,
				literalValue: tokens[i + 1]!.value === "0" ? "true" : "false",
			});
			i += 2;
		} else if (
			t.type === "punct" &&
			t.value === "-" &&
			tokens[i + 1]?.type === "num"
		) {
			parts.push({
				key: key!,
				isParam: false,
				literalValue: `-${tokens[i + 1]!.value}`,
			});
			i += 2;
		} else {
			return { ok: false };
		}

		const sep = tokens[i];
		if (sep?.type === "punct" && sep.value === ",") {
			i++;
			expectKey = true;
			continue;
		}
		if (sep?.type === "punct" && sep.value === "}") {
			return hasParam ? { ok: true, end: i + 1, parts } : { ok: false };
		}
		return { ok: false };
	}

	return { ok: false };
}

function buildParamSerializer(parts: ParamEntry[]): ParamSerializer {
	const chunks: string[] = [];
	const keys: string[] = [];
	let current = "{";

	for (let i = 0; i < parts.length; i++) {
		const part = parts[i]!;
		if (i > 0) current += ",";
		current += `${JSON.stringify(part.key)}:`;

		if (part.isParam) {
			current += '"';
			chunks.push(current);
			keys.push(part.paramKey!);
			current = '"';
		} else {
			current += part.literalValue!;
		}
	}
	current += "}";
	chunks.push(current);

	if (keys.length === 1) {
		const c0 = chunks[0]!;
		const c1 = chunks[1]!;
		const k0 = keys[0]!;
		return (p: Record<string, string> | string) =>
			c0 + escapeJsonString(typeof p === "string" ? p : (p[k0] ?? "")) + c1;
	}

	if (keys.length === 2) {
		const c0 = chunks[0]!;
		const c1 = chunks[1]!;
		const c2 = chunks[2]!;
		const k0 = keys[0]!;
		const k1 = keys[1]!;
		return (p: Record<string, string> | string) =>
			`${c0}${escapeJsonString(typeof p === "string" ? p : (p[k0] ?? ""))}${c1}${typeof p === "string" ? "" : escapeJsonString(p[k1] ?? "")}${c2}`;
	}

	return (p: Record<string, string> | string) => {
		let out = chunks[0]!;
		for (let j = 0; j < keys.length; j++) {
			out +=
				escapeJsonString(
					typeof p === "string" ? (j === 0 ? p : "") : (p[keys[j]!] ?? ""),
				) + chunks[j + 1]!;
		}
		return out;
	};
}

interface ParamSerializerResult {
	serializer: ParamSerializer;
	parts: ParamEntry[];
}

function tryExtractParamSerializer(
	tokens: Token[],
	bodyStart: number,
	paramName: string | null,
): ParamSerializerResult | null {
	const t = tokens[bodyStart];
	if (!t || t.type === "eof") return null;

	if (t.type === "punct" && t.value === "(") {
		const inner = tokens[bodyStart + 1];
		if (inner?.type === "punct" && inner.value === "{") {
			const res = extractParamObject(tokens, bodyStart + 1, paramName);
			if (!res.ok) return null;
			const afterBrace = tokens[res.end];
			if (afterBrace?.type !== "punct" || afterBrace.value !== ")") return null;
			if (!isBodyEnd(tokens[res.end + 1])) return null;
			return { serializer: buildParamSerializer(res.parts), parts: res.parts };
		}
		return null;
	}

	if (t.type === "punct" && t.value === "{") {
		const next = tokens[bodyStart + 1];
		if (
			next &&
			(next.type === "ident" || next.type === "str" || next.type === "num") &&
			tokens[bodyStart + 2]?.type === "punct" &&
			tokens[bodyStart + 2]!.value === ":"
		) {
			const res = extractParamObject(tokens, bodyStart, paramName);
			if (res.ok && isBodyEnd(tokens[res.end])) {
				return {
					serializer: buildParamSerializer(res.parts),
					parts: res.parts,
				};
			}
			return null;
		}
		let j = bodyStart + 1;
		while (j < tokens.length) {
			const tt = tokens[j]!;
			if (tt.type === "eof") return null;
			if (tt.type === "punct" && tt.value === "}") return null;
			if (tt.type === "ident" && tt.value === "return") {
				return tryExtractParamSerializer(tokens, j + 1, paramName);
			}
			if (tt.type === "punct" && tt.value === ";") return null;
			if (tt.type === "ident" && tt.value !== "return") return null;
			j++;
		}
		return null;
	}

	return null;
}

function makeUnknown(): HandlerAnalysis {
	return {
		isNoArg: false,
		contextProps: new Set(),
		hasDynamicAccess: true,
		isDestructured: false,
		destructuredProps: new Set(),
		literal: null,
		arglessJsonCall: false,
		paramSerializer: null,
		paramParts: null,
	};
}
