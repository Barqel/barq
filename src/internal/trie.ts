import { HttpError } from "../errors";
import type { HttpMethod, ResponseHandler } from "../types";

export const MATCH_HANDLER: unique symbol = Symbol("barq.match.handler");

export const MATCH_NOT_ALLOWED: unique symbol = Symbol(
	"barq.match.not-allowed",
);

export type RouteParams = Record<string, string> & {
	[MATCH_HANDLER]?: ResponseHandler;
};

export interface NotAllowed {
	readonly [MATCH_NOT_ALLOWED]: string;
}

export type RouteResult = ResponseHandler | RouteParams | NotAllowed | null;

const METHOD_BITS: Record<HttpMethod, number> = {
	GET: 1 << 0,
	POST: 1 << 1,
	PUT: 1 << 2,
	DELETE: 1 << 3,
	PATCH: 1 << 4,
	HEAD: 1 << 5,
	OPTIONS: 1 << 6,
};

const _ALL_METHODS_BITMASK = (1 << 7) - 1;
// Linear key checks beat substring creation only at very small fanout.
const STATIC_CHILD_SCAN_THRESHOLD = 4;

function methodBit(method: HttpMethod): number {
	return METHOD_BITS[method] ?? 0;
}

function _hasMethod(bits: number, method: HttpMethod): boolean {
	return (bits & methodBit(method)) !== 0;
}

function _methodsToString(bits: number): string {
	const methods: string[] = [];
	if (bits & METHOD_BITS.GET) methods.push("GET");
	if (bits & METHOD_BITS.POST) methods.push("POST");
	if (bits & METHOD_BITS.PUT) methods.push("PUT");
	if (bits & METHOD_BITS.DELETE) methods.push("DELETE");
	if (bits & METHOD_BITS.PATCH) methods.push("PATCH");
	if (bits & METHOD_BITS.HEAD) methods.push("HEAD");
	if (bits & METHOD_BITS.OPTIONS) methods.push("OPTIONS");
	return methods.join(", ");
}

interface TrieNode {
	staticChildren: Map<string, TrieNode> | null;
	staticChildKeys: string[];
	staticChildNodes: TrieNode[];
	paramChildren: Map<string, TrieNode> | null;
	paramChild: TrieNode | null;
	paramName: string | null;
	wildcardChild: TrieNode | null;
	wildcardName: string | null;
	handlers: Record<string, ResponseHandler> | null;
	allow: string | null;
	notAllowed: NotAllowed | null;
}

function createNode(): TrieNode {
	return {
		staticChildren: null,
		staticChildKeys: [],
		staticChildNodes: [],
		paramChildren: null,
		paramChild: null,
		paramName: null,
		wildcardChild: null,
		wildcardName: null,
		handlers: null,
		allow: null,
		notAllowed: null,
	};
}

function cloneNode(node: TrieNode): TrieNode {
	const staticChildren = node.staticChildren
		? new Map(
				Array.from(node.staticChildren, ([key, child]) => [
					key,
					cloneNode(child),
				]),
			)
		: null;
	const staticChildKeys = node.staticChildKeys.slice();
	const staticChildNodes = staticChildren
		? staticChildKeys.map((key) => staticChildren.get(key)!)
		: [];
	const paramChildren = node.paramChildren
		? new Map(
				Array.from(node.paramChildren, ([name, child]) => [
					name,
					cloneNode(child),
				]),
			)
		: null;
	let handlers: Record<string, ResponseHandler> | null = null;
	if (node.handlers !== null) {
		handlers = Object.assign(Object.create(null), node.handlers) as Record<
			string,
			ResponseHandler
		>;
	}
	return {
		staticChildren,
		staticChildKeys,
		staticChildNodes,
		paramChildren,
		paramChild: node.paramChild ? cloneNode(node.paramChild) : null,
		paramName: node.paramName,
		wildcardChild: node.wildcardChild ? cloneNode(node.wildcardChild) : null,
		wildcardName: node.wildcardName,
		handlers,
		allow: node.allow,
		notAllowed: node.notAllowed,
	};
}

type PatternSegment =
	| { readonly kind: "static"; readonly value: string }
	| {
			readonly kind: "param";
			readonly name: string;
			readonly optional?: boolean;
	  }
	| { readonly kind: "wildcard"; readonly name: string | null };

const MAX_OPTIONAL_PARAMS = 8;

