// Model factories and seeders.
//
// ```ts
// const user = await User.factory()
//   .define({ name: (index) => `User ${index}`, email: (index) => `user${index}@example.com` })
//   .state({ active: true })
//   .count(3)
//   .create({ active: false });   // Collection<User>
// ```
//
// Definitions are value-or-function maps: a function receives the row index
// (0-based within the factory instance) and returns the value. Values go
// through the same mass-assignment filtering and casts as `Model.create()`,
// so `fillable` / `guarded` behave exactly like Eloquent.
//
// Whole-definition callbacks (`state((attributes) => …)`) receive the
// attributes built so far and may be async — `create()` awaits them, while
// `make()` / `raw()` require synchronous definitions.
//
// The fluent surface mirrors `Database\Factories\Factory`:
//
// ```ts
// const post = await Post.factory()
//   .for(user)                              // belongsTo: sets post.userId
//   .has(Comment.factory(), "comments", 2)  // hasMany: creates 2 comments
//   .afterCreating((post) => log(post))
//   .create();
// ```
//
// Seeders are plain functions or `{ run(orm) }` objects:
//
// ```ts
// await runSeeders(orm, [seedUsers, { run: (orm) => orm.table("teams").insert({...}).run() }]);
// ```

import { Collection } from "../collection";
import { SchemaError } from "../errors";
import type { Orm } from "../orm";
import type { CreateValues } from "../query/types";
import type {
	AnyRelationDescriptor,
	RelationKind,
} from "../relations/descriptors";
import type { Schema, TableName } from "../schema/define";
import { withoutModelEvents } from "./events";
import type { ModelStaticLike } from "./model";

/** A factory value: a literal, or a function of the 0-based row index. */
export type FactoryValue<V> = V | ((index: number) => V | Promise<V>);

/** Definition map for one model — every create value, all optional. */
export type FactoryDefinition<S extends Schema, T extends TableName<S>, M> = {
	[K in keyof CreateValues<M, S, T>]?: FactoryValue<CreateValues<M, S, T>[K]>;
};

/**
 * Whole-definition callback (Eloquent's `state(fn (array $attributes) => …)`).
 * Receives the attributes built so far and returns more of them; it may be
 * async (`create()` awaits it).
 */
export type FactoryDefinitionCallback<
	S extends Schema,
	T extends TableName<S>,
	M,
> = (
	attributes: Record<string, unknown>,
) => FactoryDefinition<S, T, M> | Promise<FactoryDefinition<S, T, M>>;

/** Per-instance hook (`afterMaking` / `afterCreating` / `after`). */
export type FactoryHook<M> = (model: M, index: number) => void | Promise<void>;

/** Instance-building callbacks supplied by `Model.factory()` (internal). */
export interface FactoryHandlers<M> {
	make: (values: Record<string, unknown>) => M;
	create: (values: Record<string, unknown>) => Promise<M>;
}

/** A definition source: an attribute map or a whole-definition callback. */
type InternalDefinition =
	| Record<string, unknown>
	| ((attributes: Record<string, unknown>) => unknown);

/** Minimal structural surface of another factory used by relations. */
interface RelatedFactoryLike {
	createOne(overrides?: Record<string, unknown>): Promise<unknown>;
}

/** Model class statics a relation resolves at runtime. */
interface FactoryModelClass extends ModelStaticLike {
	factory?: () => unknown;
}

/** `for()` — the parent belongs to an existing or created owner. */
interface ForSpec {
	readonly owner: object;
	readonly relation?: string;
}

/** `has()` — children created after the parent is persisted. */
interface HasSpec {
	readonly related: object;
	readonly name?: string;
	readonly count: number;
}

/** `hasAttached()` — pivot rows created after the parent is persisted. */
interface AttachSpec extends HasSpec {
	readonly attributes: Record<string, unknown>;
}

function isThenable(value: unknown): value is Promise<unknown> {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { then?: unknown }).then === "function"
	);
}

