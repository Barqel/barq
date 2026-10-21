// Relationship descriptors.
//
// A relation is declared as a static field on a model class:
//
//   class User extends orm.model("users") {
//     static relations = {
//       posts: hasMany(() => Post, "userId"),
//       profile: hasOne(() => Profile, "userId"),
//       team: belongsTo(() => Team, "teamId"),
//       roles: belongsToMany(() => Role, {
//         through: "role_user",
//         foreignPivotKey: "userId",
//         relatedPivotKey: "roleId",
//       }),
//     };
//   }
//
// Descriptors are plain objects whose generics carry the related model class,
// so `.with("posts.comments")` can be validated and typed at compile time.
// This module has no runtime dependencies: both the query builder and the
// eager loader only need the descriptor shapes.

import type { ColumnNameOf, Schema, TableName } from "../schema/define";
import type { PivotClassLike } from "./pivot";

/**
 * Any model class usable as a relation target.
 *
 * Deliberately structural: relation factories must accept model classes bound
 * to *any* schema, and TypeScript's generic invariance on `Orm<S>` would
 * otherwise reject every concrete class.
 */
export interface ModelLike {
	readonly __table: string;
	new (token?: symbol): unknown;
}

/** @deprecated Internal alias kept for readability. */
export type AnyModelClass = ModelLike;

/**
 * Column names of a relation target when the schema is recoverable,
 * `string` otherwise. The phantom `__schema` marker carried by every bound
 * model class makes the common case fully typed; the fallback keeps
 * third-party model shapes usable without weakening it.
 */
type ColumnNamesOf<M> = M extends {
	readonly __schema?: infer S extends Schema;
	readonly __table: infer T extends string;
}
	? T extends TableName<S>
		? ColumnNameOf<S, T>
		: string
	: string;

export type RelationKind =
	| "hasMany"
	| "hasOne"
	| "belongsTo"
	| "belongsToMany"
	| "hasManyThrough"
	| "hasOneThrough"
	| "morphMany"
	| "morphOne"
	| "morphTo"
	| "morphToMany";

export interface AnyRelationDescriptor {
	readonly kind: RelationKind;
	/** Target class thunk (absent on `morphTo`, which carries `types`). */
	readonly related?: () => unknown;
	/** Morph types map (alias → class). `morphTo` only. */
	readonly types?: () => Record<string, ModelLike>;
	/** Morph relation name — columns derive as `${name}Id` / `${name}Type`. */
	readonly morphName?: string;
	readonly idColumn?: string;
	readonly typeColumn?: string;
	readonly localKey?: string;
	readonly foreignKey?: string;
	readonly ownerKey?: string;
	/** Pivot table name (belongsToMany/morphToMany) or through-model thunk. */
	readonly through?: string | (() => unknown);
	readonly foreignPivotKey?: string;
	readonly relatedPivotKey?: string;
	/** `hasManyThrough` / `hasOneThrough`: FK on the through table. */
	readonly firstKey?: string;
	/** `hasManyThrough` / `hasOneThrough`: FK on the related table. */
	readonly secondKey?: string;
	/** `hasManyThrough` / `hasOneThrough`: key on the through table. */
	readonly secondLocalKey?: string;
	/**
	 * `latestOfMany` / `oldestOfMany` / `ofMany` selection on a `hasOne`.
	 */
	readonly ofMany?: OfManyClause;
	/** `withDefault`: attributes for a missing `belongsTo` owner. */
	readonly defaultAttributes?: Readonly<Record<string, unknown>>;
	/** `withDefaultFor`: callback for a missing `belongsTo` owner. */
	readonly defaultFor?: (parent: object, placeholder: object) => object | void;
	/** `belongsToMany` / `morphToMany`: extra pivot columns to hydrate. */
	readonly pivotColumns?: readonly string[];
	/** `belongsToMany` / `morphToMany`: pivot timestamp columns to hydrate. */
	readonly pivotTimestamps?: readonly [string, string];
	/** `belongsToMany` / `morphToMany`: name of the pivot object. */
	readonly pivotAccessor?: string;
	/** Custom pivot model class (`using`). */
	readonly pivotClass?: unknown;
	/** `morphedByMany`: the declaring model is the *related* side of the morph. */
	readonly inverse?: boolean;
}

