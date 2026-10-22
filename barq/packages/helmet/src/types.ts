export interface CspDirectives {
	defaultSrc?: string[];
	scriptSrc?: string[];
	styleSrc?: string[];
	imgSrc?: string[];
	connectSrc?: string[];
	fontSrc?: string[];
	objectSrc?: string[];
	mediaSrc?: string[];
	frameSrc?: string[];
	childSrc?: string[];
	formAction?: string[];
	frameAncestors?: string[];
	baseUri?: string[];
	manifestSrc?: string[];
	workerSrc?: string[];
	upgradeInsecureRequests?: boolean;
	blockAllMixedContent?: boolean;
	[key: string]: string[] | boolean | string | undefined;
}

export interface StrictTransportSecurityOptions {
	maxAge?: number;
	includeSubDomains?: boolean;
	preload?: boolean;
}

export interface ContentSecurityPolicyOptions {
	directives?: CspDirectives;
	reportOnly?: boolean;
}

export interface HelmetOptions {
	contentSecurityPolicy?: boolean | ContentSecurityPolicyOptions;
	crossOriginEmbedderPolicy?:
		| boolean
		| "require-corp"
		| "credentialless"
		| "unsafe-none";
	crossOriginOpenerPolicy?:
		| boolean
		| "same-origin"
		| "same-origin-allow-popups"
		| "unsafe-none";
	crossOriginResourcePolicy?:
		| boolean
		| "same-origin"
		| "same-site"
		| "cross-origin";
	originAgentCluster?: boolean;
	referrerPolicy?: boolean | string | string[];
	strictTransportSecurity?: boolean | StrictTransportSecurityOptions;
	xContentTypeOptions?: boolean;
	xDnsPrefetchControl?: boolean | "on" | "off";
	xDownloadOptions?: boolean;
	xFrameOptions?: boolean | "DENY" | "SAMEORIGIN";
	xPermittedCrossDomainPolicies?:
		| boolean
		| "none"
		| "master-only"
		| "by-content-type"
		| "all";
	xPoweredBy?: boolean;
	xXssProtection?: boolean;
}
