// The model layer.
//
// A model class is created through `orm.model(table)` and extended by the
// application:
//
//   class User extends orm.model("users") {
//     static relations = { posts: hasMany(() => Post, "userId") };
//     static casts = { settings: "json" as const };
//     static fillable = ["name", "email"] as const;
//   }
//
// The factory returns a `ModelClass<S, T>` whose static members are fully
// typed from the schema. The runtime base (`Model`) implements those statics
// against erased generics; the typed interface is applied by the factory —
// one documented assertion boundary, reviewed in tests.

import type { CompiledQuery } from "kysely";
import { Collection } from "../collection";
import {
	InvalidModelUsageError,
	InvalidQueryError,
	ModelNotFoundError,
	RelationNotLoadedError,
	SchemaError,
} from "../errors";
import type { Orm, TableMeta } from "../orm";
import { QueryBuilder } from "../query/builder";
import type { RowPlan } from "../query/hydrate";
import { hydrateRow } from "../query/hydrate";
import type {
	CastedValues,
	CreateValues,
	GlobalScopeNamesOf,
	NumericColumnOf,
	WithAccessors,
} from "../query/types";
import type { AnyRelations } from "../relations/descriptors";
import {
	createRelationManager,
	type RelationManager,
	type RelationManagerDeps,
} from "../relations/manager";
import type {
	ColumnNameOf,
	PrimaryKeyValueOf,
	RowOf,
	Schema,
	TableName,
	UpdateOf,
} from "../schema/define";
import { type CastSpec, type ResolvedCast, resolveCast } from "./casts";
import {
	emitModelEvent,
	type ModelEventListener,
	type ModelEventName,
	type ModelObserver,
	observeModel,
	onModelEvent,
	withoutModelEvents,
} from "./events";

/** Guard token for the protected constructor. */
const HYDRATE_TOKEN: unique symbol = Symbol("barq.orm.hydrateToken");

/** Applied to a hydrated instance. */
const HYDRATE_INSTANCE: unique symbol = Symbol("barq.orm.hydrateInstance");

/** Access to model internals from the eager loader / query builder. */
export const MODEL_INTERNALS: unique symbol = Symbol("barq.orm.modelInternals");

/** Internal view of a model instance used by relations and hydration. */
export interface ModelInternals {
	attributes(): Record<string, unknown>;
	assign(values: Record<string, unknown>): void;
	setRelation(name: string, value: unknown): void;
	relations(): Record<string, unknown>;
	extras(): Record<string, unknown>;
	setExtra(name: string, value: unknown): void;
	persisted(): boolean;
	/** Copies this instance (same class, state and overrides). */
	clone(): object;
}

/** Static (runtime) shape of a model class bound to an ORM. */
export interface ModelStaticLike {
	readonly __table: string;
	readonly __orm: Orm<Schema>;
	readonly relations?: AnyRelations;
	readonly fillable?: readonly string[];
	readonly guarded?: readonly string[];
	readonly casts?: Readonly<Record<string, CastSpec>>;
	readonly hidden?: readonly string[];
	readonly visible?: readonly string[];
	readonly appends?: readonly string[];
	readonly accessors?: Readonly<Record<string, (model: never) => unknown>>;
	readonly mutators?: Readonly<Record<string, (value: never) => unknown>>;
	readonly softDeletes?: boolean | { readonly column?: string };
	readonly morphAlias?: string;
	/** Relations whose owners receive a timestamp touch when this model saves. */
	readonly touches?: readonly string[];
	/** Global scopes applied to every query for this model. */
	readonly globalScopes?: Readonly<Record<string, (query: unknown) => void>>;
	/** Named local scopes callable through `query().scope("name", ...args)`. */
	readonly scopes?: Readonly<
		Record<string, (query: unknown, ...args: unknown[]) => void>
	>;
	readonly timestamps?:
		| boolean
		| {
				readonly createdAt?: string | null;
				readonly updatedAt?: string | null;
		  };
	new (token?: symbol): AnyModel;
}

/** Resolved per-class metadata. Cached in a WeakMap. */
export interface ModelMeta {
	readonly cls: object;
	readonly orm: Orm<Schema>;
	readonly table: string;
	readonly columns: TableMeta["columns"];
	readonly plan: RowPlan;
	readonly generated: ReadonlySet<string>;
	readonly defaults: ReadonlySet<string>;
	readonly primaryKey: string | null;
	readonly relations: AnyRelations;
	readonly fillable: ReadonlySet<string> | null;
	readonly guarded: ReadonlySet<string> | null;
	readonly casts: Readonly<Record<string, ResolvedCast>>;
	readonly hidden: ReadonlySet<string>;
	readonly visible: ReadonlySet<string> | null;
	readonly appends: readonly string[];
	readonly accessors: Readonly<Record<string, (model: object) => unknown>>;
	readonly mutators: Readonly<Record<string, (value: unknown) => unknown>>;
	readonly softDelete: { column: string } | null;
	readonly touches: readonly string[];
	readonly globalScopes: Readonly<Record<string, (query: unknown) => void>>;
	readonly localScopes: Readonly<
		Record<string, (query: unknown, ...args: unknown[]) => void>
	>;
	readonly timestamps: {
		createdAt: string | null;
		updatedAt: string | null;
	} | null;
}

const MODEL_META = new WeakMap<object, ModelMeta>();
const ACCESSORS_INSTALLED = new WeakSet<object>();

function resolveTimestamps(
	config: ModelStaticLike["timestamps"],
	tableMeta: TableMeta,
	table: string,
): { createdAt: string | null; updatedAt: string | null } | null {
	const has = (column: string) => Object.hasOwn(tableMeta.columns, column);
	if (config === false) return null;
	if (config === true) {
		if (!has("createdAt") || !has("updatedAt")) {
			throw new SchemaError(
				`${table}: "static timestamps = true" requires "createdAt" and "updatedAt" columns.`,
			);
		}
		return { createdAt: "createdAt", updatedAt: "updatedAt" };
	}
	if (config !== undefined) {
		const createdAt =
			config.createdAt === undefined ? "createdAt" : config.createdAt;
		const updatedAt =
			config.updatedAt === undefined ? "updatedAt" : config.updatedAt;
		if (createdAt !== null && !has(createdAt)) {
			throw new SchemaError(
				`${table}: timestamp column "${createdAt}" does not exist. Add it to the schema or set it to null.`,
			);
		}
		if (updatedAt !== null && !has(updatedAt)) {
			throw new SchemaError(
				`${table}: timestamp column "${updatedAt}" does not exist. Add it to the schema or set it to null.`,
			);
		}
		return { createdAt, updatedAt };
	}
	// Auto-detection: manage whichever conventional columns exist.
	return {
		createdAt: has("createdAt") ? "createdAt" : null,
		updatedAt: has("updatedAt") ? "updatedAt" : null,
	};
}

function resolveSoftDelete(
	config: ModelStaticLike["softDeletes"],
	tableMeta: TableMeta,
	table: string,
): { column: string } | null {
	if (config === undefined || config === false) return null;
	const column =
		typeof config === "object" && config.column !== undefined
			? config.column
			: "deletedAt";
	if (!Object.hasOwn(tableMeta.columns, column)) {
		throw new SchemaError(
			`${table}: soft deletes are enabled but column "${column}" does not exist. Add it to the schema (nullable datetime) or set the column name explicitly.`,
		);
	}
	return { column };
}

function installAccessorGetters(cls: object, meta: ModelMeta): void {
	if (ACCESSORS_INSTALLED.has(cls)) return;
	ACCESSORS_INSTALLED.add(cls);
	const prototype = (cls as { prototype: object }).prototype;
	for (const [name, accessor] of Object.entries(meta.accessors)) {
		if (name in Model.prototype) {
			throw new SchemaError(
				`${meta.table}: accessor "${name}" collides with a model method. Choose another name.`,
			);
		}
		if (Object.hasOwn(meta.columns, name)) {
			throw new SchemaError(
				`${meta.table}: accessor "${name}" collides with a column. Rename the accessor or the column.`,
			);
		}
		Object.defineProperty(prototype, name, {
			configurable: true,
			enumerable: false,
			get(this: AnyModel) {
				return accessor(this);
			},
		});
	}
}

/**
 * Resolves (and caches) the metadata of a model class.
 * @internal
 */
