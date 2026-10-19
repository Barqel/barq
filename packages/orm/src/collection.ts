// Eloquent-style collections backed by collect.js.
//
// `Collection<T>` is an Array subclass: existing array ergonomics (`length`,
// indexing, spread, JSON) keep working, while collect.js powers the richer
// Laravel-style API (`pluck`, `keyBy`, `groupBy`, `sortBy`, `where…`,
// `chunk`, `sum`, `avg`, …). Relations and query results are always
// collections — never plain arrays — matching Eloquent's public surface.

import collectjs from "collect.js";

type Predicate<T> = (value: T, key: number) => boolean;
type Mapper<T, U> = (value: T, key: number, array: T[]) => U;
type Reducer<T, U> = (carry: U, value: T, key: number, array: T[]) => U;

/**
 * Reads an attribute from a plain record or an ORM model. Model attributes
 * live behind `get()`, so collection helpers must not assume index access.
 */
function readAttribute(value: unknown, key: PropertyKey): unknown {
	if (value !== null && typeof value === "object") {
		const getter = (value as { get?: unknown }).get;
		if (typeof getter === "function") {
			return (getter as (name: string) => unknown).call(value, String(key));
		}
	}
	return (value as Record<PropertyKey, unknown>)[key];
}

/**
 * A typed collection with Laravel-flavoured helpers.
 *
 * It extends `Array<T>`, so `collection[0]`, `.length`, `for…of`, spread and
 * `JSON.stringify` behave exactly like an array. Methods that change the
 * shape return another `Collection`, not a plain array.
 */
export class Collection<T> extends Array<T> {
	/** Array methods that allocate use `Array`, never `Collection`. */
	static override get [Symbol.species](): ArrayConstructor {
		return Array;
	}

	/** Builds a collection from any iterable. */
	static make<T>(items: Iterable<T> = []): Collection<T> {
		const collection = new Collection<T>();
		for (const item of items) collection.push(item);
		return collection;
	}

	/** Alias kept close to Eloquent's `collect()` helper. */
	static wrap<T>(items: T | Iterable<T> | null | undefined): Collection<T> {
		if (items === null || items === undefined) return new Collection<T>();
		if (Array.isArray(items)) return Collection.make(items as Iterable<T>);
		if (typeof items === "object" && Symbol.iterator in items) {
			return Collection.make(items as Iterable<T>);
		}
		return Collection.make([items as T]);
	}

	// -----------------------------------------------------------------------
	// shape / conversion
	// -----------------------------------------------------------------------

	/** The underlying array (a copy — mutating it does not affect the collection). */
	all(): T[] {
		return [...this];
	}

	/** Eloquent-compatible alias for `all()`. */
	toArray(): T[] {
		return this.all();
	}

	/** JSON projection: always a plain array. */
	toJSON(): T[] {
		return this.all();
	}

	/** Number of items (Eloquent `count()`). */
	count(): number {
		return this.length;
	}

	/** Whether the collection has no items. */
	isEmpty(): boolean {
		return this.length === 0;
	}

	/** Whether the collection has at least one item. */
	isNotEmpty(): boolean {
		return this.length > 0;
	}

	/** A collection containing only the given keys (array indices). */
	only(keys: readonly number[]): Collection<T> {
		const selected: T[] = [];
		for (const key of keys) {
			if (key >= 0 && key < this.length) selected.push(this[key]!);
		}
		return Collection.make(selected);
	}

	/** A collection without the given keys (array indices). */
	except(keys: readonly number[]): Collection<T> {
		const omitted = new Set(keys);
		return Collection.make(this.filter((_, index) => !omitted.has(index)));
	}

	// -----------------------------------------------------------------------
	// element access
	// -----------------------------------------------------------------------

	/** First item, optionally matching a predicate. */
	first(): T | undefined;
	first(predicate: (value: T, key: number) => boolean): T | undefined;
	first(
		predicate?: (value: T, key: number) => boolean,
		defaultValue?: T,
	): T | undefined {
		if (predicate === undefined) return this[0];
		for (let index = 0; index < this.length; index += 1) {
			const value = this[index]!;
			if (predicate(value, index)) return value;
		}
		return defaultValue;
	}

