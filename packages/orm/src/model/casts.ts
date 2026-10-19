// Attribute casts.
//
// A cast converts values in both directions:
//
//   get(databaseValue) → attributeValue   (applied while hydrating)
//   set(attributeValue) → databaseValue   (applied while writing)
//
// Built-in casts: boolean, json, array, date, datetime, decimal, number,
// string, encrypted, hashed. A model can also declare a custom cast object:
//
//   static casts = {
//     settings: { get: (v) => JSON.parse(String(v)), set: (v) => JSON.stringify(v) },
//   };
//
// `encrypted` requires `new Orm({ ..., encryptionKey: "…" })` and uses
// AES-256-GCM; `hashed` uses salted scrypt and is verified with
// `verifyHashedValue(plain, stored)`.

import {
	createCipheriv,
	createDecipheriv,
	createHash,
	randomBytes,
	scryptSync,
	timingSafeEqual,
} from "node:crypto";
import { Collection } from "../collection";
import { CastError, SchemaError } from "../errors";
import { Stringable } from "../support/stringable";

/** Names of the built-in casts. */
export type CastName =
	| "boolean"
	| "json"
	| "array"
	| "collection"
	| "stringable"
	| "date"
	| "datetime"
	| "decimal"
	| "number"
	| "string"
	| "encrypted"
	| "encrypted:array"
	| "encrypted:collection"
	| "hashed";

/** Custom cast object: either direction may be omitted (identity). */
export interface CustomCast {
	get?(value: unknown): unknown;
	set?(value: unknown): unknown;
}

/** Enum validation cast — the stored value must be one of `enum`'s values. */
export interface EnumCast {
	readonly enum: Readonly<Record<string, string | number>>;
	get?(value: unknown): unknown;
	set?(value: unknown): unknown;
}

/**
 * Class-based custom cast (`static get` / `static set`).
 *
 * ```ts
 * class MoneyCast {
 *   static get(value: unknown) { return Number(value) / 100; }
 *   static set(value: unknown) { return Math.round(Number(value) * 100); }
 * }
 * ```
 */
export type CastClass = abstract new (...args: never[]) => unknown;

/** Anything accepted in `static casts = { … }`. */
export type CastSpec = CastName | CustomCast | EnumCast | CastClass;

/** A resolved, callable cast. @internal */
export interface ResolvedCast {
	readonly name: string;
	get(value: unknown): unknown;
	set(value: unknown): unknown;
}

/** Context every cast is resolved with (for precise errors). */
export interface CastContext {
	readonly table: string;
	readonly column: string;
	readonly encryptionKey?: string;
}

/** Every built-in cast name. */
export const KNOWN_CASTS: ReadonlySet<CastName> = new Set<CastName>([
	"boolean",
	"json",
	"array",
	"collection",
	"stringable",
	"date",
	"datetime",
	"decimal",
	"number",
	"string",
	"encrypted",
	"encrypted:array",
	"encrypted:collection",
	"hashed",
]);

/** Whether a string is a built-in cast name. */
export function isCastName(value: unknown): value is CastName {
	return typeof value === "string" && KNOWN_CASTS.has(value as CastName);
}

function identity(value: unknown): unknown {
	return value;
}

function tryParseJson(value: string): unknown {
	try {
		return JSON.parse(value);
	} catch {
		return value;
	}
}

// ---------------------------------------------------------------------------
// encrypted (AES-256-GCM)
// ---------------------------------------------------------------------------

const ENCRYPTED_PREFIX = "v1";

function encryptionKeyBytes(secret: string): Buffer {
	// Any-length secret is accepted; SHA-256 derives the 32-byte AES key.
	return createHash("sha256").update(secret, "utf8").digest();
}

function encryptValue(key: Buffer, plain: unknown): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", key, iv);
	const encrypted = Buffer.concat([
		cipher.update(String(plain), "utf8"),
		cipher.final(),
	]);
	const tag = cipher.getAuthTag();
	return [
		ENCRYPTED_PREFIX,
		iv.toString("base64"),
		tag.toString("base64"),
		encrypted.toString("base64"),
	].join(":");
}