export function resolveModelMeta(cls: object): ModelMeta {
	const cached = MODEL_META.get(cls);
	if (cached) return cached;
	const runtime = cls as ModelStaticLike;
	if (!runtime.__orm || !runtime.__table) {
		throw new InvalidModelUsageError(
			"Model class is not bound to an ORM. Create it through orm.model(table).",
		);
	}
	const orm = runtime.__orm;
	const tableMeta = orm.internalMeta(runtime.__table as never);
	const casts: Record<string, ResolvedCast> = {};
	for (const [column, spec] of Object.entries(runtime.casts ?? {})) {
		if (!Object.hasOwn(tableMeta.columns, column)) {
			throw new SchemaError(
				`${runtime.__table}: cast declared for unknown column "${column}".`,
			);
		}
		casts[column] = resolveCast(spec, {
			table: runtime.__table,
			column,
			encryptionKey: orm.encryptionKey,
		});
	}
	const accessors = { ...(runtime.accessors ?? {}) } as Record<
		string,
		(model: object) => unknown
	>;
	const mutators = { ...(runtime.mutators ?? {}) } as Record<
		string,
		(value: unknown) => unknown
	>;
	for (const [name, value] of Object.entries(accessors)) {
		if (typeof value !== "function") {
			throw new SchemaError(
				`${runtime.__table}: accessor "${name}" must be a function.`,
			);
		}
	}
	for (const [column, value] of Object.entries(mutators)) {
		if (!Object.hasOwn(tableMeta.columns, column)) {
			throw new SchemaError(
				`${runtime.__table}: mutator declared for unknown column "${column}".`,
			);
		}
		if (typeof value !== "function") {
			throw new SchemaError(
				`${runtime.__table}: mutator "${column}" must be a function.`,
			);
		}
	}
	const meta: ModelMeta = {
		cls,
		orm,
		table: runtime.__table,
		columns: tableMeta.columns,
		plan: tableMeta.plan,
		generated: tableMeta.generated,
		defaults: tableMeta.defaults,
		primaryKey: tableMeta.primaryKey,
		relations: runtime.relations ?? {},
		fillable: runtime.fillable ? new Set(runtime.fillable) : null,
		guarded: runtime.guarded ? new Set(runtime.guarded) : null,
		casts,
		hidden: new Set(runtime.hidden ?? []),
		visible: runtime.visible ? new Set(runtime.visible) : null,
		appends: [...(runtime.appends ?? [])],
		accessors,
		mutators,
		softDelete: resolveSoftDelete(
			runtime.softDeletes,
			tableMeta,
			runtime.__table,
		),
		touches: [...(runtime.touches ?? [])],
		globalScopes: { ...(runtime.globalScopes ?? {}) },
		localScopes: { ...(runtime.scopes ?? {}) },
		timestamps: resolveTimestamps(
			runtime.timestamps,
			tableMeta,
			runtime.__table,
		),
	};
	MODEL_META.set(cls, meta);
	installAccessorGetters(cls, meta);
	return meta;
}

/**
 * Applies mass-assignment protection and drops generated / unknown keys.
 * Unknown columns throw — typos must not pass silently.
 * @internal
 */
export function filterMassAssignment(
	values: Record<string, unknown>,
	meta: ModelMeta,
	/** "create" drops generated columns; "update" also drops the primary key. */
	mode: "create" | "update",
): Record<string, unknown> {
	const output: Record<string, unknown> = {};
	for (const [column, value] of Object.entries(values)) {
		if (!Object.hasOwn(meta.columns, column)) {
			throw new InvalidQueryError(
				`${meta.table}: unknown column "${column}" in mass assignment.`,
			);
		}
		if (meta.generated.has(column)) continue;
		if (mode === "update" && column === meta.primaryKey) continue;
		if (meta.fillable !== null) {
			if (!meta.fillable.has(column)) continue;
		}
		if (meta.guarded?.has(column)) continue;
		output[column] = value;
	}
	return output;
}

/**
 * Converts one assigned value into its attribute representation: mutator
 * first, then a full cast round-trip (`set` → `get`) so attributes are always
 * stored in their readable form.
 * @internal
 */
export function normalizeAttribute(
	meta: ModelMeta,
	column: string,
	value: unknown,
): unknown {
	const mutator = meta.mutators[column];
	const mutated = mutator === undefined ? value : mutator(value);
	const cast = meta.casts[column];
	if (cast === undefined) return mutated;
	return cast.get(cast.set(mutated));
}

/**
 * Filters mass assignment and normalizes every surviving value.
 * @internal
 */
export function prepareAssignment(
	values: Record<string, unknown>,
	meta: ModelMeta,
	mode: "create" | "update",
): Record<string, unknown> {
	const filtered = filterMassAssignment(values, meta, mode);
	const output: Record<string, unknown> = {};
	for (const [column, value] of Object.entries(filtered)) {
		output[column] = normalizeAttribute(meta, column, value);
	}
	return output;
}

/** Converts attribute values into database values (inverse casts). @internal */
export function toDatabasePayload(
	meta: ModelMeta,
	values: Record<string, unknown>,
): Record<string, unknown> {
	const output: Record<string, unknown> = {};
	for (const [column, value] of Object.entries(values)) {
		if (value === undefined) continue;
		const cast = meta.casts[column];
		output[column] = cast === undefined ? value : cast.set(value);
	}
	return output;
}

/** Adds created/updated timestamps before an insert. @internal */
export function applyTimestampsForCreate(
	meta: ModelMeta,
	payload: Record<string, unknown>,
): void {
	const timestamps = meta.timestamps;
	if (!timestamps) return;
	const now = new Date();
	if (
		timestamps.createdAt !== null &&
		payload[timestamps.createdAt] === undefined
	) {
		payload[timestamps.createdAt] = now;
	}
	if (
		timestamps.updatedAt !== null &&
		payload[timestamps.updatedAt] === undefined
	) {
		payload[timestamps.updatedAt] = now;
	}
}

/** Adds the updated timestamp before an update. @internal */
export function applyTimestampForUpdate(
	meta: ModelMeta,
	payload: Record<string, unknown>,
): void {
	const updatedAt = meta.timestamps?.updatedAt ?? null;
	if (updatedAt === null) return;
	if (payload[updatedAt] === undefined) payload[updatedAt] = new Date();
}

function valuesEqual(left: unknown, right: unknown): boolean {
	if (left instanceof Date && right instanceof Date) {
		return left.getTime() === right.getTime();
	}
	return Object.is(left, right);
}

/** Internal compile boundary — Kysely builder generics are erased here. */
type AnyStatement = any;

/** Instance type of any bound model. */
export type AnyModel = Model<Schema, TableName<Schema>>;

/**
 * Base model class. Applications extend the class returned by `orm.model()`:
 *
 * ```ts
 * class User extends orm.model("users") {}
 * ```
 */
export class Model<
	S extends Schema = Schema,
	T extends TableName<S> = TableName<S>,