	/** Last item, optionally matching a predicate. */
	last(): T | undefined;
	last(predicate: (value: T, key: number) => boolean): T | undefined;
	last(predicate?: (value: T, key: number) => boolean): T | undefined {
		if (predicate === undefined) return this[this.length - 1];
		for (let index = this.length - 1; index >= 0; index -= 1) {
			const value = this[index]!;
			if (predicate(value, index)) return value;
		}
		return undefined;
	}

	/** First item or throw (Eloquent `firstOrFail`). */
	firstOrFail(): T {
		const value = this.first();
		if (value === undefined) {
			throw new Error("Collection is empty.");
		}
		return value;
	}

	// -----------------------------------------------------------------------
	// transformation
	// -----------------------------------------------------------------------

	/** Maps every item into a new collection. */
	override map<U>(callback: Mapper<T, U>, thisArg?: unknown): Collection<U> {
		const output: U[] = [];
		for (let index = 0; index < this.length; index += 1) {
			output.push(callback.call(thisArg, this[index]!, index, this));
		}
		return Collection.make(output);
	}

	/** Keeps items matching the predicate. */
	override filter<S extends T>(
		predicate: (value: T, index: number, array: T[]) => value is S,
		thisArg?: unknown,
	): Collection<S>;
	override filter(
		predicate: (value: T, index: number, array: T[]) => unknown,
		thisArg?: unknown,
	): Collection<T>;
	override filter(
		predicate: (value: T, index: number, array: T[]) => unknown,
		thisArg?: unknown,
	): Collection<T> {
		const output: T[] = [];
		for (let index = 0; index < this.length; index += 1) {
			const value = this[index]!;
			if (predicate.call(thisArg, value, index, this)) output.push(value);
		}
		return Collection.make(output);
	}

	/** Drops items matching the predicate. */
	reject(predicate: Predicate<T>, thisArg?: unknown): Collection<T> {
		return this.filter((value, key) => !predicate.call(thisArg, value, key));
	}

	/** Flat-maps every item into a new collection. */
	override flatMap<U, This = undefined>(
		callback: (
			this: This,
			value: T,
			index: number,
			array: T[],
		) => U | readonly U[],
		thisArg?: This,
	): Collection<U> {
		const output: U[] = [];
		for (let index = 0; index < this.length; index += 1) {
			const mapped = callback.call(thisArg as This, this[index]!, index, this);
			if (Array.isArray(mapped)) output.push(...mapped);
			else output.push(mapped as U);
		}
		return Collection.make(output);
	}

	/** Flattens one level (Eloquent `flatten` with depth 1). */
	flatten<U = T>(depth = 1): Collection<U> {
		let current: unknown[] = this.all();
		for (let level = 0; level < depth; level += 1) {
			const next: unknown[] = [];
			for (const value of current) {
				if (Array.isArray(value)) next.push(...value);
				else next.push(value);
			}
			current = next;
		}
		return Collection.make(current as U[]);
	}

	/** Collapses nested arrays into one collection. */
	collapse<U = T>(): Collection<U> {
		return this.flatten<U>(Number.POSITIVE_INFINITY);
	}

	/** Runs `callback` for each item; the collection is returned. */
	each(callback: (value: T, key: number) => void, thisArg?: unknown): this {
		for (let index = 0; index < this.length; index += 1) {
			callback.call(thisArg, this[index]!, index);
		}
		return this;
	}

	/** Eloquent `tap`: observe the collection without replacing it. */
	tap(callback: (collection: this) => void): this {
		callback(this);
		return this;
	}

	/** Pipes the collection through a callback. */
	pipe<U>(callback: (collection: this) => U): U {
		return callback(this);
	}

	/** Runs a callback when the condition is truthy (or its fallback). */
	when(
		condition: unknown,
		callback: (collection: this) => this | void,
		fallback?: (collection: this) => this | void,
	): this {
		if (condition) {
			callback(this);
		} else {
			fallback?.(this);
		}
		return this;
	}

	/** Runs a callback when the condition is falsy (or its fallback). */
	unless(
		condition: unknown,
		callback: (collection: this) => this | void,
		fallback?: (collection: this) => this | void,
	): this {
		return this.when(!condition, callback, fallback);
	}

	// -----------------------------------------------------------------------
	// lookup / grouping
	// -----------------------------------------------------------------------

