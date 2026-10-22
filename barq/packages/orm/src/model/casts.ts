// Attribute casts.
//
// A cast converts values in both directions:
//
//   get(databaseValue) → attributeValue   (applied while hydrating)
//   set(attributeValue) → databaseValue   (applied while writing)
//
// Built-in casts: boolean/bool, json, array, object, collection, stringable,
// date, datetime, immutable_date, immutable_datetime, timestamp, decimal,
// number, int, float, string, encrypted (array/collection/object/json),
// hashed (`hashed:<algorithm>`), and enum casts (`enum:<Type>`,
// `AsEnumCollection:<Type>` or a class/value with `from`/`tryFrom`).
// A model can also declare a custom cast object:
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

/** Names of the built-in casts (parameterized forms included). */
export type CastName =
	| "boolean"
	| "bool"
	| "json"
	| "array"
	| "object"
	| "collection"
	| "stringable"
	| "AsStringable"
	| "AsCollection"
	| "AsArrayObject"
	| "AsEncryptedArrayObject"
	| "AsEnumCollection"
	| "date"
	| "datetime"
	| "immutable_date"
	| "immutable_datetime"
	| "timestamp"
	| "decimal"
	| "number"
	| "int"
	| "integer"
	| "float"
	| "double"
	| "real"
	| "string"
	| "encrypted"
	| "encrypted:array"
	| "encrypted:collection"
	| "encrypted:object"
	| "encrypted:json"
	| "hashed"
	| `date:${string}`
	| `datetime:${string}`
	| `decimal:${number}`
	| `hashed:${string}`
	| `enum:${string}`
	| `AsEnumCollection:${string}`;

/** Custom cast object: either direction may be omitted (identity). */
export interface CustomCast {
	get?(value: unknown): unknown;
	set?(value: unknown): unknown;
}

/**
 * A runtime "backed enum" value: `from(value)` returns the matching case (or
 * throws) and `tryFrom(value)` returns `null` for an unknown value.
 */
export interface EnumLikeValue {
	from(value: unknown): unknown;
	tryFrom?(value: unknown): unknown;
}

/**
 * Anything an enum cast can resolve against: a plain `{ Name: value }` record
 * (membership-checked by value) or a PHP-style enum value with
 * `from`/`tryFrom` (whose cases expose a `value` property).
 */
export type EnumSource =
	| Readonly<Record<string, string | number>>
	| EnumLikeValue;