> {
	#attributes: Record<string, unknown> = {};
	#original: Record<string, unknown> | null = null;
	#relations: Record<string, unknown> = {};
	#extras: Record<string, unknown> = {};
	#persisted = false;
	#wasRecentlyCreated = false;
	#changes: Record<string, unknown> = {};
	#previous: Record<string, unknown> = {};
	#hiddenOverride = new Set<string>();
	#visibleOverride = new Set<string>();
	#appended = new Set<string>();

	protected constructor(token?: symbol) {
		if (token !== HYDRATE_TOKEN) {
			throw new InvalidModelUsageError(
				"Models cannot be constructed directly. Use Model.create() / Model.find() / Model.query().",
			);
		}
	}

	// -----------------------------------------------------------------------
	// attributes
	// -----------------------------------------------------------------------

	/** Reads an attribute (typed from the schema). */
	get<C extends ColumnNameOf<S, T>>(column: C): RowOf<S, T>[C] {
		const accessor = resolveModelMeta(this.constructor as object).accessors[
			column as string
		];
		if (accessor !== undefined) return accessor(this) as RowOf<S, T>[C];
		return this.#attributes[column] as RowOf<S, T>[C];
	}

	/** Writes an attribute locally (call `save()` to persist). */
	set<C extends ColumnNameOf<S, T>>(column: C, value: RowOf<S, T>[C]): this {
		const meta = resolveModelMeta(this.constructor as object);
		this.#attributes[column] = normalizeAttribute(
			meta,
			column as string,
			value,
		);
		return this;
	}

	/** Mass-assigns attributes locally, respecting fillable/guarded. */
	fill(values: Partial<RowOf<S, T>>): this {
		const meta = resolveModelMeta(this.constructor as object);
		const prepared = prepareAssignment(
			values as Record<string, unknown>,
			meta,
			"create",
		);
		Object.assign(this.#attributes, prepared);
		return this;
	}

	/** A copy of every loaded attribute. */
	attributes(): RowOf<S, T> {
		return { ...this.#attributes } as RowOf<S, T>;
	}

	/** Attributes changed since the last load/save. */
	getDirty(): Partial<RowOf<S, T>> {
		if (!this.#persisted || this.#original === null) {
			return { ...this.#attributes } as Partial<RowOf<S, T>>;
		}
		const dirty: Record<string, unknown> = {};
		for (const [column, value] of Object.entries(this.#attributes)) {
			if (!valuesEqual(this.#original[column], value)) dirty[column] = value;
		}
		return dirty as Partial<RowOf<S, T>>;
	}

	/** Whether any attribute changed since the last load/save. */
	isDirty(): boolean;
	isDirty<C extends ColumnNameOf<S, T>>(column: C): boolean;
	isDirty(column?: string): boolean {
		const dirty = this.getDirty() as Record<string, unknown>;
		return column === undefined
			? Object.keys(dirty).length > 0
			: Object.hasOwn(dirty, column);
	}

	/** Whether no attribute (or one specific attribute) is dirty. */
	isClean(): boolean;
	isClean<C extends ColumnNameOf<S, T>>(column: C): boolean;
	isClean(column?: string): boolean {
		return !this.isDirty(column as never);
	}

	/** Changes applied by the most recent successful save. */
	getChanges(): Partial<RowOf<S, T>> {
		return { ...this.#changes } as Partial<RowOf<S, T>>;
	}

	/** Attributes as they were before the most recent save. */
	getPrevious(): Partial<RowOf<S, T>> {
		return { ...this.#previous } as Partial<RowOf<S, T>>;
	}

	/** Marks the current attributes as the clean baseline. */
	syncOriginal(): this {
		this.#original = { ...this.#attributes };
		return this;
	}

	/** Whether a backing row exists (persisted and not force-deleted). */
	exists(): boolean {
		return this.#persisted;
	}

	/** Whether this instance was inserted during its lifetime. */
	wasRecentlyCreated(): boolean {
		return this.#wasRecentlyCreated;
	}

	/** Primary-key value, or `undefined` when the table has no primary key. */
	getKey(): unknown {
		const meta = resolveModelMeta(this.constructor as object);
		return meta.primaryKey === null
			? undefined
			: this.#attributes[meta.primaryKey];
	}

	/** Primary-key column name, or `null`. */
	getKeyName(): string | null {
		return resolveModelMeta(this.constructor as object).primaryKey;
	}

	/** Copies a subset of the attributes. */
	only<C extends ColumnNameOf<S, T>>(...columns: C[]): Pick<RowOf<S, T>, C> {
		const output: Record<string, unknown> = {};
		for (const column of columns) output[column] = this.#attributes[column];
		return output as Pick<RowOf<S, T>, C>;
	}

	/** Copies every attribute except the given columns. */
	except<C extends ColumnNameOf<S, T>>(...columns: C[]): Omit<RowOf<S, T>, C> {
		const omitted = new Set<string>(columns);
		const output: Record<string, unknown> = {};
		for (const [column, value] of Object.entries(this.#attributes)) {
			if (!omitted.has(column)) output[column] = value;
		}
		return output as Omit<RowOf<S, T>, C>;
	}

	/** Compares model identity (class + primary key). */
	is(other: object): boolean {
		if (!(other instanceof (this.constructor as typeof Model))) return false;
		return (
			this.constructor === other.constructor &&
			valuesEqual(this.getKey(), (other as AnyModel).getKey())
		);
	}

	/** Negated `is()`. */
	isNot(other: object): boolean {
		return !this.is(other);
	}

	/** The attributes as loaded from the database (before local changes). */
	getOriginal(): RowOf<S, T>;
	getOriginal<C extends ColumnNameOf<S, T>>(
		column: C,
	): RowOf<S, T>[C] | undefined;
	getOriginal(column?: string): unknown {
		if (!this.#persisted || this.#original === null) {
			return column === undefined ? {} : undefined;
		}
		if (column === undefined) return { ...this.#original };
		return this.#original[column];
	}

	/** Returns an eager-loaded relation or throws `RelationNotLoadedError`. */
	getRelation<Name extends string>(name: Name): unknown {
		if (!Object.hasOwn(this.#relations, name))
			throw new RelationNotLoadedError(name);
		return this.#relations[name];
	}

	/** Adds columns to this instance's hidden list (chainable). */
	makeHidden(...columns: readonly string[]): this {
		const meta = resolveModelMeta(this.constructor as object);
		for (const column of columns) this.#assertSerializableName(meta, column);
		for (const column of columns) {
			this.#hiddenOverride.add(column);
			this.#visibleOverride.delete(column);
		}
		return this;
	}

	/** Removes columns from this instance's hidden list (chainable). */
	makeVisible(...columns: readonly string[]): this {
		const meta = resolveModelMeta(this.constructor as object);
		for (const column of columns) this.#assertSerializableName(meta, column);
		for (const column of columns) {
			this.#visibleOverride.add(column);
			this.#hiddenOverride.delete(column);
		}
		return this;
	}

	#assertSerializableName(meta: ModelMeta, name: string): void {
		const known =
			Object.hasOwn(meta.columns, name) ||
			name in meta.relations ||
			name in meta.accessors;
		if (!known) {
			throw new InvalidModelUsageError(
				`${meta.table}: "${name}" is not a column, relation or accessor of this model.`,
			);
		}
	}

	#isSerializable(meta: ModelMeta, name: string, isRelation = false): boolean {
		if (this.#hiddenOverride.has(name)) return false;
		if (this.#visibleOverride.has(name)) return true;
		if (meta.visible !== null) return meta.visible.has(name);
		if (isRelation) return true;
		return !meta.hidden.has(name);
	}

	/** JSON projection — hidden/visible rules, accessors and relations. */
	toJSON(): RowOf<S, T> {
		const meta = resolveModelMeta(this.constructor as object);
		const output: Record<string, unknown> = {};
		for (const [column, value] of Object.entries(this.#attributes)) {
			if (this.#isSerializable(meta, column)) output[column] = value;
		}
		for (const [name, value] of Object.entries(this.#extras)) {
			if (this.#isSerializable(meta, name)) output[name] = value;
		}
		for (const name of new Set([...meta.appends, ...this.#appended])) {
			if (!this.#isSerializable(meta, name)) continue;
			const accessor = meta.accessors[name];
			if (accessor !== undefined) output[name] = accessor(this);
		}
		for (const [name, value] of Object.entries(this.#relations)) {
			if (this.#isSerializable(meta, name, true)) output[name] = value;
		}
		return output as RowOf<S, T>;
	}

	/** Array/object projection — Eloquent's `toArray()`, identical to `toJSON()`. */
	toArray(): RowOf<S, T> {
		return this.toJSON();
	}

	/**
	 * Adds accessor names to this instance's `toJSON()` output without touching
	 * the class-level `static appends` (chainable).
	 */
	append(...names: readonly string[]): this {
		const meta = resolveModelMeta(this.constructor as object);
		for (const name of names) {
			if (!(name in meta.accessors)) {
				throw new InvalidModelUsageError(
					`${meta.table}: "${name}" is not declared in "static accessors" and cannot be appended.`,
				);
			}
			this.#appended.add(name);
		}
		return this;
	}

	// -----------------------------------------------------------------------
	// soft deletes
	// -----------------------------------------------------------------------

	/** Whether this row is soft-deleted. Throws when soft deletes are off. */
	trashed(): boolean {
		const meta = this.#requireSoftDelete();
		return Boolean(this.#attributes[meta.column]);
	}

	/**
	 * Restores a soft-deleted row. Returns `false` when the model is not
	 * trashed or a `restoring` listener cancelled.
	 */
	async restore(): Promise<boolean> {
		const meta = this.#requireSoftDelete();
		if (!this.trashed()) return false;
		if (!this.#persisted) {
			throw new InvalidModelUsageError(
				`restore() on "${resolveModelMeta(this.constructor as object).table}": the model is not persisted.`,
			);
		}
		if (!(await emitModelEvent(this.constructor, "restoring", this))) {
			return false;
		}
		this.#attributes[meta.column] = null;
		await this.save();
		await emitModelEvent(this.constructor, "restored", this);
		return true;
	}

	#requireSoftDelete(): { column: string } {
		const meta = resolveModelMeta(this.constructor as object);
		if (meta.softDelete === null) {
			throw new InvalidModelUsageError(
				`${meta.table}: this model does not use soft deletes. Add "static softDeletes = true".`,
			);
		}
		return meta.softDelete;
	}

	// -----------------------------------------------------------------------
	// persistence
	// -----------------------------------------------------------------------

	/**
	 * Inserts (new model) or updates (persisted model).
	 *
	 * Returns `this`, or `false` when a `saving` / `creating` / `updating`
	 * listener cancelled the operation.
	 */
	async save(): Promise<this | false> {
		const meta = resolveModelMeta(this.constructor as object);
		if (!this.#persisted) {
			if (!(await emitModelEvent(this.constructor, "saving", this))) {
				return false;
			}
			if (!(await emitModelEvent(this.constructor, "creating", this))) {
				return false;
			}
			const payload = toDatabasePayload(meta, this.#attributes);
			applyTimestampsForCreate(meta, payload);
			if (Object.keys(payload).length === 0) {
				throw new InvalidModelUsageError(
					`save() on "${meta.table}": no writable attributes.`,
				);
			}
			const row = await insertRow(meta.orm, meta, payload);
			this.#resetFromRow(row, true);
			this.#wasRecentlyCreated = true;
			this.#changes = { ...this.#attributes };
			this.#previous = {};
			await emitModelEvent(this.constructor, "created", this);
			await emitModelEvent(this.constructor, "saved", this);
			await touchOwners(meta, this);
			return this;
		}
		const dirty = this.getDirty() as Record<string, unknown>;
		if (Object.keys(dirty).length === 0) return this;
		if (!(await emitModelEvent(this.constructor, "saving", this))) {
			return false;
		}
		if (!(await emitModelEvent(this.constructor, "updating", this))) {
			return false;
		}
		const primaryKey = meta.primaryKey;
		if (primaryKey === null) {
			throw new InvalidModelUsageError(
				`save() on "${meta.table}": the table declares no primary key. Use query-level updates instead.`,
			);
		}
		const identifier =
			this.#original?.[primaryKey] ?? this.#attributes[primaryKey];
		const payload = toDatabasePayload(meta, dirty);
		applyTimestampForUpdate(meta, payload);
		const previous = { ...(this.#original ?? {}) };
		await meta.orm
			.table(meta.table)
			.where(primaryKey as never, identifier as never)
			.update(payload as never);
		const updatedAt = meta.timestamps?.updatedAt ?? null;
		if (updatedAt !== null && payload[updatedAt] !== undefined) {
			this.#attributes[updatedAt] = payload[updatedAt];
		}
		this.#original = { ...this.#attributes };
		this.#changes = { ...dirty };
		this.#previous = previous;
		this.#wasRecentlyCreated = false;
		await emitModelEvent(this.constructor, "updated", this);
		await emitModelEvent(this.constructor, "saved", this);
		await touchOwners(meta, this);
		return this;
	}

	/** Mass-assigns attributes and saves the model. */
	async update(values: UpdateOf<S, T>): Promise<this | false> {
		const meta = resolveModelMeta(this.constructor as object);
		if (!this.#persisted) {
			throw new InvalidModelUsageError(
				`update() on "${meta.table}": the model is not persisted. Use create() instead.`,
			);
		}
		Object.assign(
			this.#attributes,
			prepareAssignment(values as Record<string, unknown>, meta, "update"),
		);
		return this.save();
	}

	/** Saves without firing any model events. */
	saveQuietly(): Promise<this | false> {
		return withoutModelEvents(() => this.save());
	}

	/** Updates without firing any model events. */
	updateQuietly(values: UpdateOf<S, T>): Promise<this | false> {
		return withoutModelEvents(() => this.update(values));
	}

	/**
	 * Atomically increments a numeric column and mirrors the change on this
	 * instance. Fires `updating` (cancellable → returns 0) and `updated`;
	 * an extra map is written in the same UPDATE.
	 */
	increment<C extends NumericColumnOf<S, T>>(
		column: C,
		amount: number | bigint = 1,
		extra: Partial<RowOf<S, T>> = {},
	): Promise<number> {
		return this.#step(
			column as string,
			amount,
			extra as Record<string, unknown>,
			"increment",
		);
	}

	/** Atomically decrements a numeric column. */
	decrement<C extends NumericColumnOf<S, T>>(
		column: C,
		amount: number | bigint = 1,
		extra: Partial<RowOf<S, T>> = {},
	): Promise<number> {
		return this.#step(
			column as string,
			amount,
			extra as Record<string, unknown>,
			"decrement",
		);
	}

	/** `increment()` without firing any model events. */
	incrementQuietly<C extends NumericColumnOf<S, T>>(
		column: C,
		amount: number | bigint = 1,
		extra: Partial<RowOf<S, T>> = {},
	): Promise<number> {
		return withoutModelEvents(() => this.increment(column, amount, extra));
	}

	/** `decrement()` without firing any model events. */
	decrementQuietly<C extends NumericColumnOf<S, T>>(
		column: C,
		amount: number | bigint = 1,
		extra: Partial<RowOf<S, T>> = {},
	): Promise<number> {
		return withoutModelEvents(() => this.decrement(column, amount, extra));
	}

	async #step(
		column: string,
		amount: number | bigint,
		extra: Record<string, unknown>,
		kind: "increment" | "decrement",
	): Promise<number> {
		const meta = resolveModelMeta(this.constructor as object);
		if (!this.#persisted) {
			throw new InvalidModelUsageError(
				`${kind}() on "${meta.table}": the model is not persisted. Use query-level ${kind}() instead.`,
			);
		}
		const primaryKey = meta.primaryKey;
		if (primaryKey === null) {
			throw new InvalidModelUsageError(
				`${kind}() on "${meta.table}": the table declares no primary key.`,
			);
		}
		const id = this.#original?.[primaryKey] ?? this.#attributes[primaryKey];
		if (id === undefined) {
			throw new InvalidModelUsageError(
				`${kind}() on "${meta.table}": the model has no primary-key value.`,
			);
		}
		if (!(await emitModelEvent(this.constructor, "updating", this))) return 0;
		const builder = Model.query.call(
			this.constructor as ModelStaticLike,
		) as unknown as {
			where(
				column: string,
				value: unknown,
			): {
				increment(
					column: string,
					amount: number | bigint,
					extra?: Record<string, unknown>,
				): Promise<number>;
				decrement(
					column: string,
					amount: number | bigint,
					extra?: Record<string, unknown>,
				): Promise<number>;
			};
		};
		const affected = await builder
			.where(primaryKey, id)
			[kind](column, amount, extra);
		const signed = kind === "increment" ? amount : -amount;
		this.#mirrorStep(column, signed);
		for (const [key, value] of Object.entries(extra)) {
			this.#attributes[key] = normalizeAttribute(meta, key, value);
		}
		this.#original = { ...this.#attributes };
		this.#changes = { [column]: this.#attributes[column], ...extra };
		this.#previous = {};
		this.#wasRecentlyCreated = false;
		await emitModelEvent(this.constructor, "updated", this);
		return affected;
	}

	/** Mirrors a database-side `+ delta` on the local attribute copy. */
	#mirrorStep(column: string, delta: number | bigint): void {
		const current = this.#attributes[column];
		if (current === null || current === undefined) {
			// SQL `column + delta` keeps NULL; mirror that instead of inventing
			// a number the database does not hold.
			this.#attributes[column] = null;
			return;
		}
		if (typeof current === "bigint") {
			this.#attributes[column] =
				current + (typeof delta === "bigint" ? delta : BigInt(delta));
			return;
		}
		if (typeof current === "number") {
			this.#attributes[column] = current + Number(delta);
			return;
		}
		if (typeof current === "string" && current.trim() !== "") {
			const next = Number(current) + Number(delta);
			if (Number.isFinite(next)) this.#attributes[column] = String(next);
			return;
		}
		this.#attributes[column] = delta;
	}

	/** Deletes without firing any model events. */
	deleteQuietly(): Promise<boolean> {
		return withoutModelEvents(() => this.delete());
	}

	/** Force-deletes without firing any model events. */
	forceDeleteQuietly(): Promise<boolean> {
		return withoutModelEvents(() => this.forceDelete());
	}

	/** Restores without firing any model events. */
	restoreQuietly(): Promise<boolean> {
		return withoutModelEvents(() => this.restore());
	}

	/** Updates `updatedAt` and persists it (Eloquent `touch`). */
	async touch(): Promise<boolean> {
		const meta = resolveModelMeta(this.constructor as object);
		const updatedAt = meta.timestamps?.updatedAt ?? null;
		if (updatedAt === null) {
			throw new InvalidModelUsageError(
				`touch() on "${meta.table}": the model has no updatedAt timestamp.`,
			);
		}
		this.#attributes[updatedAt] = new Date();
		return (await this.save()) !== false;
	}

	/** Loads a fresh copy from the database, or `null` when gone. */
	async fresh(): Promise<this | null> {
		const meta = resolveModelMeta(this.constructor as object);
		if (meta.primaryKey === null) {
			throw new InvalidModelUsageError(
				`fresh() on "${meta.table}": the table declares no primary key.`,
			);
		}
		const id = this.getKey();
		if (id === undefined) return null;
		const row = await meta.orm
			.table(meta.table)
			.where(meta.primaryKey as never, id as never)
			.first();
		if (row === null) return null;
		return meta.orm.hydrateModelRow(
			this.constructor,
			row as Record<string, unknown>,
			true,
		) as this;
	}

	/** Saves this model and every loaded relation (recursively). */
	async push(): Promise<this> {
		const saved = await this.save();
		if (saved === false) return this;
		for (const [name, value] of Object.entries(this.#relations)) {
			const items = Array.isArray(value) ? value : [value];
			for (const item of items) {
				if (item === null || typeof item !== "object") continue;
				const pushable = item as {
					push?(): Promise<unknown>;
					save?(): Promise<unknown>;
				};
				if (typeof pushable.push === "function") await pushable.push();
				else if (typeof pushable.save === "function") await pushable.save();
			}
			this.#relations[name] = value;
		}
		return this;
	}

	/**
	 * Deletes the model's row — a soft delete when `softDeletes` is enabled.
	 * Returns `false` when a `deleting` / `forceDeleting` listener cancelled.
	 */
	async delete(): Promise<boolean> {
		const meta = resolveModelMeta(this.constructor as object);
		if (!this.#persisted) {
			throw new InvalidModelUsageError(
				`delete() on "${meta.table}": the model is not persisted.`,
			);
		}
		const primaryKey = meta.primaryKey;
		if (primaryKey === null) {
			throw new InvalidModelUsageError(
				`delete() on "${meta.table}": the table declares no primary key.`,
			);
		}
		const identifier =
			this.#original?.[primaryKey] ?? this.#attributes[primaryKey];
		if (!(await emitModelEvent(this.constructor, "deleting", this))) {
			return false;
		}
		if (meta.softDelete !== null) {
			const now = new Date();
			await meta.orm
				.table(meta.table)
				.where(primaryKey as never, identifier as never)
				.update({ [meta.softDelete.column]: now } as never);
			this.#attributes[meta.softDelete.column] = now;
			if (this.#original !== null) {
				this.#original[meta.softDelete.column] = now;
			}
			await emitModelEvent(this.constructor, "trashed", this);
			await emitModelEvent(this.constructor, "deleted", this);
			return true;
		}
		await meta.orm
			.table(meta.table)
			.where(primaryKey as never, identifier as never)
			.delete();
		this.#persisted = false;
		this.#original = null;
		await emitModelEvent(this.constructor, "deleted", this);
		return true;
	}

	/**
	 * Permanently deletes a soft-deleted row (or behaves like `delete()` on
	 * models without soft deletes).
	 */
	async forceDelete(): Promise<boolean> {
		const meta = resolveModelMeta(this.constructor as object);
		if (!this.#persisted) {
			throw new InvalidModelUsageError(
				`forceDelete() on "${meta.table}": the model is not persisted.`,
			);
		}
		const primaryKey = meta.primaryKey;
		if (primaryKey === null) {
			throw new InvalidModelUsageError(
				`forceDelete() on "${meta.table}": the table declares no primary key.`,
			);
		}
		if (!(await emitModelEvent(this.constructor, "forceDeleting", this))) {
			return false;
		}
		const identifier =
			this.#original?.[primaryKey] ?? this.#attributes[primaryKey];
		await meta.orm
			.table(meta.table)
			.where(primaryKey as never, identifier as never)
			.delete();
		this.#persisted = false;
		this.#original = null;
		await emitModelEvent(this.constructor, "forceDeleted", this);
		return true;
	}

	/** Re-reads the row from the database. */
	async refresh(): Promise<this> {
		const meta = resolveModelMeta(this.constructor as object);
		if (!this.#persisted) {
			throw new InvalidModelUsageError(
				`refresh() on "${meta.table}": the model is not persisted.`,
			);
		}
		const primaryKey = meta.primaryKey;
		if (primaryKey === null) {
			throw new InvalidModelUsageError(
				`refresh() on "${meta.table}": the table declares no primary key.`,
			);
		}
		const identifier =
			this.#original?.[primaryKey] ?? this.#attributes[primaryKey];
		const row = await meta.orm
			.table(meta.table)
			.where(primaryKey as never, identifier as never)
			.first();
		if (row === null) throw new ModelNotFoundError(meta.table, identifier);
		this.#resetFromRow(row as Record<string, unknown>, true);
		return this;
	}

	/**
	 * A non-persisted copy without the primary key (and without timestamps /
	 * soft-delete marker). Fires `replicating`.
	 */
	async replicate(except: readonly string[] = []): Promise<this> {
		const meta = resolveModelMeta(this.constructor as object);
		const copy = new (this.constructor as new (token?: symbol) => this)(
			HYDRATE_TOKEN,
		);
		const omitted = new Set<string>(except);
		if (meta.primaryKey !== null) omitted.add(meta.primaryKey);
		if (meta.timestamps) {
			if (meta.timestamps.createdAt !== null)
				omitted.add(meta.timestamps.createdAt);
			if (meta.timestamps.updatedAt !== null)
				omitted.add(meta.timestamps.updatedAt);
		}
		if (meta.softDelete !== null) omitted.add(meta.softDelete.column);
		const attributes: Record<string, unknown> = {};
		for (const [column, value] of Object.entries(this.#attributes)) {
			if (!omitted.has(column)) attributes[column] = value;
		}
		internalsOf(copy).assign(attributes);
		await emitModelEvent(this.constructor, "replicating", copy);
		return copy;
	}

	// -----------------------------------------------------------------------
	// eager loading on an existing instance
	// -----------------------------------------------------------------------

	/** Returns a write/query manager for one declared relation. */
	relation(name: string): RelationManager {
		const meta = resolveModelMeta(this.constructor as object);
		const descriptor = meta.relations[name];
		if (descriptor === undefined) {
			throw new InvalidQueryError(
				`relation(${JSON.stringify(name)}): relation is not defined on "${meta.table}".`,
			);
		}
		return createRelationManager({
			orm: meta.orm,
			owner: this,
			ownerMeta: meta,
			descriptor,
			name,
			deps: relationManagerDeps,
		});
	}

	/** Eager-loads relations onto this already-hydrated instance. */
	async load(...paths: string[]): Promise<this> {
		const meta = resolveModelMeta(this.constructor as object);
		await meta.orm.eagerLoadModels(
			[this],
			paths.map((path) => ({ path })),
		);
		return this;
	}

	/** Eager-loads only relations that are not loaded yet. */
	async loadMissing(...paths: string[]): Promise<this> {
		const missing = paths.filter((path) => !hasLoadedPath(this, path));
		if (missing.length > 0) await this.load(...missing);
		return this;
	}

	/** Loads relation counts (`postsCount`, or `"posts as pendingCount"`). */
	async loadCount(...references: string[]): Promise<this> {
		if (references.length === 0) return this;
		const meta = resolveModelMeta(this.constructor as object);
		const primaryKey = this.#requirePrimaryKey("loadCount");
		const id = this.#original?.[primaryKey] ?? this.#attributes[primaryKey];
		const builder = new QueryBuilder<
			Schema,
			TableName<Schema>,
			ModelStaticLike,
			unknown,
			null,
			never
		>(
			meta.orm,
			meta.table as TableName<Schema>,
			this.constructor as ModelStaticLike,
		).where(primaryKey as never, id as never);
		const counted = (
			builder as unknown as {
				withCount(...refs: string[]): typeof builder;
			}
		).withCount(...references);
		const row = (await counted.first()) as AnyModel | null;
		if (row !== null) this.#copyExtras(row);
		return this;
	}

	/** Loads one relation aggregate supported by `withSum`-style subqueries. */
	async loadAggregate(
		kind: "sum" | "avg" | "min" | "max",
		reference: string,
		column: string,
	): Promise<this> {
		const meta = resolveModelMeta(this.constructor as object);
		const primaryKey = this.#requirePrimaryKey("loadAggregate");
		const id = this.#original?.[primaryKey] ?? this.#attributes[primaryKey];
		let builder = new QueryBuilder<
			Schema,
			TableName<Schema>,
			ModelStaticLike,
			unknown,
			null,
			never
		>(
			meta.orm,
			meta.table as TableName<Schema>,
			this.constructor as ModelStaticLike,
		).where(primaryKey as never, id as never);
		builder = builder[
			kind === "sum"
				? "withSum"
				: kind === "avg"
					? "withAvg"
					: kind === "min"
						? "withMin"
						: "withMax"
		](reference as never, column as never) as never;
		const row = (await builder.first()) as AnyModel | null;
		if (row !== null) this.#copyExtras(row);
		return this;
	}

	async loadSum(reference: string, column: string): Promise<this> {
		return this.loadAggregate("sum", reference, column);
	}

	async loadAvg(reference: string, column: string): Promise<this> {
		return this.loadAggregate("avg", reference, column);
	}

	async loadMin(reference: string, column: string): Promise<this> {
		return this.loadAggregate("min", reference, column);
	}

	async loadMax(reference: string, column: string): Promise<this> {
		return this.loadAggregate("max", reference, column);
	}

	#requirePrimaryKey(method: string): string {
		const meta = resolveModelMeta(this.constructor as object);
		if (!this.#persisted) {
			throw new InvalidModelUsageError(
				`${method}() on "${meta.table}": the model is not persisted.`,
			);
		}
		if (meta.primaryKey === null) {
			throw new InvalidModelUsageError(
				`${method}() on "${meta.table}": the table declares no primary key.`,
			);
		}
		return meta.primaryKey;
	}

	#copyExtras(row: object): void {
		for (const [name, value] of Object.entries(internalsOf(row).extras())) {
			internalsOf(this).setExtra(name, value);
		}
	}

	// -----------------------------------------------------------------------
	// internals
	// -----------------------------------------------------------------------

	/** @internal */
	[MODEL_INTERNALS](): ModelInternals {
		return {
			attributes: () => this.#attributes,
			assign: (values) => {
				Object.assign(this.#attributes, values);
			},
			setRelation: (name, value) => {
				this.#relations[name] = value;
				// Expose the relation under its own name as well, so
				// `user.posts` works exactly as the eager-load types promise.
				(this as unknown as Record<string, unknown>)[name] = value;
			},
			relations: () => this.#relations,
			extras: () => this.#extras,
			setExtra: (name, value) => {
				this.#extras[name] = value;
				(this as unknown as Record<string, unknown>)[name] = value;
			},
			persisted: () => this.#persisted,
			clone: () => {
				const copy = new (
					this.constructor as { new (token?: symbol): AnyModel }
				)(HYDRATE_TOKEN);
				const target = copy as unknown as Model<Schema, TableName<Schema>>;
				target.#attributes = { ...this.#attributes };
				target.#original =
					this.#original === null ? null : { ...this.#original };
				target.#changes = { ...this.#changes };
				target.#previous = { ...this.#previous };
				target.#relations = { ...this.#relations };
				target.#extras = { ...this.#extras };
				target.#persisted = this.#persisted;
				target.#wasRecentlyCreated = this.#wasRecentlyCreated;
				target.#hiddenOverride = new Set(this.#hiddenOverride);
				target.#visibleOverride = new Set(this.#visibleOverride);
				target.#appended = new Set(this.#appended);
				for (const [name, value] of Object.entries(target.#extras)) {
					(target as unknown as Record<string, unknown>)[name] = value;
				}
				return copy;
			},
		};
	}

	/** @internal */
	[HYDRATE_INSTANCE](row: Record<string, unknown>, persisted: boolean): void {
		this.#resetFromRow(row, persisted);
	}

	#resetFromRow(row: Record<string, unknown>, persisted: boolean): void {
		const meta = resolveModelMeta(this.constructor as object);
		const converted = hydrateRow(meta.plan, row);
		const attributes: Record<string, unknown> = {};
		const extras: Record<string, unknown> = {};
		for (const [column, value] of Object.entries(converted)) {
			if (Object.hasOwn(meta.columns, column)) {
				const cast = meta.casts[column];
				attributes[column] = cast === undefined ? value : cast.get(value);
				continue;
			}
			// Extra selected fields (relation counts, aggregates) are exposed
			// as own properties — exactly what the eager-load types promise —
			// without ever being written back to the database.
			extras[column] = value;
			(this as unknown as Record<string, unknown>)[column] = value;
		}
		this.#attributes = attributes;
		this.#extras = extras;
		this.#original = persisted ? { ...attributes } : null;
		this.#persisted = persisted;
		this.#relations = {};
		this.#wasRecentlyCreated = false;
		this.#changes = {};
		this.#previous = {};
	}

	// -----------------------------------------------------------------------
	// static surface — precisely re-typed by `orm.model()` (see ModelClass)
	// -----------------------------------------------------------------------

	static query(
		this: ModelStaticLike,
	): QueryBuilder<
		Schema,
		TableName<Schema>,
		ModelStaticLike,
		unknown,
		null,
		never
	> {
		return new QueryBuilder<
			Schema,
			TableName<Schema>,
			ModelStaticLike,
			unknown,
			null,
			never
		>(this.__orm, this.__table as TableName<Schema>, this);
	}

	/** Registers an event listener on this model class. */
	static on(
		this: ModelStaticLike,
		event: ModelEventName,
		listener: ModelEventListener,
	): () => void {
		return onModelEvent(this, event, listener);
	}

	/** Registers a full observer object on this model class. */
	static observe(this: ModelStaticLike, observer: ModelObserver): () => void {
		return observeModel(this, observer as Record<string, unknown>);
	}

	/** Runs `callback` with every model event suppressed. */
	static withoutEvents<T>(
		this: ModelStaticLike,
		callback: () => Promise<T> | T,
	): Promise<T> {
		return withoutModelEvents(callback);
	}

	/** Query including soft-deleted rows. */
	static withTrashed(this: ModelStaticLike): unknown {
		const queryable = this as unknown as {
			query(): QueryBuilder<
				Schema,
				TableName<Schema>,
				ModelStaticLike,
				unknown,
				null,
				never
			>;
		};
		return queryable.query().withTrashed();
	}

	/**
	 * Builds a query without any global scopes, or without the named ones.
	 *
	 * ```ts
	 * User.withoutGlobalScopes().get();
	 * User.withoutGlobalScopes("active").get();
	 * ```
	 */
	static withoutGlobalScopes<M extends ModelStaticLike>(
		this: M,
		...names: GlobalScopeNamesOf<M>[]
	): QueryBuilder<
		Schema,
		TableName<Schema>,
		ModelStaticLike,
		unknown,
		null,
		never
	> {
		return new QueryBuilder<
			Schema,
			TableName<Schema>,
			ModelStaticLike,
			unknown,
			null,
			never
		>(this.__orm, this.__table as TableName<Schema>, this, {
			skipGlobalScopes: names.length === 0,
			exceptGlobalScopes: names,
		});
	}

	/** Query restricted to soft-deleted rows. */
	static onlyTrashed(this: ModelStaticLike): unknown {
		const queryable = this as unknown as {
			query(): QueryBuilder<
				Schema,
				TableName<Schema>,
				ModelStaticLike,
				unknown,
				null,
				never
			>;
		};
		return queryable.query().onlyTrashed();
	}

	static async create(
		this: ModelStaticLike,
		values: Record<string, unknown>,
	): Promise<AnyModel> {
		const meta = resolveModelMeta(this);
		const instance = newInstance(this);
		internalsOf(instance).assign(prepareAssignment(values, meta, "create"));
		await instance.save();
		return instance;
	}

	static async createMany(
		this: ModelStaticLike,
		rows: ReadonlyArray<Record<string, unknown>>,
	): Promise<Collection<AnyModel>> {
		if (rows.length === 0) return Collection.make<AnyModel>([]);
		const meta = resolveModelMeta(this);
		const instances: AnyModel[] = [];
		const payloads: Array<Record<string, unknown>> = [];
		for (const values of rows) {
			const instance = newInstance(this);
			internalsOf(instance).assign(prepareAssignment(values, meta, "create"));
			if (!(await emitModelEvent(this, "saving", instance))) continue;
			if (!(await emitModelEvent(this, "creating", instance))) continue;
			const payload = toDatabasePayload(
				meta,
				internalsOf(instance).attributes(),
			);
			applyTimestampsForCreate(meta, payload);
			instances.push(instance);
			payloads.push(payload);
		}
		if (payloads.length === 0) return Collection.make<AnyModel>([]);
		const orm = meta.orm;
		if (orm.dialectKind !== "mysql") {
			const compiled = (orm.executor() as AnyStatement)
				.insertInto(meta.table)
				.values(payloads)
				.returning(Object.keys(meta.columns))
				.compile() as CompiledQuery;
			const result = await orm.execute(compiled);
			const stored = result.rows as Array<Record<string, unknown>>;
			for (let index = 0; index < instances.length; index += 1) {
				const instance = instances[index]!;
				refillInstance(instance, stored[index] ?? payloads[index]!);
				await emitModelEvent(this, "created", instance);
				await emitModelEvent(this, "saved", instance);
			}
			return Collection.make(instances);
		}
		const result = await orm.execute(
			(orm.executor() as AnyStatement)
				.insertInto(meta.table)
				.values(payloads)
				.compile() as CompiledQuery,
		);
		for (let index = 0; index < instances.length; index += 1) {
			const instance = instances[index]!;
			const row: Record<string, unknown> = { ...payloads[index]! };
			const id = shiftInsertId(meta, result.insertId, index);
			if (meta.primaryKey !== null && id !== undefined) {
				row[meta.primaryKey] = id;
			}
			refillInstance(instance, row);
			await emitModelEvent(this, "created", instance);
			await emitModelEvent(this, "saved", instance);
		}
		return Collection.make(instances);
	}

	/** First match for `attributes`, or a new model created from both maps. */
	static async firstOrCreate(
		this: ModelStaticLike,
		attributes: Record<string, unknown>,
		values: Record<string, unknown> = {},
	): Promise<AnyModel> {
		const existing = await findWhere(this, attributes);
		if (existing !== null) return existing;
		// `create` returns the attempted instance even when a `creating`
		// listener cancels it (Laravel behaves the same way).
		return Model.create.call(this, { ...attributes, ...values });
	}

	/** Updates a match for `attributes`, or creates one. */
	static async updateOrCreate(
		this: ModelStaticLike,
		attributes: Record<string, unknown>,
		values: Record<string, unknown> = {},
	): Promise<AnyModel> {
		const existing = await findWhere(this, attributes);
		if (existing === null) {
			return Model.firstOrCreate.call(this, attributes, values);
		}
		await existing.update(values as never);
		return existing;
	}

	/**
	 * Insert-first `firstOrCreate`: attempts the INSERT and, when a unique
	 * constraint rejects it, returns the row that won the race.
	 */
	static async createOrFirst(
		this: ModelStaticLike,
		attributes: Record<string, unknown>,
		values: Record<string, unknown> = {},
	): Promise<AnyModel> {
		const builder = Model.query.call(this) as unknown as {
			createOrFirst(
				attributes: Record<string, unknown>,
				values: Record<string, unknown>,
			): Promise<AnyModel>;
		};
		return builder.createOrFirst(attributes, values);
	}

	/**
	 * Deletes models by primary key, firing `deleting`/`deleted` per model.
	 * Soft-deleting models are trashed, not destroyed. Returns the number of
	 * deleted models; missing ids are ignored.
	 */
	static async destroy(
		this: ModelStaticLike,
		...ids: ReadonlyArray<unknown | ReadonlyArray<unknown>>
	): Promise<number> {
		const meta = resolveModelMeta(this);
		if (meta.primaryKey === null) {
			throw new InvalidQueryError(
				`destroy() on "${meta.table}": the table declares no primary key.`,
			);
		}
		const flat: unknown[] = [];
		for (const id of ids) {
			if (Array.isArray(id)) {
				for (const item of id) {
					if (item !== undefined && item !== null) flat.push(item);
				}
			} else if (id !== undefined && id !== null) {
				flat.push(id);
			}
		}
		if (flat.length === 0) return 0;
		const models = await Model.findMany.call(this, flat);
		let deleted = 0;
		for (const model of models) {
			if (await model.delete()) deleted += 1;
		}
		return deleted;
	}

	static async find(
		this: ModelStaticLike,
		id: unknown,
	): Promise<AnyModel | null> {
		const meta = resolveModelMeta(this);
		const primaryKey = meta.primaryKey;
		if (primaryKey === null) {
			throw new InvalidQueryError(
				`find() on "${meta.table}": the table declares no primary key.`,
			);
		}
		const builder = new QueryBuilder<
			Schema,
			TableName<Schema>,
			ModelStaticLike,
			unknown,
			null,
			never
		>(meta.orm, meta.table as TableName<Schema>, this);
		return (await builder
			.where(primaryKey as never, id as never)
			.first()) as AnyModel | null;
	}

	static async findOrFail(
		this: ModelStaticLike,
		id: unknown,
	): Promise<AnyModel> {
		const model = await Model.find.call(this, id);
		if (model === null) {
			const meta = resolveModelMeta(this);
			throw new ModelNotFoundError(meta.table, id);
		}
		return model;
	}

	static async findMany(
		this: ModelStaticLike,
		ids: ReadonlyArray<unknown>,
	): Promise<Collection<AnyModel>> {
		const meta = resolveModelMeta(this);
		const primaryKey = meta.primaryKey;
		if (primaryKey === null) {
			throw new InvalidQueryError(
				`findMany() on "${meta.table}": the table declares no primary key.`,
			);
		}
		if (ids.length === 0) return Collection.make<AnyModel>([]);
		const builder = new QueryBuilder<
			Schema,
			TableName<Schema>,
			ModelStaticLike,
			unknown,
			null,
			never
		>(meta.orm, meta.table as TableName<Schema>, this);
		return (await builder
			.whereIn(primaryKey as never, ids as never)
			.get()) as Collection<AnyModel>;
	}

	static async all(this: ModelStaticLike): Promise<Collection<AnyModel>> {
		const meta = resolveModelMeta(this);
		const builder = new QueryBuilder<
			Schema,
			TableName<Schema>,
			ModelStaticLike,
			unknown,
			null,
			never
		>(meta.orm, meta.table as TableName<Schema>, this);
		return (await builder.get()) as Collection<AnyModel>;
	}
}

// ---------------------------------------------------------------------------
// Hydration / factory
// ---------------------------------------------------------------------------

interface HydratableInstance {
	[HYDRATE_INSTANCE](row: Record<string, unknown>, persisted: boolean): void;
}

function internalsOf(model: object): ModelInternals {
	return (model as unknown as { [MODEL_INTERNALS](): ModelInternals })[
		MODEL_INTERNALS
	]();
}

const relationManagerDeps: RelationManagerDeps = {
	internalsSymbol: MODEL_INTERNALS,
	normalize: (modelClass, values, mode) =>
		prepareAssignment(values, resolveModelMeta(modelClass as object), mode),
};

async function touchOwners(meta: ModelMeta, model: object): Promise<void> {
	if (meta.touches.length === 0) return;
	const attributes = internalsOf(model).attributes();
	for (const name of meta.touches) {
		const descriptor = meta.relations[name];
		if (descriptor === undefined || descriptor.kind !== "belongsTo") continue;
		const foreignKey = descriptor.foreignKey;
		if (foreignKey === undefined) continue;
		const relatedClass = descriptor.related?.() as ModelStaticLike | undefined;
		if (relatedClass === undefined) continue;
		const relatedMeta = resolveModelMeta(relatedClass);
		const updatedAt = relatedMeta.timestamps?.updatedAt ?? null;
		if (updatedAt === null) continue;
		const ownerKey = descriptor.ownerKey ?? relatedMeta.primaryKey ?? "id";
		const value = attributes[foreignKey];
		if (value === null || value === undefined) continue;
		await relatedMeta.orm
			.table(relatedMeta.table)
			.where(ownerKey as never, value as never)
			.update({ [updatedAt]: new Date() } as never);
	}
}

function hasLoadedPath(model: object, path: string): boolean {
	let current: object[] = [model];
	for (const segment of path.split(".")) {
		const next: object[] = [];
		for (const item of current) {
			const relations = internalsOf(item).relations();
			if (!Object.hasOwn(relations, segment)) return false;
			const value = relations[segment];
			if (Array.isArray(value)) {
				for (const child of value) {
					if (child !== null && typeof child === "object") {
						next.push(child);
					}
				}
			} else if (value !== null && typeof value === "object") {
				next.push(value);
			}
		}
		// Empty to-many relations have nothing nested to inspect; the path is
		// considered loaded, exactly like Eloquent's `relationLoaded` check.
		if (next.length === 0) return true;
		current = next;
	}
	return true;
}

function newInstance(cls: ModelStaticLike): AnyModel {
	return new cls(HYDRATE_TOKEN);
}

function refillInstance(
	instance: AnyModel,
	row: Record<string, unknown>,
): void {
	(instance as unknown as HydratableInstance)[HYDRATE_INSTANCE](row, true);
}

async function findWhere(
	cls: ModelStaticLike,
	attributes: Record<string, unknown>,
): Promise<AnyModel | null> {
	const meta = resolveModelMeta(cls);
	const builder = new QueryBuilder<
		Schema,
		TableName<Schema>,
		ModelStaticLike,
		unknown,
		null,
		never
	>(meta.orm, meta.table as TableName<Schema>, cls);
	for (const [column, value] of Object.entries(attributes)) {
		if (!Object.hasOwn(meta.columns, column)) {
			throw new InvalidQueryError(
				`${meta.table}: unknown column "${column}" in firstOrCreate/updateOrCreate.`,
			);
		}
		builder.where(column as never, value as never);
	}
	return (await builder.first()) as AnyModel | null;
}

/** Creates and hydrates a model instance. @internal */
export function hydrateInstance(
	modelClass: { new (token?: symbol): AnyModel },
	row: Record<string, unknown>,
	persisted: boolean,
): AnyModel {
	const instance = new modelClass(HYDRATE_TOKEN);
	(instance as unknown as HydratableInstance)[HYDRATE_INSTANCE](row, persisted);
	return instance;
}

/** Fires `retrieved` for freshly hydrated instances (no-op without listeners). @internal */
export async function emitRetrieved(
	modelClass: object,
	instances: readonly unknown[],
): Promise<void> {
	if (instances.length === 0) return;
	for (const instance of instances) {
		await emitModelEvent(modelClass, "retrieved", instance);
	}
}

/**
 * Shapes a MySQL insert id (string/number) into the primary-key type declared
 * by the schema, adding the row offset for multi-row inserts.
 */
function shiftInsertId(
	meta: ModelMeta,
	insertId: number | bigint | string | undefined,
	offset: number,
): unknown {
	if (insertId === undefined || meta.primaryKey === null) return undefined;
	const base = hydrateRow(meta.plan, {
		[meta.primaryKey]: insertId,
	})[meta.primaryKey];
	return typeof base === "bigint"
		? base + BigInt(offset)
		: Number(base) + offset;
}

/**
 * Inserts one row and returns the full row as stored by the database.
 * SQLite and PostgreSQL use `RETURNING`; MySQL reads back defaulted rows.
 * @internal
 */
export async function insertRow(
	orm: Orm<Schema>,
	meta: ModelMeta,
	payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	if (orm.dialectKind !== "mysql") {
		const compiled = (orm.executor() as AnyStatement)
			.insertInto(meta.table)
			.values(payload)
			.returning(Object.keys(meta.columns))
			.compile() as CompiledQuery;
		const result = await orm.execute(compiled);
		const row = result.rows[0] as Record<string, unknown> | undefined;
		if (!row) {
			throw new InvalidQueryError(
				`Insert into "${meta.table}" returned no row.`,
			);
		}
		return row;
	}
	const result = await orm.execute(
		(orm.executor() as AnyStatement)
			.insertInto(meta.table)
			.values(payload)
			.compile() as CompiledQuery,
	);
	const id = shiftInsertId(meta, result.insertId, 0);
	const synthesized: Record<string, unknown> = { ...payload };
	if (meta.primaryKey !== null && id !== undefined)
		synthesized[meta.primaryKey] = id;
	const missing = Object.keys(meta.columns).some(
		(column) => !(column in synthesized) && !meta.generated.has(column),
	);
	if (missing && meta.primaryKey !== null && id !== undefined) {
		const refreshed = await orm.execute(
			(orm.executor() as AnyStatement)
				.selectFrom(meta.table)
				.selectAll()
				.where(meta.primaryKey, "=", id)
				.compile() as CompiledQuery,
		);
		const row = refreshed.rows[0] as Record<string, unknown> | undefined;
		if (row) return row;
	}
	return synthesized;
}

/**
 * Creates a model base class bound to one ORM instance and one table.
 * The returned class carries the full typed static surface.
 */
export function createModelBase<S extends Schema, T extends TableName<S>>(
	orm: Orm<S>,
	table: T,
): ModelClass<S, T> {
	const BoundModel = class extends Model<S, T> {};
	Object.defineProperty(BoundModel, "__table", {
		value: table,
		enumerable: false,
		configurable: true,
	});
	Object.defineProperty(BoundModel, "__orm", {
		value: orm,
		enumerable: false,
		configurable: true,
	});
	return BoundModel as unknown as ModelClass<S, T>;
}

// ---------------------------------------------------------------------------
// Typed static surface
// ---------------------------------------------------------------------------

/** Typed query builder returned by model statics, with this class bound. */
export type ModelQueryOf<
	S extends Schema,
	T extends TableName<S>,
	M,
> = QueryBuilder<S, T, M, unknown, null, never>;

/** Static members of a bound model class, derived from the schema. */
export interface ModelStatics<S extends Schema, T extends TableName<S>> {
	/** Typed query builder for this model. */
	query<M extends ModelClass<S, T>>(this: M): ModelQueryOf<S, T, M>;
	/** Creates one model. */
	create<M extends ModelClass<S, T>>(
		this: M,
		values: CreateValues<M, S, T>,
	): Promise<WithAccessors<M, InstanceType<M>>>;
	/** Creates many models — one statement where the dialect allows it. */
	createMany<M extends ModelClass<S, T>>(
		this: M,
		rows: ReadonlyArray<CreateValues<M, S, T>>,
	): Promise<Collection<WithAccessors<M, InstanceType<M>>>>;
	/** First match for `attributes`, or a new model created from both maps. */
	firstOrCreate<M extends ModelClass<S, T>>(
		this: M,
		attributes: Partial<RowOf<S, T>>,
		values?: Partial<CreateValues<M, S, T>>,
	): Promise<WithAccessors<M, InstanceType<M>>>;
	/** Updates a match for `attributes`, or creates one. */
	updateOrCreate<M extends ModelClass<S, T>>(
		this: M,
		attributes: Partial<RowOf<S, T>>,
		values?: Partial<CreateValues<M, S, T>>,
	): Promise<WithAccessors<M, InstanceType<M>>>;
	/** Insert-first `firstOrCreate` — race-safe under unique constraints. */
	createOrFirst<M extends ModelClass<S, T>>(
		this: M,
		attributes: Partial<RowOf<S, T>>,
		values?: Partial<CreateValues<M, S, T>>,
	): Promise<WithAccessors<M, InstanceType<M>>>;
	/** Deletes models by primary key; returns the number deleted. */
	destroy<M extends ModelClass<S, T>>(
		this: M,
		...ids: ReadonlyArray<
			PrimaryKeyValueOf<S, T> | ReadonlyArray<PrimaryKeyValueOf<S, T>>
		>
	): Promise<number>;
	/** Finds one model by primary key. */
	find<M extends ModelClass<S, T>>(
		this: M,
		id: PrimaryKeyValueOf<S, T>,
	): Promise<WithAccessors<M, InstanceType<M>> | null>;
	/** Finds one model by primary key or throws `ModelNotFoundError`. */
	findOrFail<M extends ModelClass<S, T>>(
		this: M,
		id: PrimaryKeyValueOf<S, T>,
	): Promise<WithAccessors<M, InstanceType<M>>>;
	/** Finds many models by primary key. */
	findMany<M extends ModelClass<S, T>>(
		this: M,
		ids: ReadonlyArray<PrimaryKeyValueOf<S, T>>,
	): Promise<Collection<WithAccessors<M, InstanceType<M>>>>;
	/** Every row of the table. */
	all<M extends ModelClass<S, T>>(
		this: M,
	): Promise<Collection<WithAccessors<M, InstanceType<M>>>>;
	/** Model events — returns an unsubscribe function. */
	on<M extends ModelClass<S, T>>(
		this: M,
		event: ModelEventName,
		listener: ModelEventListener<WithAccessors<M, InstanceType<M>>>,
	): () => void;
	/** Observers — every handler is registered; returns one unsubscribe. */
	observe<M extends ModelClass<S, T>>(
		this: M,
		observer: ModelObserver<WithAccessors<M, InstanceType<M>>>,
	): () => void;
	/** Runs the callback with model events suppressed. */
	withoutEvents<TResult>(
		this: ModelClass<S, T>,
		callback: () => Promise<TResult> | TResult,
	): Promise<TResult>;
	/** Query including soft-deleted rows. */
	withTrashed<M extends ModelClass<S, T>>(this: M): ModelQueryOf<S, T, M>;
	/** Query restricted to soft-deleted rows. */
	onlyTrashed<M extends ModelClass<S, T>>(this: M): ModelQueryOf<S, T, M>;
	/** Query without all (or the named) global scopes. */
	withoutGlobalScopes<M extends ModelClass<S, T>>(
		this: M,
		...names: GlobalScopeNamesOf<M>[]
	): ModelQueryOf<S, T, M>;
}

/**
 * A model class created by `orm.model(table)`.
 *
 * Configuration statics (`relations`, `fillable`, `guarded`, `casts`, `hidden`,
 * `timestamps`, `softDeletes`, `accessors`, `mutators`, `appends`, `visible`)
 * are intentionally *not* declared here: user subclasses declare them as plain
 * statics and the runtime validates them. Declaring them on the base would
 * force `static override` on every model.
 */
export interface ModelClass<S extends Schema, T extends TableName<S>>
	extends ModelStatics<S, T> {
	readonly __table: T;
	/**
	 * Phantom schema link: erased at runtime, exists for type inference only
	 * (relation factories recover `S` from `typeof Model` through it).
	 */
	readonly __schema?: S;
	new (token?: symbol): Model<S, T>;
}

/** Query type handed to local/global scope callbacks. */
export type ScopeQueryOf<M> = M extends {
	readonly __schema?: infer S extends Schema;
	readonly __table: infer T extends string;
}
	? T extends TableName<S>
		? QueryBuilder<S, T, unknown, unknown, null, never>
		: never
	: never;

/** Shape of a local scope callback (extra args are inferred). */
export type LocalScope<M, A extends readonly unknown[] = []> = (
	query: ScopeQueryOf<M>,
	...args: A
) => void;

/** Shape of a global scope callback. */
export type GlobalScope<M> = (query: ScopeQueryOf<M>) => void;

/**
 * Declares global scopes while preserving their literal names and typing the
 * query builder from the schema/table:
 *
 * ```ts
 * static globalScopes = defineGlobalScopes(schema, "users", {
 *   active: (query) => query.where("active", true),
 * });
 * ```
 */
export function defineGlobalScopes<
	S extends Schema,
	T extends TableName<S>,
	const G extends Record<
		string,
		(query: QueryBuilder<S, T, unknown, unknown, null, never>) => void
	>,
>(_schema: S, _table: T, scopes: G): G {
	return scopes;
}

/**
 * Declares local scopes with typed query builders and preserved names. Extra
 * callback arguments remain available through `query().scope(name, ...args)`.
 */
export function defineScopes<
	S extends Schema,
	T extends TableName<S>,
	const G extends Record<
		string,
		(
			query: QueryBuilder<S, T, unknown, unknown, null, never>,
			...args: never[]
		) => void
	>,
>(_schema: S, _table: T, scopes: G): G {
	return scopes;
}

/** Re-exported so `CastedValues` stays usable from model typings. */
export type { CastedValues };
