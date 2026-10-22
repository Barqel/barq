// Attribute objects — Eloquent's `Attribute` class.
//
// An attribute bundles an accessor and a mutator for one logical property:
//
// ```ts
// class User extends orm.model("users") {
//   static accessors = {
//     fullName: new Attribute({
//       get: (user) => `${user.get("firstName")} ${user.get("lastName")}`,
//     }),
//   };
//   static mutators = {
//     fullName: new Attribute({
//       set: (value: string) => value.trim(),
//     }),
//   };
// }
// ```
//
// The plain-function forms keep working: an accessor is `(model) => value` and
// a mutator is `(value) => value`. An `Attribute` may declare either side (or
// both) — the missing side is simply not applied.

/** Accessor/mutator pair of one logical attribute. */
export interface AttributeDefinition<TGet = unknown, TSet = unknown> {
	/** Reads the attribute: `(model, rawValue) => value`. */
	readonly get?: (model: never, value: unknown) => TGet;
	/** Writes the attribute: `(value, model) => storedValue`. */
	readonly set?: (value: TSet, model: never) => unknown;
}

/**
 * An accessor/mutator pair.
 *
 * Use {@link Attribute.make}, {@link Attribute.get} and {@link Attribute.set}
 * to build one, or pass a definition object to the constructor.
 */
export class Attribute<TGet = unknown, TSet = unknown> {
	readonly #definition: AttributeDefinition<TGet, TSet>;

	constructor(definition: AttributeDefinition<TGet, TSet> = {}) {
		this.#definition = definition;
	}

	/** Builds an attribute from a definition object. */
	static make<TGet, TSet>(
		definition: AttributeDefinition<TGet, TSet>,
	): Attribute<TGet, TSet>;
	/** Builds a read-only attribute. */
	static make<TGet>(
		get: (model: never, value: unknown) => TGet,
	): Attribute<TGet, never>;
	static make<TGet, TSet>(
		definitionOrGet:
			| AttributeDefinition<TGet, TSet>
			| ((model: never, value: unknown) => TGet),
	): Attribute<TGet, TSet> {
		return typeof definitionOrGet === "function"
			? new Attribute<TGet, TSet>({ get: definitionOrGet })
			: new Attribute<TGet, TSet>(definitionOrGet);
	}

	/** Builds a read-only attribute. */
	static get<TGet>(
		get: (model: never, value: unknown) => TGet,
	): Attribute<TGet, never> {
		return new Attribute<TGet, never>({ get });
	}

	/** Builds a write-only attribute. */
	static set<TSet>(
		set: (value: TSet, model: never) => unknown,
	): Attribute<never, TSet> {
		return new Attribute<never, TSet>({ set });
	}

	/** Whether the attribute declares an accessor. */
	hasGetter(): boolean {
		return this.#definition.get !== undefined;
	}

	/** Whether the attribute declares a mutator. */
	hasSetter(): boolean {
		return this.#definition.set !== undefined;
	}

	/** Reads the attribute — `undefined` when no accessor is declared. */
	read(model: object, value: unknown): TGet | undefined {
		const get = this.#definition.get;
		if (get === undefined) return undefined;
		return get(model as never, value);
	}

	/** Writes the attribute — the value passes through when no mutator exists. */
	write(value: TSet, model: object): unknown {
		const set = this.#definition.set;
		if (set === undefined) return value;
		return set(value, model as never);
	}
}

/** `true` when the value is an {@link Attribute} instance. */
export function isAttribute(value: unknown): value is Attribute {
	return value instanceof Attribute;
}