function resolveValueSync(value: unknown, index: number): unknown {
	if (typeof value !== "function") return value;
	const resolved = (value as (index: number) => unknown)(index);
	if (isThenable(resolved)) {
		throw new SchemaError(
			"Factory: make()/raw() received an async definition value — use create() for async definitions.",
		);
	}
	return resolved;
}

async function resolveValueAsync(
	value: unknown,
	index: number,
): Promise<unknown> {
	if (typeof value !== "function") return value;
	return await (value as (index: number) => unknown)(index);
}

/** Reads attributes from an ORM model, or a plain record. */
function readModelAttributes(model: object): Record<string, unknown> {
	const candidate = model as { attributes?: () => Record<string, unknown> };
	if (typeof candidate.attributes === "function") return candidate.attributes();
	return model as Record<string, unknown>;
}

function requireRelationKey(
	key: string | undefined,
	relation: string,
	kind: string,
): string {
	if (key === undefined) {
		throw new SchemaError(
			`Factory: relation "${relation}" (${kind}) is missing a required key.`,
		);
	}
	return key;
}

/**
 * Fluent factory (Eloquent's `Model::factory()`).
 *
 * ```ts
 * const users = await User.factory()
 *   .define({ email: (index) => `user${index}@example.com` })
 *   .count(2)
 *   .create();
 * ```
 */
export class Factory<S extends Schema, T extends TableName<S>, M> {
	readonly #handlers: FactoryHandlers<M>;
	#definitions: InternalDefinition[] = [];
	#states: InternalDefinition[] = [];
	#sequenceItems: InternalDefinition[] = [];
	#count = 1;
	#sequence = 0;
	#for: ForSpec[] = [];
	#has: HasSpec[] = [];
	#hasAttached: AttachSpec[] = [];
	#recycled: object[] = [];
	#afterMaking: Array<FactoryHook<M>> = [];
	#afterCreating: Array<FactoryHook<M>> = [];
	#after: Array<FactoryHook<M>> = [];
	#class: FactoryModelClass | undefined;

	/** @internal */
	constructor(handlers: FactoryHandlers<M>) {
		this.#handlers = handlers;
	}

	/**
	 * Builds a definition value that cycles through `values` by row index —
	 * usable *inside* a definition map (Eloquent's `Sequence`):
	 *
	 * ```ts
	 * await User.factory()
	 *   .define({ role: Factory.sequence(["admin", "user"]) })
	 *   .count(3)
	 *   .create();
	 * ```
	 */
	static sequence<V>(values: readonly V[]): (index: number) => V {
		if (values.length === 0) {
			throw new SchemaError("Factory.sequence(): expected at least one value.");
		}
		return (index: number) => values[index % values.length]!;
	}

	// -----------------------------------------------------------------------
	// definition
	// -----------------------------------------------------------------------

	/** Merges attribute defaults; chainable. */
	define(
		definition: FactoryDefinition<S, T, M> | FactoryDefinitionCallback<S, T, M>,
	): this {
		this.#definitions.push(definition as unknown as InternalDefinition);
		return this;
	}

	/**
	 * Adds a state applied after `define` (call repeatedly to stack). Accepts
	 * an attribute map or a whole-definition callback receiving the attributes
	 * built so far.
	 */
	state(
		definition: FactoryDefinition<S, T, M> | FactoryDefinitionCallback<S, T, M>,
	): this {
		this.#states.push(definition as unknown as InternalDefinition);
		return this;
	}

	/**
	 * Cycles a list of attribute maps across the produced rows (Eloquent's
	 * `sequence()`): row `n` receives `items[n % items.length]`.
	 *
	 * ```ts
	 * await User.factory()
	 *   .count(3)
	 *   .sequence([{ role: "admin" }, { role: "user" }])
	 *   .create();
	 * ```
	 */
	sequence(
		items: ReadonlyArray<
			FactoryDefinition<S, T, M> | FactoryDefinitionCallback<S, T, M>
		>,
	): this {
		if (items.length === 0) {
			throw new SchemaError("Factory.sequence(): expected at least one item.");
		}
		this.#sequenceItems.push(...(items as unknown as InternalDefinition[]));
		return this;
	}

