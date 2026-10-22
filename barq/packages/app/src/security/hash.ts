// Password hashing — the `Hash` service.
//
//   import { Hash } from "@barq";
//
//   const hashed = await Hash.make("Hassan");
//   await Hash.check("Hassan", hashed); // → true
//   Hash.needsRehash(hashed);          // → false
//
// The driver comes from `HASH_DRIVER` (default "scrypt"):
//
// - "scrypt"   — `node:crypto`: one implementation on Bun and Node.js, so a
//                hash made on one runtime verifies on the other.
// - "bcrypt"   — `Bun.password` (Bun only). Work factor via `rounds`.
// - "argon2id" — `Bun.password` (Bun only). Cost via `memory`/`time`/`threads`.
//
// `check()` refuses a hash made with another algorithm (hash algorithm
// verification) — set `HASH_VERIFY=false` to allow several drivers at once,
// e.g. while migrating an existing database.
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/** Drivers the hasher can use. */
export type HashDriver = "scrypt" | "bcrypt" | "argon2id";

export interface HashOptions {
	/** bcrypt: work factor (4..31) — default 12. */
	rounds?: number;
	/** argon2id: memory cost in KiB — default 65536. */
	memory?: number;
	/** argon2id: time cost — default 2. */
	time?: number;
	/** argon2id: threads — default 1. */
	threads?: number;
	/** scrypt: cost factor N — default 16384. */
	cost?: number;
}

/** The hash was made with another algorithm than the configured driver. */
export class HashAlgorithmMismatchError extends Error {
	constructor(expected: HashDriver, found: HashDriver) {
		super(
			`Hash algorithm mismatch: expected "${expected}", got "${found}". ` +
				"Set HASH_VERIFY=false to allow several algorithms.",
		);
		this.name = "HashAlgorithmMismatchError";
	}
}

/** The stored hash cannot be parsed. */
export class InvalidHashError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "InvalidHashError";
	}
}

/** The driver needs a runtime the app is not running on. */
export class HashRuntimeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "HashRuntimeError";
	}
}

/** `HASH_DRIVER` (or another setting) is not usable. */
export class HashConfigurationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "HashConfigurationError";
	}
}

const SCRYPT_COST = 16384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const SCRYPT_KEY_LENGTH = 64;
const BCRYPT_ROUNDS = 12;
const BCRYPT_MAX_BYTES = 72;
const ARGON2_MEMORY = 65_536;
const ARGON2_TIME = 2;
const SALT_LENGTH = 16;

/**
 * Hashes and verifies passwords.
 *
 * Every method is static — `Hash.make("Hassan")` works without `new`, the
 * way the framework exposes the rest of its helpers.
 */
// biome-ignore lint/complexity/noStaticOnlyClass: the API is static by design
export class Hash {
	/** The driver this application hashes with (`HASH_DRIVER`). */
	static get driver(): HashDriver {
		return resolveDriver();
	}

	/** Hashes a password — the result carries the algorithm and its cost. */
	static async make(
		password: string,
		options: HashOptions = {},
	): Promise<string> {
		assertPassword(password);

		switch (Hash.driver) {
			case "scrypt":
				return makeScrypt(password, options);
			case "bcrypt":
				return makeBcrypt(password, options);
			case "argon2id":
				return makeArgon2(password, options);
		}
	}

	/** Checks a password against a stored hash. */
	static async check(password: string, hash: string): Promise<boolean> {
		const parsed = parseHash(hash);

		if (verifyAlgorithms() && parsed.driver !== Hash.driver) {
			throw new HashAlgorithmMismatchError(Hash.driver, parsed.driver);
		}

		switch (parsed.driver) {
			case "scrypt": {
				const key = await deriveScrypt(
					password,
					parsed.salt,
					parsed.key.length,
					{
						cost: parsed.cost,
						blockSize: parsed.blockSize,
						parallelization: parsed.parallelization,
					},
				);

				return equal(key, parsed.key);
			}
			case "bcrypt":
			case "argon2id":
				return bunPassword().verify(password, hash);
		}
	}

	/**
	 * True when the hash was made with cheaper parameters than the current
	 * ones — the moment to re-hash it during the next login.
	 */
	static needsRehash(hash: string, options: HashOptions = {}): boolean {
		const parsed = parseHash(hash);

		switch (parsed.driver) {
			case "scrypt":
				return parsed.cost < (options.cost ?? SCRYPT_COST);
			case "bcrypt":
				return parsed.cost < (options.rounds ?? BCRYPT_ROUNDS);
			case "argon2id":
				return (
					parsed.memory < (options.memory ?? ARGON2_MEMORY) ||
					parsed.time < (options.time ?? ARGON2_TIME)
				);
		}
	}
}

// --- internals -----------------------------------------------------------------

type ParsedHash =
	| {
			driver: "scrypt";
			cost: number;
			blockSize: number;
			parallelization: number;
			salt: Buffer;
			key: Buffer;
	  }
	| { driver: "bcrypt"; cost: number }
	| { driver: "argon2id"; memory: number; time: number; threads: number };

interface BunPasswordApi {
	hash(
		password: string,
		options?: {
			algorithm?: "argon2id" | "bcrypt";
			memoryCost?: number;
			timeCost?: number;
			cost?: number;
		},
	): Promise<string>;
	verify(password: string, hash: string): Promise<boolean>;
}