	/** Whether an item (or predicate match) is present. */
	override includes(searchElement: T, fromIndex?: number): boolean;
	override includes(
		predicate: (value: T, key: number, array: T[]) => boolean,
	): boolean;
	override includes(
		value: T | ((item: T, key: number, array: T[]) => boolean),
		fromIndex = 0,
	): boolean {
		if (typeof value === "function") {
			const predicate = value as (item: T, key: number, array: T[]) => boolean;
			for (
				let index = Math.max(0, fromIndex);
				index < this.length;
				index += 1
			) {
				if (predicate(this[index]!, index, this)) return true;
			}
			return false;
		}
		return Array.prototype.includes.call(this, value, fromIndex);
	}

	/** Eloquent `contains` — item or predicate. */
	contains(value: T | ((item: T, key: number) => boolean)): boolean {
		return this.includes(value as never);
	}

	/** Extracts one property (or callback result) from every item. */
	pluck<K extends keyof T>(key: K): Collection<T[K]>;
	pluck(key: string): Collection<unknown>;
	pluck<U>(callback: (value: T, key: number) => U): Collection<U>;
	pluck<U>(
		key: string | ((value: T, key: number) => U),
	): Collection<U extends never ? never : U> {
		const callback =
			typeof key === "function" ? key : (value: T) => readAttribute(value, key);
		return this.map((value, index) => callback(value, index)) as Collection<U>;
	}

	/** Groups values by a key or callback. */
	groupBy<K extends keyof T>(key: K): Record<string, Collection<T>>;
	groupBy(key: string): Record<string, Collection<T>>;
	groupBy<K extends string | number>(
		callback: (value: T, key: number) => K,
	): Record<string, Collection<T>>;
	groupBy<K extends string | number>(
		key: keyof T | string | ((value: T, key: number) => K),
	): Record<string, Collection<T>> {
		const callback =
			typeof key === "function"
				? key
				: (value: T) => String(readAttribute(value, key as PropertyKey));
		const grouped = collectjs(this.all())
			.groupBy((item: T, index?: number) => callback(item, index ?? 0))
			.all() as unknown as Record<string, T[]>;
		const groups: Record<string, Collection<T>> = {};
		for (const [groupKey, values] of Object.entries(grouped)) {
			groups[groupKey] = Collection.make(values);
		}
		return groups;
	}

	/** Indexes values by a key or callback. */
	keyBy<K extends keyof T>(key: K): Record<string, T>;
	keyBy(key: string): Record<string, T>;
	keyBy<K extends string | number>(
		callback: (value: T, key: number) => K,
	): Record<string, T>;
	keyBy<K extends string | number>(
		key: keyof T | string | ((value: T, key: number) => K),
	): Record<string, T> {
		const callback =
			typeof key === "function" ? key : (value: T) => readAttribute(value, key);
		return collectjs(this.all())
			.keyBy((item: T, index?: number) => callback(item, index ?? 0))
			.all() as unknown as Record<string, T>;
	}

	// -----------------------------------------------------------------------
	// ordering / slicing
	// -----------------------------------------------------------------------

	/** Sorts by a key or callback, ascending. */
	sortBy<K extends keyof T>(key: K, descending?: boolean): Collection<T>;
	sortBy(key: string, descending?: boolean): Collection<T>;
	sortBy<U>(
		callback: (value: T, key: number) => U,
		descending?: boolean,
	): Collection<T>;
	sortBy<U>(
		key: keyof T | string | ((value: T, key: number) => U),
		descending = false,
	): Collection<T> {
		const callback =
			typeof key === "function"
				? key
				: (value: T) => readAttribute(value, key) as U;
		const decorated = this.map((value, index) => ({
			value,
			index,
			key: callback(value, index),
		}));
		decorated.sort((left, right) => {
			const a = left.key as unknown;
			const b = right.key as unknown;
			if (a === b) return left.index - right.index;
			if (a === null || a === undefined) return 1;
			if (b === null || b === undefined) return -1;
			const result = a < b ? -1 : 1;
			return descending ? -result : result;
		});
		return Collection.make(decorated.map((entry) => entry.value));
	}

	/** Sorts by a key or callback, descending. */
	sortByDesc<K extends keyof T>(key: K): Collection<T>;
	sortByDesc(key: string): Collection<T>;
	sortByDesc<U>(callback: (value: T, key: number) => U): Collection<T>;
	sortByDesc<U>(
		key: keyof T | string | ((value: T, key: number) => U),
	): Collection<T> {
		return this.sortBy(key as never, true);
	}

	/** Sorts by the natural ordering of the values. */
	override sort(compareFn?: (a: T, b: T) => number): this {
		Array.prototype.sort.call(this, compareFn);
		return this;
	}