export function parsePattern(pattern: string): PatternSegment[] {
	if (pattern.length === 0 || pattern.charCodeAt(0) !== 47) {
		throw new Error(`Invalid route pattern "${pattern}": must start with '/'`);
	}
	if (pattern.indexOf("#") !== -1) {
		throw new Error(`Invalid route pattern "${pattern}": must not contain '#'`);
	}
	let p = pattern;
	if (p.length > 1 && p.charCodeAt(p.length - 1) === 47) {
		p = p.slice(0, -1);
	}

	const segments: PatternSegment[] = [];
	const names = new Set<string>();
	let i = 1;
	while (i < p.length) {
		const slash = p.indexOf("/", i);
		const end = slash === -1 ? p.length : slash;
		const seg = p.slice(i, end);
		if (seg.length === 0) {
			throw new Error(
				`Invalid route pattern "${pattern}": empty segment ('//')`,
			);
		}
		const c0 = seg.charCodeAt(0);
		if (
			seg.includes("?") &&
			!(c0 === 58 && seg.endsWith("?") && seg.indexOf("?") === seg.length - 1)
		) {
			throw new Error(
				`Invalid route pattern "${pattern}": malformed optional parameter`,
			);
		}
		if (c0 === 58) {
			const optional = seg.endsWith("?");
			const name = optional ? seg.slice(1, -1) : seg.slice(1);
			if (name.length === 0) {
				throw new Error(
					`Invalid route pattern "${pattern}": empty parameter name in segment ":${name}"`,
				);
			}
			if (names.has(name)) {
				throw new Error(
					`Invalid route pattern "${pattern}": duplicate parameter name "${name}"`,
				);
			}
			names.add(name);
			if (name.includes("?")) {
				throw new Error(
					`Invalid route pattern "${pattern}": malformed optional parameter`,
				);
			}
			segments.push(
				optional
					? { kind: "param", name, optional: true }
					: { kind: "param", name },
			);
		} else if (c0 === 42) {
			if (end !== p.length) {
				throw new Error(
					`Invalid route pattern "${pattern}": wildcard '*' must be the final segment`,
				);
			}
			const name = seg.length > 1 ? seg.slice(1) : null;
			if (name !== null) {
				if (names.has(name)) {
					throw new Error(
						`Invalid route pattern "${pattern}": duplicate parameter name "${name}"`,
					);
				}
				names.add(name);
			}
			segments.push({ kind: "wildcard", name });
		} else {
			segments.push({ kind: "static", value: seg });
		}
		i = end + 1;
	}
	const optionalCount = segments.reduce(
		(count, segment) =>
			count + (segment.kind === "param" && segment.optional ? 1 : 0),
		0,
	);
	if (optionalCount > MAX_OPTIONAL_PARAMS) {
		throw new RangeError(
			`Route pattern exceeds the limit of ${MAX_OPTIONAL_PARAMS} optional parameters`,
		);
	}
	return segments;
}

function _segmentEquals(
	path: string,
	start: number,
	end: number,
	key: string,
): boolean {
	const n = end - start;
	if (key.length !== n) return false;
	for (let i = 0; i < n; i++) {
		if (path.charCodeAt(start + i) !== key.charCodeAt(i)) return false;
	}
	return true;
}

function decodeParam(raw: string): string {
	if (raw.indexOf("%") === -1) return raw;
	try {
		return decodeURIComponent(raw);
	} catch {
		throw new HttpError(400, { error: "Bad Request" });
	}
}

