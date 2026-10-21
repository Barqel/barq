// Encryption — the `Crypt` service.
//
//   import { Crypt } from "@barq";
//
//   const payload = Crypt.encryptString("sk_live_123");
//   Crypt.decryptString(payload); // → "sk_live_123"
//
// AES-256-CBC (AES-128-CBC with a 16-byte key) + HMAC-SHA256, in Laravel's
// payload layout: base64(mac ‖ iv ‖ ciphertext). The MAC covers the IV and
// the ciphertext, so a tampered payload never decrypts.
//
// The key comes from `APP_KEY` (base64, 32 bytes — the `base64:` prefix is
// optional). `APP_PREVIOUS_KEYS` holds the retired keys: decryption tries the
// current key first, then every previous one, so rotating the key never
// breaks the values already stored.
import {
	createCipheriv,
	createDecipheriv,
	createHmac,
	randomBytes,
	timingSafeEqual,
} from "node:crypto";

/** The payload is malformed, tampered with, or no key can decrypt it. */
export class DecryptException extends Error {
	constructor(message: string) {
		super(message);
		this.name = "DecryptException";
	}
}

/** `APP_KEY` is missing or malformed. */
export class EncryptionKeyError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "EncryptionKeyError";
	}
}

const MAC_LENGTH = 32;
const IV_LENGTH = 16;

interface ResolvedKey {
	key: Buffer;
	cipher: "aes-256-cbc" | "aes-128-cbc";
}

/**
 * Encrypts and decrypts strings.
 *
 * Every method is static — `Crypt.encryptString("secret")` works without
 * `new`.
 */
// biome-ignore lint/complexity/noStaticOnlyClass: the API is static by design
export class Crypt {
	/** Encrypts a string — the payload decrypts with the same key. */
	static encryptString(value: string): string {
		const key = currentKey();
		const iv = randomBytes(IV_LENGTH);
		const cipher = createCipheriv(key.cipher, key.key, iv);
		const cipherText = Buffer.concat([
			cipher.update(value, "utf8"),
			cipher.final(),
		]);
		const mac = createHmac("sha256", key.key)
			.update(Buffer.concat([iv, cipherText]))
			.digest();

		return Buffer.concat([mac, iv, cipherText]).toString("base64");
	}

	/** Decrypts a payload — tries the current key, then the previous ones. */
	static decryptString(payload: string): string {
		const raw = Buffer.from(payload, "base64");

		if (raw.length <= MAC_LENGTH + IV_LENGTH) {
			throw new DecryptException("The payload is malformed.");
		}

		const mac = raw.subarray(0, MAC_LENGTH);
		const iv = raw.subarray(MAC_LENGTH, MAC_LENGTH + IV_LENGTH);
		const cipherText = raw.subarray(MAC_LENGTH + IV_LENGTH);

		for (const key of allKeys()) {
			const expected = createHmac("sha256", key.key)
				.update(Buffer.concat([iv, cipherText]))
				.digest();

			if (!timingSafeEqual(mac, expected)) {
				continue;
			}

			const decipher = createDecipheriv(key.cipher, key.key, iv);

			try {
				return Buffer.concat([
					decipher.update(cipherText),
					decipher.final(),
				]).toString("utf8");
			} catch {
				throw new DecryptException("The payload could not be decrypted.");
			}
		}

		throw new DecryptException(
			"The MAC is invalid — the payload was tampered with, or no configured key can decrypt it.",
		);
	}
}

// --- internals -----------------------------------------------------------------

function allKeys(): ResolvedKey[] {
	const keys: ResolvedKey[] = [];
	const current = process.env.APP_KEY?.trim();

	if (current) {
		keys.push(parseKey(current));
	}

	const previous = process.env.APP_PREVIOUS_KEYS ?? "";

	for (const entry of previous.split(",")) {
		const value = entry.trim();

		if (value !== "") {
			keys.push(parseKey(value));
		}
	}

	return keys;
}

function currentKey(): ResolvedKey {
	const [key] = allKeys();

	if (!key) {
		throw new EncryptionKeyError(
			"APP_KEY is not set — generate one with `bun run cli key:generate`.",
		);
	}

	return key;
}

function parseKey(value: string): ResolvedKey {
	const raw = value.trim().replace(/^base64:/i, "");
	const decoded = Buffer.from(raw, "base64");

	if (decoded.length === 32) {
		return { key: decoded, cipher: "aes-256-cbc" };
	}

	if (decoded.length === 16) {
		return { key: decoded, cipher: "aes-128-cbc" };
	}

	throw new EncryptionKeyError(
		"APP_KEY must be a base64 string decoding to 16 bytes (AES-128) or 32 bytes (AES-256).",
	);
}
