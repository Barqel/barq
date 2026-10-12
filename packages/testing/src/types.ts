export type QueryValue = string | number | boolean;
export type QueryParams = Record<string, QueryValue | QueryValue[]>;

export interface TestRequestOptions {
	headers?: Record<string, string> | Headers;
	query?: QueryParams;
	json?: unknown;
	body?: BodyInit | null;
	cookies?: Record<string, string>;
	ip?: string;
}

export interface ParsedSetCookie {
	name: string;
	value: string;
	path?: string;
	domain?: string;
	maxAge?: number;
	expires?: Date;
	httpOnly?: boolean;
	secure?: boolean;
	sameSite?: "Strict" | "Lax" | "None";
}

export type TestResponse = Response & {
	cookies: Map<string, ParsedSetCookie>;
	header(name: string): string | null;
};

export interface TestClientOptions {
	baseUrl?: string;
	defaultHeaders?: Record<string, string>;
	defaultIp?: string;
}