export type AnyRelations = Record<string, AnyRelationDescriptor>;

/**
 * One-of-many selection clause: how `latestOfMany` / `oldestOfMany` /
 * `ofMany` pick a single related row per parent.
 */
export interface OfManyClause {
	/** `latest` / `oldest` are aliases of `ofMany` with `max` / `min`. */
	readonly kind: "latest" | "oldest" | "ofMany";
	/** Column the extreme value is computed on. */
	readonly column: string;
	readonly aggregate: "min" | "max";
}

export interface HasMany<
	R extends AnyModelClass,
	L extends string = "id",
	F extends string = string,
> {
	readonly kind: "hasMany";
	readonly related: () => R;
	readonly localKey: L;
	readonly foreignKey: F;
}

export interface HasOne<
	R extends AnyModelClass,
	L extends string = "id",
	F extends string = string,
> {
	readonly kind: "hasOne";
	readonly related: () => R;
	readonly localKey: L;
	readonly foreignKey: F;
	/** Present on `latestOfMany` / `oldestOfMany` / `ofMany` descriptors. */
	readonly ofMany?: OfManyClause;
}

export interface BelongsTo<
	R extends AnyModelClass,
	O extends string = "id",
	F extends string = string,
> {
	readonly kind: "belongsTo";
	readonly related: () => R;
	readonly ownerKey: O;
	readonly foreignKey: F;
	/** `withDefault` attributes used when the owner is missing. */
	readonly defaultAttributes?: Readonly<Record<string, unknown>>;
	/**
	 * `withDefaultFor` callback: receives the parent instance and the
	 * placeholder owner, and may return a replacement (or mutate in place).
	 */
	readonly defaultFor?: (parent: object, placeholder: object) => object | void;
}

export interface BelongsToMany<
	R extends AnyModelClass,
	T extends string = string,
	F extends string = string,
	P extends string = string,
	L extends string = "id",
	PA extends string | undefined = undefined,
	PC extends PivotClassLike | undefined = undefined,
> {
	readonly kind: "belongsToMany";
	readonly related: () => R;
	readonly through: T;
	readonly localKey: L;
	readonly foreignPivotKey: F;
	readonly relatedPivotKey: P;
	/** Extra pivot columns hydrated into the pivot object (`withPivot`). */
	readonly pivotColumns?: readonly string[];
	/** Pivot timestamp columns hydrated into the pivot object (`timestamps`). */
	readonly pivotTimestamps?: readonly [string, string];
	/** Name of the pivot object attached to related instances (`as`). */
	readonly pivotAccessor?: PA;
	/** Custom pivot model class (`using`). */
	readonly pivotClass?: PC;
}

/**
 * `hasMany` — one parent owns many children (`children.foreignKey = parent.localKey`).
 */
export function hasMany<
	R extends AnyModelClass,
	F extends ColumnNamesOf<R>,
	L extends string = "id",
>(related: () => R, foreignKey: F, localKey?: L): HasMany<R, L, F> {
	return {
		kind: "hasMany",
		related,
		foreignKey,
		localKey: (localKey ?? "id") as L,
	};
}

/**
 * `hasOne` — like `hasMany` but exactly one child.
 */
export function hasOne<
	R extends AnyModelClass,
	F extends ColumnNamesOf<R>,
	L extends string = "id",
>(related: () => R, foreignKey: F, localKey?: L): HasOne<R, L, F> {
	return {
		kind: "hasOne",
		related,
		foreignKey,
		localKey: (localKey ?? "id") as L,
	};
}

/**
 * `latestOfMany` — a `hasOne` returning the related row with the greatest
 * `column` per parent (defaults to the primary key, like Eloquent).
 *
 * ```ts
 * recentPost: latestOfMany(() => Post, "userId", "createdAt"),
 * ```
 */
export function latestOfMany<
	R extends AnyModelClass,
	F extends ColumnNamesOf<R>,
	L extends string = "id",
>(
	related: () => R,
	foreignKey: F,
	column: ColumnNamesOf<R> = "id" as ColumnNamesOf<R>,
	localKey?: L,
): HasOne<R, L, F> {
	return {
		kind: "hasOne",
		related,
		foreignKey,
		localKey: (localKey ?? "id") as L,
		ofMany: { kind: "latest", column, aggregate: "max" },
	};
}