	/** Number of models produced by `make()` / `create()` (default 1). */
	count(count: number): this {
		if (!Number.isInteger(count) || count < 0) {
			throw new SchemaError(
				`Factory.count(): expected a non-negative integer, got ${count}.`,
			);
		}
		this.#count = count;
		return this;
	}

	/** Eloquent alias for {@link count}. */
	times(count: number): this {
		return this.count(count);
	}

	// -----------------------------------------------------------------------
	// relationships
	// -----------------------------------------------------------------------

	/**
	 * Sets the `belongsTo` foreign key on every produced row (Eloquent's
	 * `for()`). The owner may be a model instance, a model class or another
	 * factory; factory/class owners are created through `create()`.
	 */
	for(owner: object, relation?: string): this {
		this.#assertTarget(owner, "for");
		this.#for.push({ owner, relation });
		return this;
	}

	/**
	 * Creates related rows after the parent is persisted (Eloquent's `has()`):
	 * `hasMany` / `hasOne` / `morphMany` / `morphOne`. The relation is resumed
	 * on the parent, so `parent.posts` works after `create()`.
	 */
	has(related: object, name?: string, count = 1): this {
		this.#assertTarget(related, "has");
		this.#assertCount(count, "has");
		this.#has.push({ related, name, count });
		return this;
	}

	/**
	 * Creates related rows and attaches them through a pivot table
	 * (Eloquent's `hasAttached()`): `belongsToMany` / `morphToMany`.
	 */
	hasAttached(
		related: object,
		name?: string,
		count = 1,
		attributes: Record<string, unknown> = {},
	): this {
		this.#assertTarget(related, "hasAttached");
		this.#assertCount(count, "hasAttached");
		this.#hasAttached.push({ related, name, count, attributes });
		return this;
	}

	/**
	 * Registers an existing model instance to be reused (Eloquent's
	 * `recycle()`) when a related owner of the same class would otherwise be
	 * created.
	 */
	recycle(...models: object[]): this {
		for (const model of models) {
			if (model === null || typeof model !== "object") {
				throw new SchemaError("Factory.recycle(): expected model instances.");
			}
			this.#recycled.push(model);
		}
		return this;
	}

	// -----------------------------------------------------------------------
	// hooks / configuration
	// -----------------------------------------------------------------------

	/** Runs `callback` for every model after it is built. */
	afterMaking(callback: FactoryHook<M>): this {
		this.#afterMaking.push(this.#assertHook(callback, "afterMaking"));
		return this;
	}

	/** Runs `callback` for every model after it is persisted. */
	afterCreating(callback: FactoryHook<M>): this {
		this.#afterCreating.push(this.#assertHook(callback, "afterCreating"));
		return this;
	}

	/**
	 * Runs `callback` for every model produced by either `make()` or
	 * `create()` (a combined alias of the two hooks).
	 */
	after(callback: FactoryHook<M>): this {
		this.#after.push(this.#assertHook(callback, "after"));
		return this;
	}

	/**
	 * Invokes `configurator` with this factory (Eloquent's `configure()`),
	 * making reusable factory presets possible:
	 *
	 * ```ts
	 * User.factory().configure((factory) => factory.state({ active: true })).create();
	 * ```
	 */
	configure(configurator: (factory: this) => void): this {
		if (typeof configurator !== "function") {
			throw new SchemaError("Factory.configure(): expected a function.");
		}
		configurator(this);
		return this;
	}

	// -----------------------------------------------------------------------
	// building
	// -----------------------------------------------------------------------

