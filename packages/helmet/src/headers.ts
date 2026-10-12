import type { CspDirectives, HelmetOptions } from "./types";

const DEFAULT_CSP_DIRECTIVES: CspDirectives = {
	defaultSrc: ["'self'"],
	baseUri: ["'self'"],
	fontSrc: ["'self'", "https:", "data:"],
	formAction: ["'self'"],
	frameAncestors: ["'self'"],
	imgSrc: ["'self'", "data:"],
	objectSrc: ["'none'"],
	scriptSrc: ["'self'"],
	scriptSrcAttr: ["'none'"],
	styleSrc: ["'self'", "https:", "'unsafe-inline'"],
	upgradeInsecureRequests: true,
};

function formatCspDirectiveName(name: string): string {
	return name.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

function buildCspHeader(directives: CspDirectives): string {
	const parts: string[] = [];

	for (const [key, value] of Object.entries(directives)) {
		if (value === undefined || value === false) continue;
		const name = formatCspDirectiveName(key);

		if (value === true) {
			parts.push(name);
			continue;
		}

		if (Array.isArray(value)) {
			if (value.length > 0) {
				parts.push(`${name} ${value.join(" ")}`);
			}
			continue;
		}

		if (typeof value === "string") {
			parts.push(`${name} ${value}`);
		}
	}

	return parts.join("; ");
}

export function buildHelmetHeaders(options: HelmetOptions = {}): Record<string, string> {
	const headers: Record<string, string> = {};

	if (options.xContentTypeOptions !== false) {
		headers["x-content-type-options"] = "nosniff";
	}

	if (options.xFrameOptions !== false) {
		const action = typeof options.xFrameOptions === "string" ? options.xFrameOptions : "SAMEORIGIN";
		headers["x-frame-options"] = action;
	}

	if (options.strictTransportSecurity !== false) {
		const opts = typeof options.strictTransportSecurity === "object" ? options.strictTransportSecurity : {};
		const maxAge = opts.maxAge ?? 31536000;
		let val = `max-age=${maxAge}`;
		if (opts.includeSubDomains !== false) val += "; includeSubDomains";
		if (opts.preload) val += "; preload";
		headers["strict-transport-security"] = val;
	}

	if (options.xDownloadOptions !== false) {
		headers["x-download-options"] = "noopen";
	}

	if (options.xPermittedCrossDomainPolicies !== false) {
		const policy = typeof options.xPermittedCrossDomainPolicies === "string" ? options.xPermittedCrossDomainPolicies : "none";
		headers["x-permitted-cross-domain-policies"] = policy;
	}

	if (options.xDnsPrefetchControl !== false) {
		const control = typeof options.xDnsPrefetchControl === "string" ? options.xDnsPrefetchControl : "off";
		headers["x-dns-prefetch-control"] = control;
	}

	if (options.xXssProtection !== false) {
		headers["x-xss-protection"] = "0";
	}

	if (options.originAgentCluster !== false) {
		headers["origin-agent-cluster"] = "?1";
	}

	if (options.crossOriginEmbedderPolicy) {
		const policy = typeof options.crossOriginEmbedderPolicy === "string" ? options.crossOriginEmbedderPolicy : "require-corp";
		headers["cross-origin-embedder-policy"] = policy;
	}

	if (options.crossOriginOpenerPolicy !== false) {
		const policy = typeof options.crossOriginOpenerPolicy === "string" ? options.crossOriginOpenerPolicy : "same-origin";
		headers["cross-origin-opener-policy"] = policy;
	}

	if (options.crossOriginResourcePolicy !== false) {
		const policy = typeof options.crossOriginResourcePolicy === "string" ? options.crossOriginResourcePolicy : "same-origin";
		headers["cross-origin-resource-policy"] = policy;
	}

	if (options.referrerPolicy !== false) {
		let policy = "no-referrer";
		if (Array.isArray(options.referrerPolicy)) {
			policy = options.referrerPolicy.join(", ");
		} else if (typeof options.referrerPolicy === "string") {
			policy = options.referrerPolicy;
		}
		headers["referrer-policy"] = policy;
	}

	if (options.contentSecurityPolicy !== false && options.contentSecurityPolicy !== undefined) {
		const cspOpts = typeof options.contentSecurityPolicy === "object" ? options.contentSecurityPolicy : {};
		const directives = cspOpts.directives ? { ...DEFAULT_CSP_DIRECTIVES, ...cspOpts.directives } : DEFAULT_CSP_DIRECTIVES;
		const headerName = cspOpts.reportOnly ? "content-security-policy-report-only" : "content-security-policy";
		headers[headerName] = buildCspHeader(directives);
	}

	return headers;
}
