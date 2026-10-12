import type { Context, Middleware } from "@barqel/barq";

export interface JwtHeader {
	alg: "HS256" | "HS384" | "HS512";
	typ: "JWT";
	[key: string]: unknown;
}

export interface JwtPayload {
	iss?: string;
	sub?: string;
	aud?: string | string[];
	exp?: number;
	nbf?: number;
	iat?: number;
	jti?: string;
	[key: string]: unknown;
}

export interface SignJwtOptions {
	algorithm?: "HS256" | "HS384" | "HS512";
	expiresIn?: string | number;
	notBefore?: string | number;
	issuer?: string;
	subject?: string;
	audience?: string | string[];
	jwtId?: string;
}

export interface VerifyJwtOptions {
	algorithms?: Array<"HS256" | "HS384" | "HS512">;
	issuer?: string | string[];
	audience?: string | string[];
	clockTolerance?: number;
	ignoreExpiration?: boolean;
}

export interface PasswordHashOptions {
	iterations?: number;
	saltLength?: number;
	keyLength?: number;
}

export interface BearerAuthOptions<TUser = JwtPayload> {
	secret: string | ((ctx: Context) => string | Promise<string>);
	optional?: boolean;
	headerName?: string;
	cookieName?: string;
	verifyOptions?: VerifyJwtOptions;
	resolveUser?: (payload: JwtPayload, ctx: Context) => TUser | Promise<TUser>;
}

export interface AuthPluginOptions {
	secret?: string;
	defaultExpiresIn?: string | number;
	cookieName?: string;
}