/** Enum validation cast — the stored value must resolve to a member of `enum`. */
export interface EnumCast {
	readonly enum: EnumSource;
	/** Hydrate a JSON array of enum values into a `Collection` (AsEnumCollection). */
	readonly collection?: boolean;
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

/**
 * Eloquent's `Castable` contract: a model may declare its casts through a
 * static method instead of a static map.
 *
 * TypeScript interfaces cannot declare static members, so the contract is
 * expressed as the *static* side of a class:
 *
 * ```ts
 * class User extends orm.model("users") {
 *   static casts() {
 *     return { settings: "json" as const };
 *   }
 * }
 * ```
 *
 * The runtime detects the method — `static casts` and `static casts()` are
 * both accepted.
 */
export interface Castable {
	casts(): Readonly<Record<string, CastSpec>>;
}

/** A resolved, callable cast. @internal */
export interface ResolvedCast {
	readonly name: string;
	get(value: unknown): unknown;
	set(value: unknown): unknown;
	/**
	 * `get` must run on every read (immutable casts hand out a fresh value),
	 * so only `set` runs when assigning/hydrating.
	 */
	readonly decorate?: boolean;
}

/** Context every cast is resolved with (for precise errors). */
export interface CastContext {
	readonly table: string;
	readonly column: string;
	readonly encryptionKey?: string;
}

/** Every bare (non-parameterized) built-in cast name. */
export const KNOWN_CASTS: ReadonlySet<CastName> = new Set<CastName>([
	"boolean",
	"bool",
	"json",
	"array",
	"object",
	"collection",
	"stringable",
	"AsStringable",
	"AsCollection",
	"AsArrayObject",
	"AsEncryptedArrayObject",
	"AsEnumCollection",
	"date",
	"datetime",
	"immutable_date",
	"immutable_datetime",
	"timestamp",
	"decimal",
	"number",
	"int",
	"integer",
	"float",
	"double",
	"real",
	"string",
	"encrypted",
	"encrypted:array",
	"encrypted:collection",
	"encrypted:object",
	"encrypted:json",
	"hashed",
]);

/**
 * Splits a cast name into its base name and optional argument
 * (`date:Y-m-d` → `{ base: "date", arg: "Y-m-d" }`).
 */
export function parseCastName(
	value: string,
): { base: string; arg?: string } | null {
	if (KNOWN_CASTS.has(value as CastName)) return { base: value };
	const separator = value.indexOf(":");
	if (separator <= 0) return null;
	const base = value.slice(0, separator);
	const arg = value.slice(separator + 1);
	if ((base === "date" || base === "datetime") && arg !== "") {
		return { base, arg };
	}
	if (base === "decimal" && arg !== "" && Number.isFinite(Number(arg))) {
		return { base, arg };
	}
	if (base === "hashed" && arg !== "") return { base, arg };
	if (base === "enum" && arg !== "") return { base, arg };
	if (base === "AsEnumCollection" && arg !== "") return { base, arg };
	return null;
}

/** Whether a string is a built-in cast name (parameterized forms included). */
export function isCastName(value: unknown): value is CastName {
	return typeof value === "string" && parseCastName(value) !== null;
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
// PHP-style date formatting for parameterized date/datetime casts
// ---------------------------------------------------------------------------

const DATE_TOKENS: Readonly<Record<string, string>> = {
	Y: "\\d{4}",
	y: "\\d{2}",
	m: "\\d{2}",
	n: "\\d{1,2}",
	d: "\\d{2}",
	j: "\\d{1,2}",
	H: "\\d{2}",
	G: "\\d{1,2}",
	i: "\\d{2}",
	s: "\\d{2}",
	u: "\\d{1,6}",
};

function pad(value: number, length: number): string {
	return String(value).padStart(length, "0");
}

/** Formats a `Date` with a PHP-ish token subset (`Y y m n d j H G i s u`). */
export function formatDateValue(date: Date, format: string): string {
	let output = "";
	for (let index = 0; index < format.length; index += 1) {
		const token = format[index]!;
		if (token === "\\") {
			index += 1;
			if (index < format.length) output += format[index];
			continue;
		}
		switch (token) {
			case "Y":
				output += pad(date.getFullYear(), 4);
				break;
			case "y":
				output += pad(date.getFullYear() % 100, 2);
				break;
			case "m":
				output += pad(date.getMonth() + 1, 2);
				break;
			case "n":
				output += String(date.getMonth() + 1);
				break;
			case "d":
				output += pad(date.getDate(), 2);
				break;
			case "j":
				output += String(date.getDate());
				break;
			case "H":
				output += pad(date.getHours(), 2);
				break;
			case "G":
				output += String(date.getHours());
				break;
			case "i":
				output += pad(date.getMinutes(), 2);
				break;
			case "s":
				output += pad(date.getSeconds(), 2);
				break;
			case "u":
				output += pad(date.getMilliseconds() * 1000, 6);
				break;
			default:
				output += token;
		}
	}
	return output;
}

/** Parses a string with a PHP-ish token subset back into a local `Date`. */
export function parseDateValue(value: string, format: string): Date | null {
	let regex = "^";
	const order: string[] = [];
	for (let index = 0; index < format.length; index += 1) {
		const token = format[index]!;
		if (token === "\\") {
			index += 1;
			if (index < format.length) {
				regex += format[index]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			}
			continue;
		}
		const pattern = DATE_TOKENS[token];
		if (pattern !== undefined) {
			regex += `(${pattern})`;
			order.push(token);
		} else {
			regex += token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		}
	}
	regex += "$";
	const match = new RegExp(regex).exec(value.trim());
	if (match === null) return null;
	const fields = {
		year: 1970,
		month: 1,
		day: 1,
		hour: 0,
		minute: 0,
		second: 0,
		ms: 0,
	};
	order.forEach((token, position) => {
		const raw = Number(match[position + 1]);
		if (token === "Y") fields.year = raw;
		else if (token === "y") fields.year = 2000 + raw;
		else if (token === "m" || token === "n") fields.month = raw;
		else if (token === "d" || token === "j") fields.day = raw;
		else if (token === "H" || token === "G") fields.hour = raw;
		else if (token === "i") fields.minute = raw;
		else if (token === "s") fields.second = raw;
		else if (token === "u") fields.ms = Math.trunc(raw / 1000);
	});
	const date = new Date(
		fields.year,
		fields.month - 1,
		fields.day,
		fields.hour,
		fields.minute,
		fields.second,
		fields.ms,
	);
	return Number.isNaN(date.getTime()) ? null : date;
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

/**
 * Resolves a `hashed[:algorithm]` scheme. `scrypt` (the default) is salted
 * with `scryptSync`; any other value must name a `node:crypto` hash algorithm
 * (`sha256`, `sha512`, …) and is salted by prefixing the random salt.
 */
function hashScheme(
	algorithm: string | undefined,
	context: CastContext,
): string {
	if (algorithm === undefined) return HASH_SCHEME;
	try {
		createHash(algorithm);
	} catch (cause) {
		throw new SchemaError(
			`${context.table}.${context.column}: unknown hash algorithm ${JSON.stringify(algorithm)} for the "hashed" cast.`,
			{ cause },
		);
	}
	return algorithm.toLowerCase();
}

/** Whether `stored` already carries a payload for `scheme` (idempotent writes). */
function isHashedValue(stored: string, scheme: string): boolean {
	return stored.startsWith(`${scheme}:`);
}

function hashValue(plain: unknown, scheme: string): string {
	if (typeof plain !== "string") {
		throw new Error("hashed cast expects a string value");
	}
	const salt = randomBytes(16).toString("hex");
	const derived =
		scheme === HASH_SCHEME
			? scryptSync(plain, salt, 64).toString("hex")
			: createHash(scheme).update(salt).update(plain).digest("hex");
	return `${scheme}:${salt}:${derived}`;
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
	if (parts.length !== 3) return false;
	const [scheme, salt, expected] = parts as [string, string, string];
	let actual: Buffer;
	try {
		actual =
			scheme === HASH_SCHEME
				? scryptSync(plain, salt, 64)
				: createHash(scheme).update(salt).update(plain).digest();
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
// enums
// ---------------------------------------------------------------------------

/** Runtime enums addressable from string casts (`enum:<Name>`). */
const ENUM_REGISTRY = new Map<string, EnumSource>();

/**
 * Registers a runtime enum value under `name` so the string cast names
 * `enum:<Name>` and `AsEnumCollection:<Name>` can resolve it.
 *
 * ```ts
 * registerCastEnum("Status", Status);
 * class User extends orm.model("users") {
 *   static casts = { status: "enum:Status" } as const;
 * }
 * ```
 */
export function registerCastEnum(name: string, value: EnumSource): void {
	ENUM_REGISTRY.set(name, value);
}

/** Whether `source` is a PHP-style enum value (`from`/`tryFrom`). */
function isEnumLike(
	source: EnumSource | null | undefined,
): source is EnumLikeValue {
	return (
		source !== null &&
		source !== undefined &&
		(typeof source === "object" || typeof source === "function") &&
		typeof (source as { from?: unknown }).from === "function"
	);
}

/** Resolves a registered enum value or throws a helpful `SchemaError`. */
function registeredEnum(type: string, context: CastContext): EnumSource {
	const source = ENUM_REGISTRY.get(type);
	if (source === undefined) {
		throw new SchemaError(
			`${context.table}.${context.column}: no enum registered as ${JSON.stringify(type)}. Register it with registerCastEnum(${JSON.stringify(type)}, value) before using "${type}".`,
		);
	}
	return source;
}

/** Pulls the storable primitive out of an enum case (`case.value`) or value. */
function enumStorableOf(value: unknown): unknown {
	if (value !== null && typeof value === "object") {
		const candidate = (value as { value?: unknown }).value;
		if (typeof candidate === "string" || typeof candidate === "number") {
			return candidate;
		}
	}
	return value;
}

/** Validates a stored value and returns its attribute (enum case) form. */
function enumCaseFrom(
	source: EnumSource,
	value: unknown,
	context: CastContext,
): unknown {
	if (isEnumLike(source)) {
		try {
			if (typeof source.tryFrom === "function") {
				const resolved = source.tryFrom(value);
				if (resolved === null || resolved === undefined) {
					throw new Error("no enum case");
				}
				return resolved;
			}
			return source.from(value);
		} catch (cause) {
			throw new CastError(
				context.table,
				context.column,
				`value ${JSON.stringify(value)} is not a valid enum case`,
				{ cause },
			);
		}
	}
	if (!new Set<unknown>(Object.values(source)).has(value)) {
		throw new CastError(
			context.table,
			context.column,
			`value ${JSON.stringify(value)} is not a member of the declared enum`,
		);
	}
	return value;
}

/** Validates an attribute value and returns its storable (`set`) form. */
function enumStorable(
	source: EnumSource,
	value: unknown,
	context: CastContext,
): unknown {
	if (value === null || value === undefined) return value;
	const candidate = enumStorableOf(value);
	enumCaseFrom(source, candidate, context);
	return candidate;
}

/** Builds the get/set pair for a single enum or a collection of enums. */
function enumAccessors(
	source: EnumSource | null | undefined,
	context: CastContext,
	collection: boolean,
): { get(value: unknown): unknown; set(value: unknown): unknown } {
	const enumSource: EnumSource = source ?? {};
	if (!isEnumLike(enumSource)) {
		if (Object.values(enumSource).length === 0) {
			throw new SchemaError(
				`${context.table}.${context.column}: enum cast needs at least one value.`,
			);
		}
	}
	if (!collection) {
		return {
			get: (value) =>
				value === null || value === undefined
					? value
					: enumCaseFrom(enumSource, value, context),
			set: (value) => enumStorable(enumSource, value, context),
		};
	}
	return {
		get: (value) => {
			if (value === null || value === undefined) return value;
			const parsed = typeof value === "string" ? tryParseJson(value) : value;
			if (!Array.isArray(parsed)) {
				throw new CastError(
					context.table,
					context.column,
					"enum collection cast expects a JSON array payload",
				);
			}
			return Collection.make(
				parsed.map((item) => enumCaseFrom(enumSource, item, context)),
			);
		},
		set: (value) => {
			if (value === null || value === undefined) return value;
			if (typeof value === "string") return value;
			const items =
				value instanceof Collection
					? value.all()
					: Array.isArray(value)
						? value
						: Object.values(value as object);
			return JSON.stringify(
				items.map((item) => enumStorable(enumSource, item, context)),
			);
		},
	};
}

// ---------------------------------------------------------------------------
// resolution
// ---------------------------------------------------------------------------

function builtInCast(
	base: string,
	arg: string | undefined,
	context: CastContext,
): ResolvedCast {
	const name: string = arg === undefined ? base : `${base}:${arg}`;
	switch (base) {
		case "boolean":
		case "bool":
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
		case "object":
		case "AsArrayObject":
			return {
				name,
				get: (value) =>
					typeof value === "string" ? tryParseJson(value) : value,
				set: (value) =>
					typeof value === "string" ? value : JSON.stringify(value),
			};
		case "collection":
		case "AsCollection":
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
		case "AsStringable":
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
		case "datetime": {
			if (arg !== undefined) {
				// Parameterized form (`date:Y-m-d`): attributes round-trip as
				// formatted strings; writes store the formatted string too.
				return {
					name,
					get: (value) => {
						if (value === null || value === undefined) return value;
						if (value instanceof Date) {
							return Number.isNaN(value.getTime())
								? value
								: formatDateValue(value, arg);
						}
						if (typeof value === "string" || typeof value === "number") {
							const parsed = parseDateValue(String(value), arg);
							return parsed === null ? value : formatDateValue(parsed, arg);
						}
						return value;
					},
					set: (value) => {
						if (value === null || value === undefined) return value;
						if (typeof value === "string") return value;
						if (value instanceof Date) {
							return Number.isNaN(value.getTime())
								? value
								: formatDateValue(value, arg);
						}
						return value;
					},
				};
			}
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
		}
		case "timestamp":
			// Eloquent's `timestamp` cast normalizes to a UNIX timestamp in
			// seconds on read (accepting numbers, numeric strings, date
			// strings and `Date` instances); writes store the integer.
			return {
				name,
				get: (value) => {
					if (value === null || value === undefined) return value;
					if (value instanceof Date) {
						return Number.isNaN(value.getTime())
							? value
							: Math.floor(value.getTime() / 1000);
					}
					if (typeof value === "bigint") return Number(value);
					if (typeof value === "number") {
						return Number.isFinite(value) ? Math.trunc(value) : value;
					}
					if (typeof value === "string") {
						const trimmed = value.trim();
						if (trimmed === "") return value;
						if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
						const parsed = new Date(trimmed);
						return Number.isNaN(parsed.getTime())
							? value
							: Math.floor(parsed.getTime() / 1000);
					}
					return value;
				},
				set: identity,
			};
		case "immutable_date":
		case "immutable_datetime":
			// Eloquent's `immutable_*` casts keep the attribute itself from
			// being mutated: every read hands out a defensive copy.
			return {
				name,
				decorate: true,
				get: (value) => {
					if (value === null || value === undefined) return value;
					if (value instanceof Date) return new Date(value.getTime());
					if (typeof value === "string" || typeof value === "number") {
						return new Date(value);
					}
					return value;
				},
				set: (value) => {
					if (value === null || value === undefined) return value;
					if (value instanceof Date) return new Date(value.getTime());
					return value;
				},
			};
		case "decimal": {
			const scale = arg === undefined ? null : Number(arg);
			return {
				name,
				get: (value) => {
					if (value === null || value === undefined) return value;
					const numeric =
						typeof value === "number"
							? value
							: typeof value === "string" &&
									value.trim() !== "" &&
									Number.isFinite(Number(value))
								? Number(value)
								: null;
					if (numeric === null) return value;
					return scale === null ? String(numeric) : numeric.toFixed(scale);
				},
				set: identity,
			};
		}
		case "int":
		case "integer":
			return {
				name,
				get: (value) => {
					if (value === null || value === undefined) return value;
					const numeric = Number(value);
					return Number.isNaN(numeric) ? value : Math.trunc(numeric);
				},
				set: (value) => {
					if (value === null || value === undefined) return value;
					const numeric = Number(value);
					return Number.isNaN(numeric) ? value : Math.trunc(numeric);
				},
			};
		case "float":
		case "double":
		case "real":
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
				set: (value) => {
					if (value === null || value === undefined) return value;
					if (typeof value === "number") return value;
					const numeric = Number(value);
					return Number.isNaN(numeric) ? value : numeric;
				},
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
		case "encrypted:collection":
		case "encrypted:object":
		case "encrypted:json":
		case "AsEncryptedArrayObject": {
			const secret = context.encryptionKey;
			if (secret === undefined) {
				throw new SchemaError(
					`${context.table}.${context.column}: the "${name}" cast requires an encryption key. Pass \`encryptionKey\` to the Orm constructor.`,
				);
			}
			const key = encryptionKeyBytes(secret);
			const nested =
				name === "AsEncryptedArrayObject"
					? "object"
					: name.startsWith("encrypted:")
						? name.slice("encrypted:".length)
						: null;
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
					if (nested === null) return plain;
					const parsed = tryParseJson(plain);
					if (nested === "collection") {
						return Array.isArray(parsed)
							? Collection.make(parsed)
							: Collection.make(Object.values(parsed as object));
					}
					return parsed;
				},
				set: (value) => {
					if (value === null || value === undefined) return value;
					if (nested === null) return encryptValue(key, value);
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
		case "hashed": {
			const scheme = hashScheme(arg, context);
			return {
				name,
				get: identity,
				set: (value) => {
					if (value === null || value === undefined) return value;
					// Attributes hold the attribute form (`get(set(v))` on
					// assignment) and payloads re-apply `set`, so an existing
					// payload for this scheme must pass through untouched.
					if (typeof value === "string" && isHashedValue(value, scheme)) {
						return value;
					}
					try {
						return hashValue(value, scheme);
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
		case "enum": {
			if (arg === undefined) {
				throw new SchemaError(
					`${context.table}.${context.column}: the "enum" cast needs an enum type (enum:<Name>).`,
				);
			}
			const accessors = enumAccessors(
				registeredEnum(arg, context),
				context,
				false,
			);
			return { name, ...accessors };
		}
		case "AsEnumCollection": {
			if (arg === undefined) {
				throw new SchemaError(
					`${context.table}.${context.column}: the "AsEnumCollection" cast needs an enum type (AsEnumCollection:<Name>).`,
				);
			}
			const accessors = enumAccessors(
				registeredEnum(arg, context),
				context,
				true,
			);
			return { name, ...accessors };
		}
		default:
			throw new SchemaError(
				`Unknown built-in cast ${JSON.stringify(name)}. Known casts: ${[...KNOWN_CASTS].join(", ")}.`,
			);
	}
}

/** Resolves a cast spec into callable get/set pairs. @internal */
export function resolveCast(
	spec: CastSpec,
	context: CastContext,
): ResolvedCast {
	if (typeof spec === "string") {
		const parsed = parseCastName(spec);
		if (parsed !== null) {
			return builtInCast(parsed.base, parsed.arg, context);
		}
	}
	if (typeof spec === "function") {
		const cast = spec as {
			get?: (value: unknown) => unknown;
			set?: (value: unknown) => unknown;
			from?: unknown;
			tryFrom?: unknown;
			collection?: unknown;
		};
		if (cast.get === undefined && cast.set === undefined) {
			if (
				typeof cast.from === "function" ||
				typeof cast.tryFrom === "function"
			) {
				const accessors = enumAccessors(
					cast as unknown as EnumSource,
					context,
					cast.collection === true,
				);
				return { name: "enum", ...accessors };
			}
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
		const accessors = enumAccessors(
			spec.enum,
			context,
			spec.collection === true,
		);
		return {
			name: "enum",
			get: spec.get ?? accessors.get,
			set: spec.set ?? accessors.set,
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