/**
 * `oldestOfMany` — a `hasOne` returning the related row with the smallest
 * `column` per parent.
 */
export function oldestOfMany<
	R extends AnyModelClass,
	F extends ColumnNamesOf<R>,
	L extends string = "id",
>(
	related: () => R,
	foreignKey: F,
	column: ColumnNamesOf<R> = "id" as ColumnNamesOf<R>,
	localKey?: L,
): HasOne<R, L, F> {
	return {
		kind: "hasOne",
		related,
		foreignKey,
		localKey: (localKey ?? "id") as L,
		ofMany: { kind: "oldest", column, aggregate: "min" },
	};
}

/**
 * `ofMany` — a `hasOne` returning the row holding the `min`/`max` of `column`
 * per parent.
 *
 * ```ts
 * cheapest: ofMany(() => Variant, "productId", "price", "min"),
 * ```
 */
export function ofMany<
	R extends AnyModelClass,
	F extends ColumnNamesOf<R>,
	C extends ColumnNamesOf<R>,
	L extends string = "id",
>(
	related: () => R,
	foreignKey: F,
	column: C,
	aggregate: "min" | "max",
	localKey?: L,
): HasOne<R, L, F> {
	return {
		kind: "hasOne",
		related,
		foreignKey,
		localKey: (localKey ?? "id") as L,
		ofMany: { kind: "ofMany", column, aggregate },
	};
}

/**
 * Returns an empty related instance (optionally filled from `attributes`)
 * when a `belongsTo` relation has no owner — Eloquent's `withDefault`.
 *
 * ```ts
 * author: withDefault(belongsTo(() => User, "userId"), { name: "Guest" }),
 * ```
 */
export function withDefault<
	R extends AnyModelClass,
	O extends string = "id",
	F extends string = string,
>(
	relation: BelongsTo<R, O, F>,
	attributes: Readonly<Record<string, unknown>> = {},
): BelongsTo<R, O, F> {
	return { ...relation, defaultAttributes: { ...attributes } };
}

/**
 * `withDefault` variant whose callback receives the parent model and the
 * placeholder owner — mutate it or return a replacement.
 *
 * ```ts
 * author: withDefaultFor(
 *   belongsTo(() => User, "userId"),
 *   (post, user) => user.fill({ name: `Guest of ${post.get("title")}` }),
 *   { active: true },
 * ),
 * ```
 */
export function withDefaultFor<
	R extends AnyModelClass,
	O extends string = "id",
	F extends string = string,
>(
	relation: BelongsTo<R, O, F>,
	factory: (parent: object, placeholder: object) => object | void,
	attributes: Readonly<Record<string, unknown>> = {},
): BelongsTo<R, O, F> {
	return {
		...relation,
		defaultAttributes: { ...attributes },
		defaultFor: factory,
	};
}

/**
 * `belongsTo` — the current table holds `foreignKey`, the related table owns `ownerKey`.
 */
export function belongsTo<
	R extends AnyModelClass,
	O extends ColumnNamesOf<R> = ColumnNamesOf<R>,
	F extends string = string,
>(related: () => R, foreignKey: F, ownerKey?: O): BelongsTo<R, O, F> {
	return {
		kind: "belongsTo",
		related,
		foreignKey,
		ownerKey: (ownerKey ?? "id") as O,
	};
}

export interface BelongsToManyOptions<
	T extends string = string,
	F extends string = string,
	P extends string = string,
	L extends string = "id",
	PA extends string | undefined = undefined,
> {
	/** Pivot table name. It does not need to be part of the typed schema. */
	through: T;
	/** Pivot column referencing the local model's key. */
	foreignPivotKey: F;
	/** Pivot column referencing the related model's key. */
	relatedPivotKey: P;
	/** Local key used for the pivot join. Defaults to the primary key. */
	localKey?: L;
	/**
	 * Extra pivot columns hydrated into the pivot object (Eloquent
	 * `withPivot`) — e.g. `{ withPivot: ["note", "grantedAt"] }`.
	 */
	withPivot?: readonly string[];
	/**
	 * Hydrate pivot timestamps (Eloquent `withTimestamps`): `true` uses
	 * `createdAt`/`updatedAt`, or pass a custom `[createdAt, updatedAt]`
	 * pair. Timestamps are also written by `attach()`.
	 */
	timestamps?: boolean | readonly [string, string];
	/**
	 * Name of the pivot object attached to every related instance
	 * (Eloquent `as`). Defaults to `"pivot"`.
	 */
	as?: PA;
}

