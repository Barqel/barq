import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import type { PasswordHashOptions } from "./types";

export function hashPassword(
	password: string,
	options: PasswordHashOptions = {},
): string {
	const iterations = options.iterations ?? 100_000;
	const saltLength = options.saltLength ?? 16;
	const keyLength = options.keyLength ?? 32;

	const salt = randomBytes(saltLength).toString("hex");
	const derivedKey = pbkdf2Sync(
		password,
		salt,
		iterations,
		keyLength,
		"sha256",
	).toString("hex");

	return `$pbkdf2$${iterations}$${salt}$${derivedKey}`;
}

export function verifyPassword(
	password: string,
	serializedHash: string,
): boolean {
	const parts = serializedHash.split("$");
	if (parts.length !== 5 || parts[1] !== "pbkdf2") return false;

	const iterations = Number.parseInt(parts[2]!, 10);
	const salt = parts[3]!;
	const originalHash = parts[4]!;

	if (!iterations || !salt || !originalHash) return false;

	const keyLength = Buffer.from(originalHash, "hex").length;
	const derivedKey = pbkdf2Sync(
		password,
		salt,
		iterations,
		keyLength,
		"sha256",
	).toString("hex");

	const origBuf = Buffer.from(originalHash, "hex");
	const derivedBuf = Buffer.from(derivedKey, "hex");

	if (origBuf.length !== derivedBuf.length) return false;
	return timingSafeEqual(origBuf, derivedBuf);
}