	/** Builds unsaved model instances. */
	make(overrides: FactoryDefinition<S, T, M> = {}): Collection<M> {
		const rows = this.#buildRowsSync(
			overrides as Record<string, unknown>,
			this.#count,
		);
		this.#applyForSync(rows);
		const made: M[] = [];
		for (let index = 0; index < rows.length; index += 1) {
			const model = this.#handlers.make(rows[index]!);
			made.push(model);
			this.#fireSync(this.#afterMaking, model, index);
			this.#fireSync(this.#after, model, index);
		}
		return Collection.make(made);
	}

	/** Builds one unsaved instance (ignores `count`, does not advance it). */
	makeOne(overrides: FactoryDefinition<S, T, M> = {}): M {
		const rows = this.#buildRowsSync(overrides as Record<string, unknown>, 1);
		this.#applyForSync(rows);
		const model = this.#handlers.make(rows[0]!);
		this.#fireSync(this.#afterMaking, model, 0);
		this.#fireSync(this.#after, model, 0);
		return model;
	}

	/** Builds one unsaved instance per definition (Eloquent's `makeMany`). */
	makeMany(
		definitions: ReadonlyArray<FactoryDefinition<S, T, M>>,
	): Collection<M> {
		const made: M[] = [];
		for (let index = 0; index < definitions.length; index += 1) {
			const rows = this.#buildRowsSync(
				definitions[index] as Record<string, unknown>,
				1,
			);
			this.#applyForSync(rows);
			const model = this.#handlers.make(rows[0]!);
			made.push(model);
			this.#fireSync(this.#afterMaking, model, index);
			this.#fireSync(this.#after, model, index);
		}
		return Collection.make(made);
	}

	/** Alias of {@link make} that also names the event-suppression intent. */
	makeQuietly(overrides: FactoryDefinition<S, T, M> = {}): Collection<M> {
		// `make()` never persists, so no model events fire; the alias keeps the
		// Eloquent surface complete.
		return this.make(overrides);
	}

	/** Builds and persists models (one insert per model, events fire). */
	async create(
		overrides: FactoryDefinition<S, T, M> = {},
	): Promise<Collection<M>> {
		const rows = await this.#buildRowsAsync(
			overrides as Record<string, unknown>,
			this.#count,
		);
		await this.#applyForAsync(rows);
		return this.#persistRows(rows);
	}

	/** Builds and persists one instance. */
	async createOne(overrides: FactoryDefinition<S, T, M> = {}): Promise<M> {
		const rows = await this.#buildRowsAsync(
			overrides as Record<string, unknown>,
			1,
		);
		await this.#applyForAsync(rows);
		const created = await this.#persistRows(rows);
		return created[0]!;
	}

	/** Persists one model per definition (Eloquent's `createMany`). */
	async createMany(
		definitions: ReadonlyArray<FactoryDefinition<S, T, M>>,
	): Promise<Collection<M>> {
		const created: M[] = [];
		for (let index = 0; index < definitions.length; index += 1) {
			const rows = await this.#buildRowsAsync(
				definitions[index] as Record<string, unknown>,
				1,
			);
			await this.#applyForAsync(rows);
			const models = await this.#persistRows(rows, index);
			for (const model of models) created.push(model);
		}
		return Collection.make(created);
	}

	/** Persists models with every model event suppressed. */
	createQuietly(
		overrides: FactoryDefinition<S, T, M> = {},
	): Promise<Collection<M>> {
		return withoutModelEvents(() => this.create(overrides));
	}

	/** Eloquent alias for {@link createQuietly}. */
	storeQuietly(
		overrides: FactoryDefinition<S, T, M> = {},
	): Promise<Collection<M>> {
		return this.createQuietly(overrides);
	}

	// -----------------------------------------------------------------------
	// accessors
	// -----------------------------------------------------------------------

	/**
	 * The raw attribute rows `make()` would build, without instantiating or
	 * persisting anything (and without consuming the row sequence).
	 */
	raw(
		overrides: FactoryDefinition<S, T, M> = {},
	): Array<Record<string, unknown>> {
		const saved = this.#sequence;
		try {
			return this.#buildRowsSync(
				overrides as Record<string, unknown>,
				this.#count,
			);
		} finally {
			this.#sequence = saved;
		}
	}

	/** The registered states, in application order. */
	states(): ReadonlyArray<
		FactoryDefinition<S, T, M> | FactoryDefinitionCallback<S, T, M>
	> {
		return [...this.#states] as ReadonlyArray<
			FactoryDefinition<S, T, M> | FactoryDefinitionCallback<S, T, M>
		>;
	}

	// -----------------------------------------------------------------------
	// internals
	// -----------------------------------------------------------------------

	#modelClass(): FactoryModelClass {
		if (this.#class !== undefined) return this.#class;
		const instance = this.#handlers.make({});
		const ctor = (instance as { constructor?: unknown }).constructor;
		if (ctor === undefined || typeof ctor !== "function") {
			throw new SchemaError(
				"Factory: could not resolve the model class from its handlers.",
			);
		}
		this.#class = ctor as unknown as FactoryModelClass;
		return this.#class;
	}

	#primaryKeyOf(cls: FactoryModelClass): string | null {
		return cls.__orm.internalMeta(cls.__table as never).primaryKey;
	}

	#assertTarget(target: object, caller: string): void {
		if (target === null) {
			throw new SchemaError(
				`Factory.${caller}(): expected a model instance, model class or factory.`,
			);
		}
		if (typeof target !== "object" && typeof target !== "function") {
			throw new SchemaError(
				`Factory.${caller}(): expected a model instance, model class or factory.`,
			);
		}
	}

	#assertCount(count: number, caller: string): void {
		if (!Number.isInteger(count) || count < 0) {
			throw new SchemaError(
				`Factory.${caller}(): expected a non-negative integer count, got ${count}.`,
			);
		}
	}

	#assertHook(callback: FactoryHook<M>, caller: string): FactoryHook<M> {
		if (typeof callback !== "function") {
			throw new SchemaError(`Factory.${caller}(): expected a function.`);
		}
		return callback;
	}

	#classOfTarget(target: object): FactoryModelClass {
		if (target instanceof Factory) {
			return (
				target as unknown as Factory<Schema, TableName<Schema>, unknown>
			).#modelClass();
		}
		if (typeof target === "function") {
			return target as unknown as FactoryModelClass;
		}
		const ctor = (target as { constructor?: unknown }).constructor;
		if (ctor === undefined || typeof ctor !== "function") {
			throw new SchemaError(
				"Factory: expected a model instance, model class or factory.",
			);
		}
		return ctor as unknown as FactoryModelClass;
	}

	/** A factory for the related model of a `has()` / `hasAttached()` spec. */
	#factoryFor(target: object): RelatedFactoryLike {
		if (target instanceof Factory) {
			return target as unknown as RelatedFactoryLike;
		}
		if (typeof target === "function") {
			const factory = (target as { factory?: unknown }).factory;
			if (typeof factory !== "function") {
				throw new SchemaError(
					"Factory.has(): the model class does not expose a factory().",
				);
			}
			return factory.call(target) as RelatedFactoryLike;
		}
		throw new SchemaError(
			"Factory.has(): pass a factory or a model class, not a model instance.",
		);
	}

	/** Finds a relation by name, or by matching the related model class. */
	#findRelation(
		kinds: ReadonlyArray<RelationKind>,
		relatedClass: FactoryModelClass,
		name: string | undefined,
		caller: string,
	): { name: string; descriptor: AnyRelationDescriptor } {
		const modelClass = this.#modelClass();
		const relations = modelClass.relations ?? {};
		if (name !== undefined) {
			const descriptor = relations[name];
			if (descriptor === undefined) {
				throw new SchemaError(
					`Factory.${caller}(): relation "${name}" is not defined on "${modelClass.__table}".`,
				);
			}
			if (!kinds.includes(descriptor.kind)) {
				throw new SchemaError(
					`Factory.${caller}("${name}"): relation is ${descriptor.kind}, expected ${kinds.join(" / ")}.`,
				);
			}
			return { name, descriptor };
		}
		for (const [candidate, descriptor] of Object.entries(relations)) {
			if (!kinds.includes(descriptor.kind)) continue;
			if (descriptor.related?.() === relatedClass) {
				return { name: candidate, descriptor };
			}
		}
		throw new SchemaError(
			`Factory.${caller}(): no ${kinds.join(" / ")} relation on "${modelClass.__table}" targets "${relatedClass.__table}". Pass the relation name explicitly.`,
		);
	}

	/** Pops a recycled instance matching `cls`, if any. */
	#takeRecycled(cls: object): object | undefined {
		for (let index = 0; index < this.#recycled.length; index += 1) {
			const candidate = this.#recycled[index]!;
			if ((candidate as { constructor: object }).constructor === cls) {
				this.#recycled.splice(index, 1);
				return candidate;
			}
		}
		return undefined;
	}

	#elements(): InternalDefinition[] {
		return [...this.#definitions, ...this.#states];
	}

	#mergeSync(
		row: Record<string, unknown>,
		source: InternalDefinition,
		index: number,
	): void {
		if (typeof source === "function") {
			const produced = source({ ...row });
			if (isThenable(produced)) {
				throw new SchemaError(
					"Factory: make()/raw() received an async definition — use create() for async definitions.",
				);
			}
			this.#mergeSync(row, produced as InternalDefinition, index);
			return;
		}
		for (const [column, value] of Object.entries(source)) {
			row[column] = resolveValueSync(value, index);
		}
	}

	async #mergeAsync(
		row: Record<string, unknown>,
		source: InternalDefinition,
		index: number,
	): Promise<void> {
		if (typeof source === "function") {
			const produced = await source({ ...row });
			await this.#mergeAsync(row, produced as InternalDefinition, index);
			return;
		}
		for (const [column, value] of Object.entries(source)) {
			row[column] = await resolveValueAsync(value, index);
		}
	}

	#applySequenceSync(row: Record<string, unknown>, index: number): void {
		if (this.#sequenceItems.length === 0) return;
		const item = this.#sequenceItems[index % this.#sequenceItems.length]!;
		this.#mergeSync(row, item, index);
	}

	async #applySequenceAsync(
		row: Record<string, unknown>,
		index: number,
	): Promise<void> {
		if (this.#sequenceItems.length === 0) return;
		const item = this.#sequenceItems[index % this.#sequenceItems.length]!;
		await this.#mergeAsync(row, item, index);
	}

	#buildRowsSync(
		overrides: Record<string, unknown>,
		count: number,
	): Array<Record<string, unknown>> {
		const rows: Array<Record<string, unknown>> = [];
		for (let offset = 0; offset < count; offset += 1) {
			const index = this.#sequence + offset;
			const row: Record<string, unknown> = {};
			for (const source of this.#elements()) {
				this.#mergeSync(row, source, index);
			}
			this.#applySequenceSync(row, index);
			this.#mergeSync(row, overrides, index);
			rows.push(row);
		}
		this.#sequence += count;
		return rows;
	}

	async #buildRowsAsync(
		overrides: Record<string, unknown>,
		count: number,
	): Promise<Array<Record<string, unknown>>> {
		const rows: Array<Record<string, unknown>> = [];
		for (let offset = 0; offset < count; offset += 1) {
			const index = this.#sequence + offset;
			const row: Record<string, unknown> = {};
			for (const source of this.#elements()) {
				await this.#mergeAsync(row, source, index);
			}
			await this.#applySequenceAsync(row, index);
			await this.#mergeAsync(row, overrides, index);
			rows.push(row);
		}
		this.#sequence += count;
		return rows;
	}

	#localKeyValue(parent: unknown, localKey?: string): unknown {
		const key = localKey ?? this.#primaryKeyOf(this.#modelClass()) ?? "id";
		return readModelAttributes(parent as object)[key];
	}

	async #loadRelation(model: unknown, name: string): Promise<void> {
		const loader = model as {
			load?: (...paths: string[]) => Promise<unknown>;
		};
		if (typeof loader.load === "function") await loader.load(name);
	}

	#ownerAttributesSync(spec: ForSpec): Record<string, unknown> {
		if (spec.owner instanceof Factory || typeof spec.owner === "function") {
			const ownerClass = this.#classOfTarget(spec.owner);
			const recycled = this.#takeRecycled(ownerClass);
			if (recycled === undefined) {
				throw new SchemaError(
					"Factory.for(): creating the owner requires create(); pass an existing instance or call create().",
				);
			}
			return readModelAttributes(recycled);
		}
		return readModelAttributes(spec.owner);
	}

	async #ownerAttributes(spec: ForSpec): Promise<Record<string, unknown>> {
		if (spec.owner instanceof Factory) {
			const ownerClass = this.#classOfTarget(spec.owner);
			const recycled = this.#takeRecycled(ownerClass);
			if (recycled !== undefined) return readModelAttributes(recycled);
			const created = await (
				spec.owner as unknown as RelatedFactoryLike
			).createOne();
			return readModelAttributes(created as object);
		}
		if (typeof spec.owner === "function") {
			const ownerClass = this.#classOfTarget(spec.owner);
			const recycled = this.#takeRecycled(ownerClass);
			if (recycled !== undefined) return readModelAttributes(recycled);
			const factory = ownerClass.factory;
			if (typeof factory !== "function") {
				throw new SchemaError(
					"Factory.for(): pass a factory (or an existing instance) as the owner.",
				);
			}
			const created = await (
				factory.call(ownerClass) as RelatedFactoryLike
			).createOne();
			return readModelAttributes(created as object);
		}
		return readModelAttributes(spec.owner);
	}

	#applyForSync(rows: Array<Record<string, unknown>>): void {
		for (const spec of this.#for) {
			const ownerClass = this.#classOfTarget(spec.owner);
			const { name, descriptor } = this.#findRelation(
				["belongsTo"],
				ownerClass,
				spec.relation,
				"for",
			);
			const foreignKey = requireRelationKey(
				descriptor.foreignKey,
				name,
				"belongsTo",
			);
			const ownerKey =
				descriptor.ownerKey ?? this.#primaryKeyOf(ownerClass) ?? "id";
			const value = this.#ownerAttributesSync(spec)[ownerKey];
			for (const row of rows) row[foreignKey] = value;
		}
	}

	async #applyForAsync(rows: Array<Record<string, unknown>>): Promise<void> {
		for (const spec of this.#for) {
			const ownerClass = this.#classOfTarget(spec.owner);
			const { name, descriptor } = this.#findRelation(
				["belongsTo"],
				ownerClass,
				spec.relation,
				"for",
			);
			const foreignKey = requireRelationKey(
				descriptor.foreignKey,
				name,
				"belongsTo",
			);
			const ownerKey =
				descriptor.ownerKey ?? this.#primaryKeyOf(ownerClass) ?? "id";
			const attributes = await this.#ownerAttributes(spec);
			const value = attributes[ownerKey];
			for (const row of rows) row[foreignKey] = value;
		}
	}

	async #createHas(parent: M, spec: HasSpec): Promise<void> {
		const parentClass = this.#modelClass();
		const relatedClass = this.#classOfTarget(spec.related);
		const { name, descriptor } = this.#findRelation(
			["hasMany", "hasOne", "morphMany", "morphOne"],
			relatedClass,
			spec.name,
			"has",
		);
		const related = this.#factoryFor(spec.related);
		const overrides: Record<string, unknown> = {};
		if (descriptor.kind === "hasMany" || descriptor.kind === "hasOne") {
			const foreignKey = requireRelationKey(
				descriptor.foreignKey,
				name,
				descriptor.kind,
			);
			overrides[foreignKey] = this.#localKeyValue(parent, descriptor.localKey);
		} else {
			const morphName = descriptor.morphName;
			if (morphName === undefined) {
				throw new SchemaError(
					`Factory.has("${name}"): morph relation is missing its name.`,
				);
			}
			overrides[descriptor.idColumn ?? `${morphName}Id`] = this.#localKeyValue(
				parent,
				descriptor.localKey,
			);
			overrides[descriptor.typeColumn ?? `${morphName}Type`] =
				parentClass.__orm.morphAlias(parentClass);
		}
		for (let index = 0; index < spec.count; index += 1) {
			await related.createOne(overrides);
		}
		await this.#loadRelation(parent, name);
	}

	async #createAttached(parent: M, spec: AttachSpec): Promise<void> {
		const relatedClass = this.#classOfTarget(spec.related);
		const { name } = this.#findRelation(
			["belongsToMany", "morphToMany"],
			relatedClass,
			spec.name,
			"hasAttached",
		);
		const related = this.#factoryFor(spec.related);
		const relatedKey = this.#primaryKeyOf(relatedClass) ?? "id";
		const ids: unknown[] = [];
		for (let index = 0; index < spec.count; index += 1) {
			const child = await related.createOne();
			ids.push(readModelAttributes(child as object)[relatedKey]);
		}
		const manager = parent as unknown as {
			relation(name: string): {
				attach(
					ids: unknown[],
					attributes?: Record<string, unknown>,
				): Promise<number>;
			};
		};
		await manager.relation(name).attach(ids, spec.attributes);
		await this.#loadRelation(parent, name);
	}

	async #createRelations(parent: M): Promise<void> {
		for (const spec of this.#has) await this.#createHas(parent, spec);
		for (const spec of this.#hasAttached) {
			await this.#createAttached(parent, spec);
		}
	}

	async #persistRows(
		rows: Array<Record<string, unknown>>,
		startIndex = 0,
	): Promise<Collection<M>> {
		const created: M[] = [];
		for (let offset = 0; offset < rows.length; offset += 1) {
			const index = startIndex + offset;
			const model = await this.#handlers.create(rows[offset]!);
			created.push(model);
			await this.#fire(this.#afterMaking, model, index);
			await this.#createRelations(model);
			await this.#fire(this.#afterCreating, model, index);
			await this.#fire(this.#after, model, index);
		}
		return Collection.make(created);
	}

	#fireSync(
		hooks: ReadonlyArray<FactoryHook<M>>,
		model: M,
		index: number,
	): void {
		for (const hook of hooks) {
			const result = hook(model, index);
			if (isThenable(result)) void result;
		}
	}

	async #fire(
		hooks: ReadonlyArray<FactoryHook<M>>,
		model: M,
		index: number,
	): Promise<void> {
		for (const hook of hooks) await hook(model, index);
	}
}