function matchNode(
	rootNode: TrieNode,
	pathname: string,
	startI: number,
	method: string,
	paramNames: string[],
	paramValues: string[],
	startDepth: number,
): RouteResult {
	let node = rootNode;
	let i = startI;
	const depth = startDepth;
	while (true) {
		const len = pathname.length;
		if (i >= len) {
			const handlers = node.handlers;
			if (handlers === null) return null;

			let handler = handlers[method];
			if (handler === undefined && method === "HEAD") {
				handler = handlers.GET;
			}
			if (handler === undefined) {
				return node.notAllowed;
			}
			if (depth === 0) return handler;

			const p = Object.create(null) as RouteParams;
			p[MATCH_HANDLER] = handler;
			for (let k = 0; k < depth; k++) {
				p[paramNames[k]!] = paramValues[k]!;
			}
			return p;
		}

		const slash = pathname.indexOf("/", i);
		const segEnd = slash === -1 ? len : slash;

		if (segEnd === i) {
			// A single trailing slash is accepted; empty interior segments are not.
			if (slash === len - 1) {
				return matchNode(
					node,
					pathname,
					len,
					method,
					paramNames,
					paramValues,
					depth,
				);
			}
			return null;
		}

		const nextI = slash === -1 ? len : slash + 1;
		let notAllowedCandidate: NotAllowed | null = null;

		const staticChildren = node.staticChildren;
		if (staticChildren !== null) {
			let child: TrieNode | undefined;
			if (staticChildren.size <= STATIC_CHILD_SCAN_THRESHOLD) {
				const keys = node.staticChildKeys;
				const nodes = node.staticChildNodes;
				for (let childIndex = 0; childIndex < keys.length; childIndex++) {
					if (_segmentEquals(pathname, i, segEnd, keys[childIndex]!)) {
						child = nodes[childIndex];
						break;
					}
				}
			} else {
				child = staticChildren.get(pathname.slice(i, segEnd));
			}
			if (child !== undefined) {
				const hasParamChildren =
					node.paramChildren !== null && node.paramChildren.size > 0;
				if (!hasParamChildren && node.wildcardChild === null) {
					node = child;
					i = nextI;
					continue;
				}
				const res = matchNode(
					child,
					pathname,
					nextI,
					method,
					paramNames,
					paramValues,
					depth,
				);
				if (res !== null) {
					if (MATCH_NOT_ALLOWED in res) {
						notAllowedCandidate = res as NotAllowed;
					} else {
						return res;
					}
				}
			}
		}

		const paramChildren =
			node.paramChildren ??
			(node.paramChild !== null && node.paramName !== null
				? new Map([[node.paramName, node.paramChild]])
				: null);
		if (paramChildren !== null && paramChildren.size > 0) {
			for (const [paramName, child] of paramChildren) {
				if (nextI >= len && child.handlers !== null) {
					let leafH = child.handlers[method];
					if (leafH === undefined && method === "HEAD")
						leafH = child.handlers.GET;
					if (leafH !== undefined) {
						const paramVal =
							pathname.indexOf("%", i) !== -1
								? decodeParam(pathname.slice(i, segEnd))
								: pathname.slice(i, segEnd);
						const p: RouteParams = {
							[paramName]: paramVal,
							[MATCH_HANDLER]: leafH,
						};
						if (depth === 0) return p;
						for (let k = 0; k < depth; k++) {
							p[paramNames[k]!] = paramValues[k]!;
						}
						return p;
					}
				}

				paramNames[depth] = paramName;
				paramValues[depth] = decodeParam(pathname.slice(i, segEnd));

				const res = matchNode(
					child,
					pathname,
					nextI,
					method,
					paramNames,
					paramValues,
					depth + 1,
				);
				if (res !== null) {
					if (MATCH_NOT_ALLOWED in res) {
						notAllowedCandidate ??= res as NotAllowed;
					} else {
						return res;
					}
				}
			}
		}

		if (node.wildcardChild !== null) {
			let wildcardDepth = depth;
			if (node.wildcardName !== null) {
				let rest = pathname.slice(i);
				if (rest.length > 1 && rest.charCodeAt(rest.length - 1) === 47) {
					rest = rest.slice(0, -1);
				}
				paramNames[wildcardDepth] = node.wildcardName;
				paramValues[wildcardDepth] = decodeParam(rest);
				wildcardDepth++;
			}
			const handlers = node.wildcardChild.handlers;
			if (handlers !== null) {
				let handler = handlers[method];
				if (handler === undefined && method === "HEAD") {
					handler = handlers.GET;
				}
				if (handler === undefined) {
					return node.wildcardChild.notAllowed;
				}
				if (wildcardDepth === 0) return handler;

				const p = Object.create(null) as RouteParams;
				for (let k = 0; k < wildcardDepth; k++) {
					p[paramNames[k]!] = paramValues[k]!;
				}
				p[MATCH_HANDLER] = handler;
				return p;
			}
		}

		return notAllowedCandidate;
	}
}

export class SegmentTrie {
	private root: TrieNode = createNode();
	private staticRoutes = new Map<string, Record<string, ResponseHandler>>();
	private staticNotAllowed = new Map<string, NotAllowed>();
	private maxStaticLength = 0;
	private readonly paramNameBuffer: string[] = [];
	private readonly paramValueBuffer: string[] = [];

