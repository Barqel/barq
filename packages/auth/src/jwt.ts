import { createHmac, timingSafeEqual } from "node:crypto";
import type {
	JwtHeader,
	JwtPayload,
	SignJwtOptions,
	VerifyJwtOptions,
} from "./types";

export class AuthError extends Error {
	constructor(
		message: string,
		public readonly code = "AUTH_ERROR",
		public readonly status = 401,
	) {
		super(message);
		this.name = "AuthError";
	}
}

function parseDuration(val: string | number): number {
	if (typeof val === "number") return Math.floor(val);
	const match = /^(\d+)(s|m|h|d|w|y)?$/i.exec(val.trim());
	if (!match)
		throw new AuthError(
			`Invalid duration string: ${val}`,
			"INVALID_DURATION",
			400,
		);
	const amount = Number.parseInt(match[1]!, 10);
	const unit = (match[2] ?? "s").toLowerCase();
	switch (unit) {
		case "s":
			return amount;
		case "m":
			return amount * 60;
		case "h":
			return amount * 3600;
		case "d":
			return amount * 86400;
		case "w":
			return amount * 604800;
		case "y":
			return amount * 31536000;
		default:
			return amount;
	}
}

function toBase64Url(input: string | Buffer): string {
	return (typeof input === "string" ? Buffer.from(input, "utf8") : input)
		.toString("base64")
		.replace(/=/g, "")
		.replace(/\+/g, "-")
		.replace(/\//g, "_");
}

function fromBase64Url(input: string): Buffer {
	let str = input.replace(/-/g, "+").replace(/_/g, "/");
	while (str.length % 4 !== 0) str += "=";
	return Buffer.from(str, "base64");
}

function getHmacAlgorithm(alg: "HS256" | "HS384" | "HS512"): string {
	switch (alg) {
		case "HS256":
			return "sha256";
		case "HS384":
			return "sha384";
		case "HS512":
			return "sha512";
		default:
			throw new AuthError(
				`Unsupported algorithm: ${alg}`,
				"UNSUPPORTED_ALG",
				400,
			);
	}
}

export function signJwt(
	payload: JwtPayload,
	secret: string,
	options: SignJwtOptions = {},
): string {
	if (!secret)
		throw new AuthError(
			"Secret key is required for JWT signing",
			"MISSING_SECRET",
			500,
		);

	const alg = options.algorithm ?? "HS256";
	const header: JwtHeader = { alg, typ: "JWT" };

	const now = Math.floor(Date.now() / 1000);
	const claims: JwtPayload = { ...payload };

	if (claims.iat === undefined) claims.iat = now;
	if (options.expiresIn !== undefined)
		claims.exp = now + parseDuration(options.expiresIn);
	if (options.notBefore !== undefined)
		claims.nbf = now + parseDuration(options.notBefore);
	if (options.issuer !== undefined) claims.iss = options.issuer;
	if (options.subject !== undefined) claims.sub = options.subject;
	if (options.audience !== undefined) claims.aud = options.audience;
	if (options.jwtId !== undefined) claims.jti = options.jwtId;

	const headerB64 = toBase64Url(JSON.stringify(header));
	const payloadB64 = toBase64Url(JSON.stringify(claims));
	const content = `${headerB64}.${payloadB64}`;

	const signature = createHmac(getHmacAlgorithm(alg), secret)
		.update(content)
		.digest();
	const sigB64 = toBase64Url(signature);

	return `${content}.${sigB64}`;
}

export function verifyJwt<T extends JwtPayload = JwtPayload>(
	token: string,
	secret: string,
	options: VerifyJwtOptions = {},
): T {
	if (!token || typeof token !== "string") {
		throw new AuthError(
			"Token must be a non-empty string",
			"INVALID_TOKEN",
			401,
		);
	}

	const parts = token.split(".");
	if (parts.length !== 3) {
		throw new AuthError(
			"Malformed JWT token structure",
			"MALFORMED_TOKEN",
			401,
		);
	}

	const [headerB64, payloadB64, sigB64] = parts as [string, string, string];

	let header: JwtHeader;
	let payload: T;
	try {
		header = JSON.parse(fromBase64Url(headerB64).toString("utf8")) as JwtHeader;
		payload = JSON.parse(fromBase64Url(payloadB64).toString("utf8")) as T;
	} catch {
		throw new AuthError(
			"Failed to parse token payload or header",
			"MALFORMED_TOKEN",
			401,
		);
	}

	if (header.typ !== "JWT") {
		throw new AuthError("Invalid token type", "INVALID_TOKEN_TYPE", 401);
	}

	const allowedAlgs = options.algorithms ?? ["HS256", "HS384", "HS512"];
	if (!allowedAlgs.includes(header.alg)) {
		throw new AuthError(
			`Algorithm ${header.alg} not permitted`,
			"ALGORITHM_NOT_ALLOWED",
			401,
		);
	}

	const content = `${headerB64}.${payloadB64}`;
	const expectedSig = createHmac(getHmacAlgorithm(header.alg), secret)
		.update(content)
		.digest();
	const providedSig = fromBase64Url(sigB64);

	if (
		expectedSig.length !== providedSig.length ||
		!timingSafeEqual(expectedSig, providedSig)
	) {
		throw new AuthError("Invalid token signature", "INVALID_SIGNATURE", 401);
	}

	const now = Math.floor(Date.now() / 1000);
	const tolerance = options.clockTolerance ?? 0;

	if (!options.ignoreExpiration && payload.exp !== undefined) {
		if (now > payload.exp + tolerance) {
			throw new AuthError("Token has expired", "TOKEN_EXPIRED", 401);
		}
	}

	if (payload.nbf !== undefined && now < payload.nbf - tolerance) {
		throw new AuthError("Token not yet active", "TOKEN_NOT_ACTIVE", 401);
	}

	if (options.issuer !== undefined) {
		const issuers = Array.isArray(options.issuer)
			? options.issuer
			: [options.issuer];
		if (!payload.iss || !issuers.includes(payload.iss)) {
			throw new AuthError("Token issuer mismatch", "INVALID_ISSUER", 401);
		}
	}

	if (options.audience !== undefined) {
		const audiences = Array.isArray(options.audience)
			? options.audience
			: [options.audience];
		const payloadAud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
		const match = audiences.some((aud) => payloadAud.includes(aud));
		if (!match) {
			throw new AuthError("Token audience mismatch", "INVALID_AUDIENCE", 401);
		}
	}

	return payload;
}

export function decodeJwt<T extends JwtPayload = JwtPayload>(
	token: string,
): { header: JwtHeader; payload: T } | null {
	const parts = token.split(".");
	if (parts.length !== 3) return null;
	try {
		const header = JSON.parse(
			fromBase64Url(parts[0]!).toString("utf8"),
		) as JwtHeader;
		const payload = JSON.parse(fromBase64Url(parts[1]!).toString("utf8")) as T;
		return { header, payload };
	} catch {
		return null;
	}
}