/** A seeder: Eloquent-style object or a plain async function. */
export interface Seeder<S extends Schema> {
	run(orm: Orm<S>): Promise<void> | void;
}

export type SeederLike<S extends Schema> =
	| Seeder<S>
	| ((orm: Orm<S>) => unknown);

/** Helper that types a seeder without losing the ORM generic. */
export function defineSeeder<S extends Schema>(
	seeder: SeederLike<S>,
): SeederLike<S> {
	return seeder;
}

/** Options for {@link runSeeders}. */
export interface SeederOptions {
	/**
	 * Runs the whole seeder list inside one transaction (Eloquent's
	 * `--isolated` behaviour). MySQL DDL still auto-commits.
	 */
	readonly transaction?: boolean;
}

/** Runs seeders in order (`db:seed`). */
export async function runSeeders<S extends Schema>(
	orm: Orm<S>,
	seeders: ReadonlyArray<SeederLike<S>>,
	options: SeederOptions = {},
): Promise<void> {
	const run = async (): Promise<void> => {
		for (const seeder of seeders) {
			if (typeof seeder === "function") {
				await seeder(orm);
			} else {
				await seeder.run(orm);
			}
		}
	};
	if (options.transaction === true) {
		await orm.transaction(run);
		return;
	}
	await run();
}