	addBatch(
		routes: readonly {
			method: HttpMethod;
			pattern: string;
			handler: ResponseHandler;
		}[],
	): void {
		if (routes.length === 0) return;
		if (routes.length === 1) {
			const route = routes[0]!;
			this.add(route.method, route.pattern, route.handler);
			return;
		}

		const staged = this.clone();
		const parsedPatterns = new Map<string, readonly PatternSegment[]>();
		for (const route of routes) {
			let segments = parsedPatterns.get(route.pattern);
			if (segments === undefined) {
				segments = parsePattern(route.pattern);
				parsedPatterns.set(route.pattern, segments);
			}
			staged.addWithSegments(
				route.method,
				route.pattern,
				segments,
				route.handler,
			);
		}
		this.root = staged.root;
		this.staticRoutes = staged.staticRoutes;
		this.staticNotAllowed = staged.staticNotAllowed;
		this.maxStaticLength = staged.maxStaticLength;
	}

	private clone(): SegmentTrie {
		const copy = new SegmentTrie();
		copy.root = cloneNode(this.root);
		copy.staticRoutes = new Map(
			Array.from(this.staticRoutes, ([path, handlers]) => [
				path,
				Object.assign(Object.create(null), handlers) as Record<
					string,
					ResponseHandler
				>,
			]),
		);
		copy.staticNotAllowed = new Map(this.staticNotAllowed);
		copy.maxStaticLength = this.maxStaticLength;
		return copy;
	}

	add(method: HttpMethod, pattern: string, handler: ResponseHandler): void {
		const segments = parsePattern(pattern);
		let optionalCount = 0;
		for (const segment of segments) {
			if (segment.kind === "param" && segment.optional) optionalCount++;
		}
		if (optionalCount === 0) {
			this.addParsed(method, pattern, segments, handler, false);
			return;
		}

		const staged = this.clone();
		staged.addWithSegments(method, pattern, segments, handler);
		this.root = staged.root;
		this.staticRoutes = staged.staticRoutes;
		this.staticNotAllowed = staged.staticNotAllowed;
	}

	private addWithSegments(
		method: HttpMethod,
		pattern: string,
		segments: readonly PatternSegment[],
		handler: ResponseHandler,
	): void {
		let optionalCount = 0;
		for (const segment of segments) {
			if (segment.kind === "param" && segment.optional) optionalCount++;
		}
		if (optionalCount === 0) {
			this.addParsed(method, pattern, segments, handler, false);
			return;
		}

		const selected: PatternSegment[] = [];
		const addVariants = (index: number): void => {
			if (index === segments.length) {
				const variant =
					selected.length === 0
						? "/"
						: `/${selected.map((segment) => (segment.kind === "static" ? segment.value : segment.kind === "param" ? `:${segment.name}` : `*${segment.name ?? ""}`)).join("/")}`;
				this.addParsed(method, variant, selected, handler, true);
				return;
			}
			const segment = segments[index]!;
			if (segment.kind === "param" && segment.optional) {
				selected.push({ kind: "param", name: segment.name });
				addVariants(index + 1);
				selected.pop();
				addVariants(index + 1);
				return;
			}
			selected.push(segment);
			addVariants(index + 1);
			selected.pop();
		};
		addVariants(0);
	}