async function makeScrypt(
	password: string,
	options: HashOptions,
): Promise<string> {
	const cost = options.cost ?? SCRYPT_COST;
	const salt = randomBytes(SALT_LENGTH);
	const key = await deriveScrypt(password, salt, SCRYPT_KEY_LENGTH, {
		cost,
		blockSize: SCRYPT_BLOCK_SIZE,
		parallelization: SCRYPT_PARALLELIZATION,
	});

	return [
		"scrypt",
		cost,
		SCRYPT_BLOCK_SIZE,
		SCRYPT_PARALLELIZATION,
		salt.toString("base64url"),
		key.toString("base64url"),
	].join("$");
}

async function makeBcrypt(
	password: string,
	options: HashOptions,
): Promise<string> {
	// bcrypt ignores everything past 72 bytes — refuse instead of silently
	// hashing a truncated password.
	if (Buffer.byteLength(password, "utf8") > BCRYPT_MAX_BYTES) {
		throw new HashRuntimeError(
			`bcrypt only hashes the first ${BCRYPT_MAX_BYTES} bytes — use scrypt for longer passwords.`,
		);
	}

	return bunPassword().hash(password, {
		algorithm: "bcrypt",
		cost: options.rounds ?? BCRYPT_ROUNDS,
	});
}

async function makeArgon2(
	password: string,
	options: HashOptions,
): Promise<string> {
	return bunPassword().hash(password, {
		algorithm: "argon2id",
		memoryCost: options.memory ?? ARGON2_MEMORY,
		timeCost: options.time ?? ARGON2_TIME,
	});
}

function deriveScrypt(
	password: string,
	salt: Buffer,
	keyLength: number,
	params: { cost: number; blockSize: number; parallelization: number },
): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		scrypt(
			password,
			salt,
			keyLength,
			{
				N: params.cost,
				r: params.blockSize,
				p: params.parallelization,
				// 128 * N * r bytes are needed — give the allocator room to
				// spare so a tuned cost never trips the default cap.
				maxmem: 256 * params.cost * params.blockSize,
			},
			(error, derivedKey) => {
				if (error) {
					reject(error);
				} else {
					resolve(derivedKey);
				}
			},
		);
	});
}

function parseHash(hash: string): ParsedHash {
	const value = hash.trim();

	if (value.startsWith("scrypt$")) {
		const parts = value.split("$");

		if (parts.length !== 6) {
			throw new InvalidHashError("Malformed scrypt hash.");
		}

		return {
			driver: "scrypt",
			cost: toPositiveInt(parts[1]!),
			blockSize: toPositiveInt(parts[2]!),
			parallelization: toPositiveInt(parts[3]!),
			salt: Buffer.from(parts[4]!, "base64url"),
			key: Buffer.from(parts[5]!, "base64url"),
		};
	}

	if (value.startsWith("$argon2")) {
		// $argon2id$v=19$m=65536,t=2,p=1$<salt>$<hash>
		const parts = value.split("$");

		if (parts.length < 6) {
			throw new InvalidHashError("Malformed argon2 hash.");
		}

		const params = new Map<string, string>();

		for (const entry of parts[3]!.split(",")) {
			const [key, param] = entry.split("=");

			if (key !== undefined && param !== undefined) {
				params.set(key, param);
			}
		}

		return {
			driver: "argon2id",
			memory: toPositiveInt(params.get("m") ?? "0"),
			time: toPositiveInt(params.get("t") ?? "0"),
			threads: toPositiveInt(params.get("p") ?? "0"),
		};
	}

	if (/^\$2[aby]?\$\d{2}\$/.test(value)) {
		// $2b$12$<22 chars salt><31 chars hash>
		return { driver: "bcrypt", cost: toPositiveInt(value.split("$")[2]!) };
	}

	throw new InvalidHashError("Unrecognized hash format.");
}

function toPositiveInt(value: string): number {
	const parsed = Number.parseInt(value, 10);

	if (!Number.isFinite(parsed) || parsed <= 0) {
		throw new InvalidHashError(`Invalid number "${value}" in hash.`);
	}

	return parsed;
}

function equal(a: Buffer, b: Buffer): boolean {
	if (a.length !== b.length) {
		return false;
	}

	return timingSafeEqual(a, b);
}

function assertPassword(password: string): void {
	if (typeof password !== "string" || password.length === 0) {
		throw new TypeError("A password is required.");
	}
}

function resolveDriver(): HashDriver {
	const value = (process.env.HASH_DRIVER ?? "").trim().toLowerCase();

	if (value === "") {
		return "scrypt";
	}

	if (value === "scrypt" || value === "bcrypt" || value === "argon2id") {
		return value;
	}

	throw new HashConfigurationError(
		`Unknown HASH_DRIVER "${value}" — use scrypt, bcrypt or argon2id.`,
	);
}

/** Hash algorithm verification — disabled with `HASH_VERIFY=false`. */
function verifyAlgorithms(): boolean {
	const value = (process.env.HASH_VERIFY ?? "true").trim().toLowerCase();

	return value !== "false" && value !== "0" && value !== "no";
}

function bunPassword(): BunPasswordApi {
	const bun = (globalThis as { Bun?: { password?: BunPasswordApi } }).Bun;

	if (!bun?.password) {
		throw new HashRuntimeError(
			"This driver needs Bun's runtime (bcrypt and argon2id are implemented by Bun.password). Use HASH_DRIVER=scrypt for hashes that must verify on Node.js too.",
		);
	}

	return bun.password;
}