	/** Reverses a copy of the collection. */
	override reverse(): Collection<T> {
		return Collection.make([...this].reverse());
	}

	/** A slice as a collection. */
	override slice(start?: number, end?: number): Collection<T> {
		return Collection.make(Array.prototype.slice.call(this, start, end));
	}

	/** Merges another iterable into a new collection. */
	merge(other: Iterable<T>): Collection<T> {
		return Collection.make([...this, ...other]);
	}

	/** The first `size` items. */
	take(size: number): Collection<T> {
		return size >= 0 ? this.slice(0, size) : this.slice(size);
	}

	/** Skips the first `size` items. */
	skip(size: number): Collection<T> {
		return this.slice(Math.max(0, size));
	}

	/** Splits into chunks (each chunk is a collection). */
	chunk(size: number): Collection<Collection<T>> {
		if (!Number.isInteger(size) || size <= 0) {
			throw new RangeError("chunk(): size must be a positive integer.");
		}
		const chunks: Collection<T>[] = [];
		for (let index = 0; index < this.length; index += size) {
			chunks.push(this.slice(index, index + size));
		}
		return Collection.make(chunks);
	}

	/** Removes duplicate values (or duplicate callback keys). */
	unique<U = T>(callback?: (value: T, key: number) => U): Collection<T> {
		const seen = new Set<unknown>();
		const output: T[] = [];
		this.each((value, index) => {
			const key = callback === undefined ? value : callback(value, index);
			if (seen.has(key)) return;
			seen.add(key);
			output.push(value);
		});
		return Collection.make(output);
	}

	// -----------------------------------------------------------------------
	// numeric helpers
	// -----------------------------------------------------------------------

	/** Sum of a numeric key or callback result. */
	sum(): number;
	sum<K extends keyof T>(key: K): number;
	sum(key: string): number;
	sum<U extends number>(callback: (value: T, key: number) => U): number;
	sum<U extends number>(key?: string | ((value: T, key: number) => U)): number {
		let total = 0;
		this.each((value, index) => {
			const amount =
				key === undefined
					? (value as unknown as number)
					: typeof key === "function"
						? key(value, index)
						: (readAttribute(value, key) as number);
			total += Number(amount ?? 0);
		});
		return total;
	}

	/** Average of a numeric key or callback result (`null` when empty). */
	avg(): number | null;
	avg<K extends keyof T>(key: K): number | null;
	avg(key: string): number | null;
	avg<U extends number>(callback: (value: T, key: number) => U): number | null;
	avg<U extends number>(
		key?: string | ((value: T, key: number) => U),
	): number | null {
		if (this.length === 0) return null;
		return (this.sum as (key?: unknown) => number)(key) / this.length;
	}

	/** Smallest value of a numeric key or callback result (`null` when empty). */
	min(): number | null;
	min<K extends keyof T>(key: K): number | null;
	min(key: string): number | null;
	min<U extends number>(callback: (value: T) => U): number | null;
	min<U extends number>(key?: string | ((value: T) => U)): number | null {
		if (this.length === 0) return null;
		let result = Number.POSITIVE_INFINITY;
		this.each((value) => {
			const amount =
				key === undefined
					? (value as unknown as number)
					: typeof key === "function"
						? key(value)
						: (readAttribute(value, key) as number);
			result = Math.min(result, Number(amount));
		});
		return result;
	}

	/** Largest value of a numeric key or callback result (`null` when empty). */
	max(): number | null;
	max<K extends keyof T>(key: K): number | null;
	max(key: string): number | null;
	max<U extends number>(callback: (value: T) => U): number | null;
	max<U extends number>(key?: string | ((value: T) => U)): number | null {
		if (this.length === 0) return null;
		let result = Number.NEGATIVE_INFINITY;
		this.each((value) => {
			const amount =
				key === undefined
					? (value as unknown as number)
					: typeof key === "function"
						? key(value)
						: (readAttribute(value, key) as number);
			result = Math.max(result, Number(amount));
		});
		return result;
	}