	private addParsed(
		method: HttpMethod,
		pattern: string,
		segments: readonly PatternSegment[],
		handler: ResponseHandler,
		_allowConflictingParamNames: boolean,
	): void {
		const bit = methodBit(method);
		if (bit === 0) {
			throw new Error(
				`Unsupported HTTP method "${method}" for route "${pattern}"`,
			);
		}

		const isPureStatic = segments.every((s) => s.kind === "static");
		let cleanPattern: string;
		if (isPureStatic) {
			cleanPattern =
				pattern.length > 1 && pattern.charCodeAt(pattern.length - 1) === 47
					? pattern.slice(0, -1)
					: pattern;
			if (cleanPattern.length > this.maxStaticLength) {
				this.maxStaticLength = cleanPattern.length;
			}
		}

		for (const seg of segments) {
			if (seg.kind === "static") {
			} else if (seg.kind === "param") {
				if (isPureStatic) {
					throw new Error(`Internal error: param segment in pure static route`);
				}
			} else {
				if (isPureStatic) {
					throw new Error(
						`Internal error: wildcard segment in pure static route`,
					);
				}
			}
		}

		let node = this.root;
		for (const seg of segments) {
			if (seg.kind === "static") {
				if (node.staticChildren === null) {
					node.staticChildren = new Map();
				}
				let child = node.staticChildren.get(seg.value);
				if (child === undefined) {
					child = createNode();
					node.staticChildren.set(seg.value, child);
					node.staticChildKeys.push(seg.value);
					node.staticChildNodes.push(child);
				}
				node = child;
			} else if (seg.kind === "param") {
				if (node.wildcardChild !== null) {
					throw new Error(
						`Ambiguous routes: wildcard "${node.wildcardName ?? "*"}" and param ":${seg.name}" compete at the same position in "${pattern}"`,
					);
				}
				if (node.paramChildren === null) {
					node.paramChildren = new Map();
				}
				let child = node.paramChildren.get(seg.name);
				if (child === undefined) {
					child = createNode();
					node.paramChildren.set(seg.name, child);
					if (node.paramChild === null && node.paramChildren.size === 1) {
						node.paramChild = child;
						node.paramName = seg.name;
					} else {
						node.paramChild = null;
						node.paramName = null;
					}
				}
				node = child;
			} else {
				if (node.wildcardChild !== null) {
					if (node.wildcardName !== seg.name) {
						throw new Error(
							`Conflicting wildcards at the same position: "*${node.wildcardName ?? ""}" vs "*${seg.name ?? ""}" (route "${pattern}")`,
						);
					}
				} else {
					if (node.paramChildren !== null && node.paramChildren.size > 0) {
						const existingParam = node.paramChildren.keys().next().value;
						if (existingParam !== undefined) {
							throw new Error(
								`Ambiguous routes: param ":${existingParam}" and wildcard "*${seg.name ?? ""}" compete at the same position in "${pattern}"`,
							);
						}
					}
					node.wildcardChild = createNode();
					node.wildcardName = seg.name;
				}
				node = node.wildcardChild;
			}
		}

		if (node.handlers?.[method] !== undefined) {
			throw new Error(
				`Duplicate route: ${method} ${pattern} is already registered`,
			);
		}
		if (node.handlers === null) node.handlers = Object.create(null);
		node.handlers![method] = handler;
		node.allow = SegmentTrie.computeAllow(node.handlers!);
		node.notAllowed = Object.freeze({
			[MATCH_NOT_ALLOWED]: node.allow,
		}) as NotAllowed;

		if (isPureStatic) {
			let sHandlers = this.staticRoutes.get(cleanPattern!);
			if (sHandlers === undefined) {
				sHandlers = Object.create(null) as Record<string, ResponseHandler>;
				this.staticRoutes.set(cleanPattern!, sHandlers);
			}
			sHandlers[method] = handler;
			const sAllow = SegmentTrie.computeAllow(sHandlers);
			this.staticNotAllowed.set(
				cleanPattern!,
				Object.freeze({ [MATCH_NOT_ALLOWED]: sAllow }) as NotAllowed,
			);
		}
	}

	static computeAllow(handlers: Record<string, ResponseHandler>): string {
		const methods = Object.keys(handlers);
		if (methods.includes("GET") && !methods.includes("HEAD")) {
			return [...methods, "HEAD"].join(", ");
		}
		return methods.join(", ");
	}

	match(method: string, pathname: string): RouteResult {
		const len = pathname.length;
		const cleanPath =
			len > 1 && pathname.charCodeAt(len - 1) === 47
				? pathname.slice(0, -1)
				: pathname;

		if (cleanPath.length <= this.maxStaticLength) {
			const sHandlers = this.staticRoutes.get(cleanPath);
			if (sHandlers !== undefined) {
				let handler = sHandlers[method];
				if (handler === undefined && method === "HEAD") {
					handler = sHandlers.GET;
				}
				if (handler !== undefined) {
					return handler;
				}
				const dynamicMatch = matchNode(
					this.root,
					pathname,
					1,
					method,
					this.paramNameBuffer,
					this.paramValueBuffer,
					0,
				);
				if (this.paramNameBuffer.length > 0) {
					this.paramNameBuffer.length = 0;
					this.paramValueBuffer.length = 0;
				}
				if (dynamicMatch !== null && !(MATCH_NOT_ALLOWED in dynamicMatch)) {
					return dynamicMatch;
				}
				return this.staticNotAllowed.get(cleanPath)!;
			}
		}

		const res = matchNode(
			this.root,
			pathname,
			1,
			method,
			this.paramNameBuffer,
			this.paramValueBuffer,
			0,
		);
		if (this.paramNameBuffer.length > 0) {
			this.paramNameBuffer.length = 0;
			this.paramValueBuffer.length = 0;
		}
		return res;
	}
}