/**
 * `belongsToMany` — many-to-many through a pivot table.
 *
 * Pivot keys are columns of the *pivot* table, which is intentionally not
 * constrained to the typed schema.
 */
export function belongsToMany<
	R extends ModelLike,
	T extends string = string,
	F extends string = string,
	P extends string = string,
	L extends string = "id",
	PA extends string | undefined = undefined,
	PC extends PivotClassLike | undefined = undefined,
>(
	related: () => R,
	options: BelongsToManyOptions<T, F, P, L, PA> & { using?: PC },
): BelongsToMany<R, T, F, P, L, PA, PC> {
	return {
		kind: "belongsToMany",
		related,
		through: options.through,
		localKey: (options.localKey ?? "id") as L,
		foreignPivotKey: options.foreignPivotKey,
		relatedPivotKey: options.relatedPivotKey,
		pivotColumns: options.withPivot,
		pivotTimestamps: normalizePivotTimestamps(options.timestamps),
		pivotAccessor: options.as,
		pivotClass: options.using,
	};
}

/** Expands `timestamps: true` into the conventional column pair. */
function normalizePivotTimestamps(
	timestamps: boolean | readonly [string, string] | undefined,
): readonly [string, string] | undefined {
	if (timestamps === undefined || timestamps === false) return undefined;
	if (timestamps === true) return ["createdAt", "updatedAt"];
	return timestamps;
}

/**
 * Resolves a dotted relation path against a static relations map.
 * Returns `undefined` when any segment is missing.
 */
export function relationAt(
	relations: AnyRelations | undefined,
	path: string,
): AnyRelationDescriptor | undefined {
	if (!relations) return undefined;
	const separator = path.indexOf(".");
	if (separator === -1) return relations[path];
	const head = path.slice(0, separator);
	const rest = path.slice(separator + 1);
	const descriptor = relations[head];
	if (!descriptor || descriptor.related === undefined) return undefined;
	const relatedClass = descriptor.related() as { relations?: AnyRelations };
	return relationAt(relatedClass.relations, rest);
}

/** Splits `"posts.comments"` into `["posts", "comments"]`. */
export function splitRelationPath(
	path: string,
): [head: string, rest: string | null] {
	const separator = path.indexOf(".");
	if (separator === -1) return [path, null];
	return [path.slice(0, separator), path.slice(separator + 1)];
}

/** Alias a morph relation uses in the type column (`static morphAlias ?? table`). */
export function morphAliasOf(modelClass: {
	__table?: string;
	morphAlias?: string;
}): string {
	return modelClass.morphAlias ?? modelClass.__table ?? "";
}

/** Derives the conventional morph columns from the relation name. */
export function morphColumns(descriptor: AnyRelationDescriptor): {
	idColumn: string;
	typeColumn: string;
} {
	const name = descriptor.morphName;
	if (name === undefined) {
		throw new Error(
			"Morph descriptor is missing its name — declare it through morphMany/morphOne/morphTo.",
		);
	}
	return {
		idColumn: descriptor.idColumn ?? `${name}Id`,
		typeColumn: descriptor.typeColumn ?? `${name}Type`,
	};
}

// ---------------------------------------------------------------------------
// hasManyThrough / hasOneThrough
// ---------------------------------------------------------------------------

export interface HasManyThrough<
	R extends AnyModelClass,
	T extends AnyModelClass,
	F extends string = string,
	S extends string = string,
	L extends string = "id",
> {
	readonly kind: "hasManyThrough";
	readonly related: () => R;
	readonly through: () => T;
	readonly firstKey: F;
	readonly secondKey: S;
	readonly localKey: L;
	readonly secondLocalKey?: string;
}

export interface HasOneThrough<
	R extends AnyModelClass,
	T extends AnyModelClass,
	F extends string = string,
	S extends string = string,
	L extends string = "id",
> {
	readonly kind: "hasOneThrough";
	readonly related: () => R;
	readonly through: () => T;
	readonly firstKey: F;
	readonly secondKey: S;
	readonly localKey: L;
	readonly secondLocalKey?: string;
}