	/** Reduction over the collection. */
	override reduce(
		callback: (carry: T, value: T, index: number, array: T[]) => T,
	): T;
	override reduce(
		callback: (carry: T, value: T, index: number, array: T[]) => T,
		initialValue: T,
	): T;
	override reduce<U>(
		callback: (carry: U, value: T, index: number, array: T[]) => U,
		initialValue: U,
	): U;
	override reduce<U>(callback: Reducer<T, U>, initialValue?: U): U {
		let carry = (initialValue ?? (this[0] as unknown)) as U;
		const start = initialValue === undefined ? 1 : 0;
		for (let index = start; index < this.length; index += 1) {
			carry = callback(carry, this[index]!, index, this);
		}
		return carry;
	}

	// -----------------------------------------------------------------------
	// filtering by value
	// -----------------------------------------------------------------------

	/** Keeps items whose `key` equals `value` (Eloquent `where`). */
	where<K extends keyof T>(key: K, value: T[K]): Collection<T>;
	where<K extends keyof T>(
		key: K,
		operator: "=" | "==" | "===" | "!=" | "<>" | ">" | ">=" | "<" | "<=",
		value: T[K],
	): Collection<T>;
	where(key: string, value: unknown): Collection<T>;
	where(
		key: string,
		operator: "=" | "==" | "===" | "!=" | "<>" | ">" | ">=" | "<" | "<=",
		value: unknown,
	): Collection<T>;
	where(
		key: PropertyKey,
		operatorOrValue: unknown,
		value?: unknown,
	): Collection<T> {
		const hasOperator = value !== undefined;
		const operator = hasOperator ? String(operatorOrValue) : "=";
		const expected: unknown = hasOperator ? value : operatorOrValue;
		return this.filter((item) => {
			const actual = readAttribute(item, key as PropertyKey);
			switch (operator) {
				case "=":
				case "==":
				case "===":
					return actual === expected;
				case "!=":
				case "<>":
					return actual !== expected;
				case ">":
					return (actual as never) > (expected as never);
				case ">=":
					return (actual as never) >= (expected as never);
				case "<":
					return (actual as never) < (expected as never);
				case "<=":
					return (actual as never) <= (expected as never);
				default:
					throw new Error(
						`Unsupported collection where operator "${operator}".`,
					);
			}
		});
	}

	/** Keeps items whose `key` is one of `values`. */
	whereIn<K extends keyof T>(key: K, values: readonly T[K][]): Collection<T>;
	whereIn(key: string, values: readonly unknown[]): Collection<T>;
	whereIn(key: PropertyKey, values: readonly unknown[]): Collection<T> {
		const allowed = new Set<unknown>(values);
		return this.filter((item) => allowed.has(readAttribute(item, key)));
	}

	/** Keeps items whose `key` is not one of `values`. */
	whereNotIn<K extends keyof T>(key: K, values: readonly T[K][]): Collection<T>;
	whereNotIn(key: string, values: readonly unknown[]): Collection<T>;
	whereNotIn(key: PropertyKey, values: readonly unknown[]): Collection<T> {
		const rejected = new Set<unknown>(values);
		return this.filter((item) => !rejected.has(readAttribute(item, key)));
	}

	/** Keeps items whose `key` is null or undefined. */
	whereNull<K extends keyof T>(key: K): Collection<T>;
	whereNull(key: string): Collection<T>;
	whereNull(key: PropertyKey): Collection<T> {
		return this.filter(
			(item) =>
				readAttribute(item, key) === null ||
				readAttribute(item, key) === undefined,
		);
	}

	/** Keeps items whose `key` is not null or undefined. */
	whereNotNull<K extends keyof T>(key: K): Collection<T>;
	whereNotNull(key: string): Collection<T>;
	whereNotNull(key: PropertyKey): Collection<T> {
		return this.filter(
			(item) =>
				readAttribute(item, key) !== null &&
				readAttribute(item, key) !== undefined,
		);
	}

	/** Keeps items whose `key` lies inside `[min, max]`. */
	whereBetween<K extends keyof T>(
		key: K,
		range: readonly [T[K], T[K]],
	): Collection<T>;
	whereBetween(key: string, range: readonly [unknown, unknown]): Collection<T>;
	whereBetween(
		key: PropertyKey,
		range: readonly [unknown, unknown],
	): Collection<T> {
		return this.filter((item) => {
			const actual = readAttribute(item, key) as never;
			return actual >= (range[0] as never) && actual <= (range[1] as never);
		});
	}
}

/**
 * Creates a collection from an array or iterable.
 *
 * ```ts
 * collect([1, 2, 3]).sum(); // 6
 * ```
 */
export function collect<T>(items: Iterable<T> = []): Collection<T> {
	return Collection.make(items);
}
