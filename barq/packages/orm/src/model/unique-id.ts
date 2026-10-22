// Unique identifiers — Eloquent's `HasUlids` / `HasUuids` traits.
//
// ```ts
// class Post extends orm.model("posts") {
//   static usesUniqueIds = "ulid";   // or "uuid" / true (ulid)
// }
// ```
//
// The key is generated when the row is inserted and the key column is still
// empty. ULIDs are lexicographically sortable (48-bit millisecond timestamp
// plus 80 bits of randomness) and monotonic inside one millisecond.

import { randomBytes, randomUUID } from "node:crypto";

/** Crockford base32 alphabet (no `I`, `L`, `O`, `U`). */
const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Number of random bits per ULID. */
const RANDOM_BITS = 80;

/** Timestamp of the last generated ULID (milliseconds). */
let lastTimestamp = -1;

/** Random payload of the last generated ULID. */
let lastRandom: number[] = [];

/**
 * Generates a ULID: 26 characters, Crockford base32, uppercase.
 *
 * Two ULIDs created in the same millisecond are strictly increasing.
 */
export function newUlid(now: number = Date.now()): string {
	if (now === lastTimestamp && lastRandom.length === RANDOM_BITS) {
		// Same millisecond: increment the random part so the order is kept.
		for (let index = lastRandom.length - 1; index >= 0; index -= 1) {
			const current = lastRandom[index] ?? 0;
			if (current < 31) {
				lastRandom[index] = current + 1;
				break;
			}
			lastRandom[index] = 0;
		}
	} else {
		lastTimestamp = now;
		lastRandom = randomBits(RANDOM_BITS);
	}
	return encodeUlid(now, lastRandom);
}

/** Generates a random UUID (version 4). */
export function newUuid(): string {
	return randomUUID();
}

/** `true` when the value looks like a ULID (26 Crockford characters). */
export function isUlid(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length === 26 &&
		/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]+$/.test(value)
	);
}

function randomBits(bits: number): number[] {
	const bytes = randomBytes(Math.ceil(bits / 8));
	const result: number[] = [];
	for (let index = 0; index < bits; index += 1) {
		const byte = bytes[index >> 3] ?? 0;
		result.push((byte >> (7 - (index % 8))) & 1);
	}
	return result;
}

function encodeUlid(timestamp: number, random: readonly number[]): string {
	let time = timestamp;
	const timeChars: string[] = [];
	for (let index = 0; index < 10; index += 1) {
		timeChars.unshift(ENCODING[time % 32] as string);
		time = Math.floor(time / 32);
	}
	let randomValue = 0;
	for (const bit of random) randomValue = randomValue * 2 + bit;
	const randomChars: string[] = [];
	for (let index = 0; index < 16; index += 1) {
		randomChars.unshift(ENCODING[randomValue % 32] as string);
		randomValue = Math.floor(randomValue / 32);
	}
	return `${timeChars.join("")}${randomChars.join("")}`;
}