function decryptValue(key: Buffer, stored: unknown): string {
	if (typeof stored !== "string") {
		throw new Error("encrypted cast expects a string payload");
	}
	const parts = stored.split(":");
	if (parts.length !== 4 || parts[0] !== ENCRYPTED_PREFIX) {
		throw new Error("payload is not a barq encrypted value");
	}
	const iv = Buffer.from(parts[1]!, "base64");
	const tag = Buffer.from(parts[2]!, "base64");
	const payload = Buffer.from(parts[3]!, "base64");
	const decipher = createDecipheriv("aes-256-gcm", key, iv);
	decipher.setAuthTag(tag);
	return Buffer.concat([decipher.update(payload), decipher.final()]).toString(
		"utf8",
	);
}

// ---------------------------------------------------------------------------
// hashed (salted scrypt, one-way)
// ---------------------------------------------------------------------------

const HASH_SCHEME = "scrypt";

function hashValue(plain: unknown): string {
	if (typeof plain !== "string") {
		throw new Error("hashed cast expects a string value");
	}
	const salt = randomBytes(16).toString("hex");
	const derived = scryptSync(plain, salt, 64).toString("hex");
	return `${HASH_SCHEME}:${salt}:${derived}`;
}

/**
 * Verifies a plain value against a `hashed`-cast column value.
 *
 * ```ts
 * const ok = verifyHashedValue(password, user.get("password"));
 * ```
 */
export function verifyHashedValue(plain: string, stored: unknown): boolean {
	if (typeof stored !== "string") return false;
	const parts = stored.split(":");
	if (parts.length !== 3 || parts[0] !== HASH_SCHEME) return false;
	const [, salt, expected] = parts as [string, string, string];
	let actual: Buffer;
	try {
		actual = scryptSync(plain, salt, 64);
	} catch {
		return false;
	}
	const expectedBuffer = Buffer.from(expected, "hex");
	return (
		actual.length === expectedBuffer.length &&
		timingSafeEqual(actual, expectedBuffer)
	);
}

// ---------------------------------------------------------------------------
// resolution
// ---------------------------------------------------------------------------

function builtInCast(name: CastName, context: CastContext): ResolvedCast {
	switch (name) {
		case "boolean":
			return {
				name,
				get: (value) => {
					if (value === null || value === undefined) return value;
					if (value === true || value === 1 || value === 1n || value === "1")
						return true;
					if (value === false || value === 0 || value === 0n || value === "0")
						return false;
					return Boolean(value);
				},
				set: identity,
			};
		case "json":
		case "array":
			return {
				name,
				get: (value) =>
					typeof value === "string" ? tryParseJson(value) : value,
				set: (value) =>
					typeof value === "string" ? value : JSON.stringify(value),
			};
		case "collection":
			return {
				name,
				get: (value) => {
					if (value === null || value === undefined) return value;
					const parsed =
						typeof value === "string" ? tryParseJson(value) : value;
					if (Array.isArray(parsed)) return Collection.make(parsed);
					if (parsed instanceof Collection) return parsed;
					return Collection.make(Object.values(parsed as object));
				},
				set: (value) => {
					if (value === null || value === undefined) return value;
					if (value instanceof Collection) return JSON.stringify(value.all());
					if (typeof value === "string") return value;
					if (Array.isArray(value)) return JSON.stringify(value);
					return JSON.stringify(value);
				},
			};
		case "stringable":
			return {
				name,
				get: (value) =>
					value === null || value === undefined
						? value
						: value instanceof Stringable
							? value
							: new Stringable(value),
				set: (value) => (value instanceof Stringable ? value.value() : value),
			};
		case "date":
		case "datetime":
			return {
				name,
				get: (value) => {
					if (value === null || value === undefined) return value;
					if (value instanceof Date) return value;
					if (typeof value === "string" || typeof value === "number") {
						return new Date(value);
					}
					return value;
				},
				set: identity,
			};
		case "decimal":
			return {
				name,
				get: (value) => (typeof value === "number" ? String(value) : value),
				set: identity,
			};
		case "number":
			return {
				name,
				get: (value) => {
					if (value === null || value === undefined) return value;
					if (typeof value === "number") return value;
					if (typeof value === "string" && value.trim() !== "")
						return Number(value);
					if (typeof value === "bigint") return Number(value);
					return value;
				},
				set: identity,
			};
		case "string":
			return {
				name,
				get: (value) =>
					value === null || value === undefined ? value : String(value),
				set: identity,
			};
		case "encrypted":
		case "encrypted:array":
		case "encrypted:collection": {
			const secret = context.encryptionKey;
			if (secret === undefined) {
				throw new SchemaError(
					`${context.table}.${context.column}: the "${name}" cast requires an encryption key. Pass \`encryptionKey\` to the Orm constructor.`,
				);
			}
			const key = encryptionKeyBytes(secret);
			return {
				name,
				get: (value) => {
					if (value === null || value === undefined) return value;
					let plain: string;
					try {
						plain = decryptValue(key, value);
					} catch (cause) {
						throw new CastError(
							context.table,
							context.column,
							"failed to decrypt value — wrong key or corrupted payload",
							{ cause },
						);
					}
					if (name === "encrypted") return plain;
					const parsed = tryParseJson(plain);
					if (name === "encrypted:collection") {
						return Array.isArray(parsed)
							? Collection.make(parsed)
							: Collection.make(Object.values(parsed as object));
					}
					return parsed;
				},
				set: (value) => {
					if (value === null || value === undefined) return value;
					if (name === "encrypted") return encryptValue(key, value);
					const json =
						value instanceof Collection
							? JSON.stringify(value.all())
							: typeof value === "string"
								? value
								: JSON.stringify(value);
					return encryptValue(key, json);
				},
			};
		}
		case "hashed":
			return {
				name,
				get: identity,
				set: (value) => {
					if (value === null || value === undefined) return value;
					// Attributes hold the attribute form (`get(set(v))` on
					// assignment) and payloads re-apply `set`, so an existing
					// scrypt payload must pass through untouched.
					if (typeof value === "string" && value.startsWith("scrypt:")) {
						return value;
					}
					try {
						return hashValue(value);
					} catch (cause) {
						throw new CastError(
							context.table,
							context.column,
							'the "hashed" cast only accepts strings',
							{ cause },
						);
					}
				},
			};
	}
}