export interface ThroughOptions<L extends string = "id"> {
	/** Key on the parent table (defaults to its primary key). */
	localKey?: L;
	/** Key on the through table that `secondKey` references (defaults to primary key). */
	secondLocalKey?: string;
}

/**
 * `hasManyThrough` — many related rows reached through an intermediate table:
 * `related.secondKey = through.<secondLocalKey>` and `through.firstKey = parent.localKey`.
 */
export function hasManyThrough<
	R extends AnyModelClass,
	T extends AnyModelClass,
	F extends string = string,
	S extends string = string,
	L extends string = "id",
>(
	related: () => R,
	through: () => T,
	firstKey: F,
	secondKey: S,
	options: ThroughOptions<L> = {},
): HasManyThrough<R, T, F, S, L> {
	return {
		kind: "hasManyThrough",
		related,
		through,
		firstKey,
		secondKey,
		localKey: (options.localKey ?? "id") as L,
		secondLocalKey: options.secondLocalKey,
	};
}

/** `hasOneThrough` — like `hasManyThrough` but at most one related row. */
export function hasOneThrough<
	R extends AnyModelClass,
	T extends AnyModelClass,
	F extends string = string,
	S extends string = string,
	L extends string = "id",
>(
	related: () => R,
	through: () => T,
	firstKey: F,
	secondKey: S,
	options: ThroughOptions<L> = {},
): HasOneThrough<R, T, F, S, L> {
	return {
		kind: "hasOneThrough",
		related,
		through,
		firstKey,
		secondKey,
		localKey: (options.localKey ?? "id") as L,
		secondLocalKey: options.secondLocalKey,
	};
}

// ---------------------------------------------------------------------------
// polymorphic relations
// ---------------------------------------------------------------------------

export interface MorphMany<R extends AnyModelClass, N extends string = string> {
	readonly kind: "morphMany";
	readonly related: () => R;
	readonly morphName: N;
	readonly idColumn?: string;
	readonly typeColumn?: string;
	readonly localKey?: string;
}

export interface MorphOne<R extends AnyModelClass, N extends string = string> {
	readonly kind: "morphOne";
	readonly related: () => R;
	readonly morphName: N;
	readonly idColumn?: string;
	readonly typeColumn?: string;
	readonly localKey?: string;
}

export interface MorphToOptions {
	/** Type column value of the owner (`static morphAlias ?? table` by default). */
	idColumn?: string;
	typeColumn?: string;
	/** Key on the related tables (defaults to their primary key). */
	ownerKey?: string;
}

export interface MorphTo<
	TM extends Record<string, AnyModelClass> = Record<string, AnyModelClass>,
> {
	readonly kind: "morphTo";
	readonly morphName: string;
	readonly types: () => TM;
	readonly idColumn?: string;
	readonly typeColumn?: string;
	readonly ownerKey?: string;
}

/**
 * `morphMany` — the related table carries `${name}Id` + `${name}Type`, and
 * rows whose type equals this model's alias belong to it
 * (`static morphAlias`, defaulting to the table name).
 */
export function morphMany<R extends AnyModelClass, N extends string>(
	related: () => R,
	name: N,
	options: Omit<MorphMany<R, N>, "kind" | "related" | "morphName"> = {},
): MorphMany<R, N> {
	return { kind: "morphMany", related, morphName: name, ...options };
}

/** `morphOne` — like `morphMany` but at most one related row. */
export function morphOne<R extends AnyModelClass, N extends string>(
	related: () => R,
	name: N,
	options: Omit<MorphOne<R, N>, "kind" | "related" | "morphName"> = {},
): MorphOne<R, N> {
	return { kind: "morphOne", related, morphName: name, ...options };
}

/**
 * `morphTo` — the inverse side. The types map declares every alias this
 * column can hold:
 *
 * ```ts
 * static relations = {
 *   commentable: morphTo("commentable", () => ({ posts: Post, videos: Video })),
 * };
 * ```
 */
export function morphTo<const TM extends Record<string, AnyModelClass>>(
	name: string,
	types: () => TM,
	options: MorphToOptions = {},
): MorphTo<TM> {
	return { kind: "morphTo", morphName: name, types, ...options };
}

export interface MorphToManyOptions<
	T extends string = string,
	F extends string = string,
	P extends string = string,
	L extends string = "id",
	PA extends string | undefined = undefined,