/** Resolves a cast spec into callable get/set pairs. @internal */
export function resolveCast(
	spec: CastSpec,
	context: CastContext,
): ResolvedCast {
	if (isCastName(spec)) return builtInCast(spec, context);
	if (typeof spec === "function") {
		const cast = spec as {
			get?: (value: unknown) => unknown;
			set?: (value: unknown) => unknown;
		};
		if (cast.get === undefined && cast.set === undefined) {
			throw new SchemaError(
				`${context.table}.${context.column}: class cast must declare static get and/or set.`,
			);
		}
		return {
			name: "custom-class",
			get: cast.get ?? identity,
			set: cast.set ?? identity,
		};
	}
	if (typeof spec !== "object" || spec === null) {
		throw new SchemaError(
			`${context.table}.${context.column}: invalid cast ${JSON.stringify(spec)}. Use a built-in name (${[...KNOWN_CASTS].join(", ")}) or an object with get/set functions.`,
		);
	}
	if ("enum" in spec) {
		const values = new Set<unknown>(Object.values(spec.enum ?? {}));
		if (values.size === 0) {
			throw new SchemaError(
				`${context.table}.${context.column}: enum cast needs at least one value.`,
			);
		}
		const validate = (value: unknown): unknown => {
			if (value === null || value === undefined) return value;
			if (!values.has(value)) {
				throw new CastError(
					context.table,
					context.column,
					`value ${JSON.stringify(value)} is not a member of the declared enum`,
				);
			}
			return value;
		};
		return {
			name: "enum",
			get: spec.get ?? validate,
			set: spec.set ?? validate,
		};
	}
	for (const key of Object.keys(spec)) {
		if (key !== "get" && key !== "set") {
			throw new SchemaError(
				`${context.table}.${context.column}: custom cast keys must be "get" or "set", got "${key}".`,
			);
		}
	}
	const get = spec.get;
	const set = spec.set;
	if (get === undefined && set === undefined) {
		throw new SchemaError(
			`${context.table}.${context.column}: custom cast needs at least one of get/set.`,
		);
	}
	if (get !== undefined && typeof get !== "function") {
		throw new SchemaError(
			`${context.table}.${context.column}: custom cast "get" must be a function.`,
		);
	}
	if (set !== undefined && typeof set !== "function") {
		throw new SchemaError(
			`${context.table}.${context.column}: custom cast "set" must be a function.`,
		);
	}
	return {
		name: "custom",
		get: get ?? identity,
		set: set ?? identity,
	};
}