> {
	/** Pivot table name (carries `${name}Id`, `${name}Type`, `${relatedPivotKey}`). */
	through: T;
	/** Pivot column referencing the local model's key. */
	foreignPivotKey: F;
	/** Pivot column referencing the related model's key. */
	relatedPivotKey: P;
	/** Local key used for the pivot join (defaults to primary key). */
	localKey?: L;
	/** Key on the related table (defaults to its primary key). */
	relatedKey?: string;
	/** Extra pivot columns hydrated into the pivot object (Eloquent `withPivot`). */
	withPivot?: readonly string[];
	/** Hydrate pivot timestamps (`true` → `createdAt`/`updatedAt`). */
	timestamps?: boolean | readonly [string, string];
	/** Name of the pivot object attached to related instances (default `"pivot"`). */
	as?: PA;
}

export interface MorphToMany<
	R extends AnyModelClass,
	N extends string = string,
	T extends string = string,
	F extends string = string,
	P extends string = string,
	L extends string = "id",
	PA extends string | undefined = undefined,
	PC extends PivotClassLike | undefined = undefined,
> {
	readonly kind: "morphToMany";
	readonly related: () => R;
	readonly morphName: N;
	readonly through: T;
	readonly foreignPivotKey: F;
	readonly relatedPivotKey: P;
	readonly localKey: L;
	readonly relatedKey?: string;
	/**
	 * `morphedByMany`: this model is the *related* side of the morph, so the
	 * type column is filtered by the related class's alias.
	 */
	readonly inverse?: true;
	/** Extra pivot columns hydrated into the pivot object (`withPivot`). */
	readonly pivotColumns?: readonly string[];
	/** Pivot timestamp columns hydrated into the pivot object (`timestamps`). */
	readonly pivotTimestamps?: readonly [string, string];
	/** Name of the pivot object attached to related instances (`as`). */
	readonly pivotAccessor?: PA;
	/** Custom pivot model class (`using`). */
	readonly pivotClass?: PC;
}

/**
 * `morphToMany` — many-to-many through a polymorphic pivot: the pivot rows
 * are scoped by `${name}Type` = this model's alias.
 */
export function morphToMany<
	R extends AnyModelClass,
	N extends string,
	T extends string = string,
	F extends string = string,
	P extends string = string,
	L extends string = "id",
	PA extends string | undefined = undefined,
	PC extends PivotClassLike | undefined = undefined,
>(
	related: () => R,
	name: N,
	options: MorphToManyOptions<T, F, P, L, PA> & { using?: PC },
): MorphToMany<R, N, T, F, P, L, PA, PC> {
	return {
		kind: "morphToMany",
		related,
		morphName: name,
		through: options.through,
		foreignPivotKey: options.foreignPivotKey,
		relatedPivotKey: options.relatedPivotKey,
		localKey: (options.localKey ?? "id") as L,
		relatedKey: options.relatedKey,
		pivotColumns: options.withPivot,
		pivotTimestamps: normalizePivotTimestamps(options.timestamps),
		pivotAccessor: options.as,
		pivotClass: options.using,
	};
}

/**
 * `morphedByMany` — the inverse of `morphToMany`: this model sits on the
 * *related* side of the morph, and the `${name}Type` column carries the
 * related class's alias.
 *
 * ```ts
 * class Tag extends orm.model("tags") {
 *   static relations = {
 *     posts: morphedByMany(() => Post, "taggable", {
 *       through: "taggables",
 *       foreignPivotKey: "tagId",       // local (tag) key column
 *       relatedPivotKey: "taggableId",  // morph id column (post id)
 *     }),
 *   };
 * }
 * ```
 *
 * Pivot keys keep their meaning relative to the declaring model:
 * `foreignPivotKey` references this model, `relatedPivotKey` is the morph id
 * column referencing the related model.
 */
export function morphedByMany<
	R extends AnyModelClass,
	N extends string,
	T extends string = string,
	F extends string = string,
	P extends string = string,
	L extends string = "id",
	PA extends string | undefined = undefined,
>(
	related: () => R,
	name: N,
	options: MorphToManyOptions<T, F, P, L, PA>,
): MorphToMany<R, N, T, F, P, L, PA> {
	return {
		...morphToMany(related, name, options),
		inverse: true,
	};
}
