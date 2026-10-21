// Type-level surface of the query builder: column references, filter values,
// eager-load result shapes and the public result/page types.
//
// Everything here is types only — no runtime code — so hot paths never load
// this module.

import type { Collection } from "../collection";
import type { CastSpec } from "../model/casts";
import type { ModelClass } from "../model/model";
import type { AnyRelations } from "../relations/descriptors";
import type { NormalizedColumn, RowValue, TableRow } from "../schema/columns";
import type {
	BaseType,
	ColumnInput,
	ColumnNameOf,
	ColumnsOf,
	InsertOf,
	RowOf,
	Schema,
	TableName,
} from "../schema/define";
import type { QueryBuilder } from "./builder";
import type { RawExpression } from "./raw";

// ---------------------------------------------------------------------------
// Column references
// ---------------------------------------------------------------------------

/** Column references accepted by where/orderBy/groupBy — base table or any joined table. */
export type ColumnRef<
	S extends Schema,
	T extends TableName<S>,
	J extends TableName<S> = never,
> =
	| ColumnNameOf<S, T>
	| `${T}.${ColumnNameOf<S, T>}`
	| { [K in J]: `${K}.${ColumnNameOf<S, K>}` }[J];

type ColumnInputOf<
	S extends Schema,
	TT extends TableName<S>,
	C extends string,
> = C extends ColumnNameOf<S, TT> ? ColumnsOf<S, TT>[C] : never;

/** Filter value type for a column reference (`Date` columns also accept ISO strings / epoch numbers). */
export type FilterValueOf<
	S extends Schema,
	TT extends TableName<S>,
	C extends string,
> =
	ColumnInputOf<S, TT, C> extends infer CI extends ColumnInput
		? BaseType<CI> extends Date
			? RowValue<CI> | string | number
			: RowValue<CI>
		: never;

/** Filter value for a (possibly qualified) column reference. */
export type RefFilterValue<
	S extends Schema,
	T extends TableName<S>,
	R extends string,
> = R extends `${infer JT}.${infer C}`
	? JT extends TableName<S>
		? FilterValueOf<S, JT, C>
		: never
	: R extends ColumnNameOf<S, T>
		? FilterValueOf<S, T, R>
		: never;

export type ComparisonOperator =
	| "="
	| "=="
	| "!="
	| "<>"
	| ">"
	| ">="
	| "<"
	| "<=";
export type StringOperator = ComparisonOperator | "like" | "not like" | "ilike";

/** Column types that support arithmetic (`decimal` is stored as a string). */
type NumericColumnType = "integer" | "bigint" | "float" | "double" | "decimal";

/** Columns of the current table whose declared column type is numeric. */
export type NumericColumnOf<S extends Schema, T extends TableName<S>> = {
	[C in ColumnNameOf<S, T>]: NormalizedColumn<
		ColumnsOf<S, T>[C]
	>["type"] extends NumericColumnType
		? C
		: never;
}[ColumnNameOf<S, T>];

export type AggregateValueOf<
	S extends Schema,
	T extends TableName<S>,
	C extends string,
> =
	C extends ColumnNameOf<S, T>
		? BaseType<ColumnsOf<S, T>[C]> extends string
			? string
			: BaseType<ColumnsOf<S, T>[C]> extends bigint
				? bigint
				: number
		: never;

/** Result of `avg()` — averages are fractional even for bigint columns. */
export type AverageValueOf<
	S extends Schema,
	T extends TableName<S>,
	C extends string,
> =
	C extends ColumnNameOf<S, T>
		? BaseType<ColumnsOf<S, T>[C]> extends string
			? string
			: number
		: never;

// ---------------------------------------------------------------------------
// Builder state
// ---------------------------------------------------------------------------

import type { WhereEntry } from "./predicates";

export type JoinType = "inner" | "left" | "right" | "cross";

export interface JoinClause {
	readonly type: JoinType;
	/** Real table name, or the alias of the subquery in `joinSub`. */
	readonly table: string;
	readonly left?: string;
	readonly operator?: string;
	readonly right?: string;
	/** Compiled subquery builder for `joinSub`/`leftJoinSub`/`rightJoinSub`. */
	readonly sub?: unknown;
}

/** One `WITH`/`WITH RECURSIVE` common table expression. */
export interface CteClause {
	readonly name: string;
	readonly columns?: readonly string[];
	readonly recursive: boolean;
	/** Compiled Kysely subquery builder (opaque here to keep types Kysely-free). */
	readonly sub: unknown;
}

/** `fromSub(...)`/`fromCte(...)`/`fromRaw(...)` override of the FROM clause. */
export type FromClause =
	| { readonly kind: "sub"; readonly alias: string; readonly sub: unknown }
	| { readonly kind: "cte"; readonly name: string }
	| {
			readonly kind: "raw";
			readonly expression: unknown;
			readonly alias: string;
	  };

export interface OrderClause {
	readonly column: string;
	readonly direction: "asc" | "desc";
}

export interface WhereHasClause {
	readonly path: string;
	readonly entries: readonly WhereEntry[];
	readonly boolean: "and" | "or";
	readonly negated: boolean;
}

/** One eager-load entry: a dotted path plus an optional constraint callback. */
export interface WithPathClause {
	readonly path: string;
	readonly constrain?: (query: unknown) => void;
	/** Per-morph-type constraints (`withMorph`). */
	readonly morphConstraints?: Record<string, (query: unknown) => void>;
}

/**
 * Where-clauses captured from an aggregate constraint callback, plus the
 * soft-delete mode the callback requested (`withTrashed()` inside the
 * constraint must not be silently dropped).
 */
export interface AggregateConstraint {
	readonly wheres: readonly WhereEntry[];
	readonly softDeleteMode: SoftDeleteMode;
}

/** `withCount` entry (`"posts as pendingCount"` → relation/alias). */
export interface RelationCountClause {
	readonly relation: string;
	readonly alias: string;
	readonly constraint: AggregateConstraint;
}

/** Aggregate functions supported by `withSum`/`withAvg`/`withMin`/`withMax`. */
export type AggregateKind = "sum" | "avg" | "min" | "max";

/** `withSum`-family entry. */
export interface RelationAggregateClause {
	readonly relation: string;
	readonly alias: string;
	readonly kind: AggregateKind;
	readonly column: string;
	readonly constraint: AggregateConstraint;
}

/** `withExists` entry. */
export interface RelationExistsClause {
	readonly relation: string;
	readonly alias: string;
	readonly constraint: AggregateConstraint;
}

/** `selectSub(...)` entry — a scalar subquery selected under an alias. */
export interface SelectSubClause {
	readonly alias: string;
	/** Compiled Kysely subquery builder (opaque here to keep types Kysely-free). */
	readonly sub: unknown;
}

/** `union` / `unionAll` entry. */
export interface UnionClause {
	readonly all: boolean;
	/** Compiled Kysely subquery builder (opaque here to keep types Kysely-free). */
	readonly sub: unknown;
}

/** Raw select/order/group piece. */
export interface RawClause {
	readonly expression: RawExpression;
	readonly alias?: string;
}

/**
 * Post-hydration hook: receives the materialized model rows of a query so
 * callers (relation managers, plugins) can attach extra state — pivot objects,
 * computed metadata — without changing the emitted SQL.
 */
export type ResultHook = (rows: object[]) => void | Promise<void>;

/** How a model query treats soft-deleted rows. */
export type SoftDeleteMode = "default" | "with" | "only";

/** Mutable builder state. Cloned by `clone()`. */
export interface BuilderState {
	wheres: WhereEntry[];
	joins: JoinClause[];
	orders: OrderClause[];
	groups: string[];
	havings: WhereEntry[];
	limit?: number;
	offset?: number;
	selected: string[] | null;
	distinct: boolean;
	distinctOn: string[];
	selectSubs: SelectSubClause[];
	withPaths: WithPathClause[];
	withCounts: RelationCountClause[];
	withAggregates: RelationAggregateClause[];
	withExists: RelationExistsClause[];
	unions: UnionClause[];
	selectRaw: RawClause[];
	ordersRaw: RawClause[];
	groupsRaw: RawClause[];
	ctes: CteClause[];
	from: FromClause | null;
	lock: "update" | "share" | null;
	softDeleteMode: SoftDeleteMode;
	/** Post-hydration hooks, run in registration order by `get()`. */
	resultHooks: ResultHook[];
	/** Per-query cast overrides (`withCasts`). */
	castOverrides: Record<string, CastSpec>;
}

// ---------------------------------------------------------------------------
// Eager-load typing
// ---------------------------------------------------------------------------

/** Model classes without relations: an empty, closed relation map. */
type NoRelations = Record<never, never>;

/** Relation map carried by a model class. */
export type RelationsOf<M> = M extends {
	relations: infer R extends AnyRelations;
}
	? R
	: NoRelations;

export type RelatedClassOf<D> = D extends { related: () => infer R }
	? R
	: never;

/** Instance type of a model class. */
export type InstanceOf<M> = M extends abstract new (
	...args: never[]
) => infer I
	? I
	: never;

/** Table name declared by a model class. */
export type TableOfModel<M> = M extends { __table: infer TN } ? TN : never;

/**
 * The model classes a polymorphic relation points at.
 *
 * `P` is the relation path — the relation itself must be a `morphTo`.
 */
export type MorphTypesOf<M, P extends string> = P extends keyof RelationsOf<M>
	? RelationsOf<M>[P] extends { types: () => infer TM }
		? TM
		: never
	: never;

/** Constraint callback bound to one polymorphic target model. */
export type MorphTargetConstraint<TM> = (
	query: QueryBuilder<
		Schema,
		TableOfModel<TM> & TableName<Schema>,
		TM,
		unknown,
		null,
		never
	>,
) => void;

/**
 * Per-morph-type constraint map.
 *
 * Every key is one declared morph alias and its callback is typed against that
 * target model, so each type can be constrained on its own columns.
 */
export type MorphConstraintMapOf<M, P extends string> = [
	MorphTypesOf<M, P>,
] extends [never]
	? Record<string, MorphTargetConstraint<ModelClass<Schema, TableName<Schema>>>>
	: {
			[K in keyof MorphTypesOf<M, P>]: MorphTargetConstraint<
				MorphTypesOf<M, P>[K]
			>;
		};

/** Name of the pivot object a pivot relation attaches (default `"pivot"`). */
type PivotAccessorOf<D> = D extends { pivotAccessor?: infer A }
	? Extract<A, string> extends never
		? "pivot"
		: Extract<A, string>
	: "pivot";

/**
 * Pivot object attached to `belongsToMany` / `morphToMany` results: the two
 * pivot keys plus every `withPivot` / timestamp column (values are `unknown`
 * — the pivot table is not part of the typed schema). With a custom pivot
 * model (`using`) the accessor is typed as an instance of that class.
 */
export type PivotExtraOf<D> = D extends {
	kind: "belongsToMany" | "morphToMany";
}
	? {
			[K in PivotAccessorOf<D>]: [PivotInstanceOf<D>] extends [never]
				? Record<string, unknown>
				: PivotInstanceOf<D>;
		}
	: unknown;

/** Instance type of a descriptor's `using` pivot model, if any. */
type PivotInstanceOf<D> = D extends { pivotClass?: infer C }
	? C extends abstract new (
			...args: never[]
		) => infer P
		? P
		: never
	: never;

export type RelationValueOf<D, Extra = unknown> = D extends {
	kind:
		| "hasMany"
		| "belongsToMany"
		| "morphMany"
		| "morphToMany"
		| "hasManyThrough";
}
	? Collection<InstanceOf<RelatedClassOf<D>> & Extra & PivotExtraOf<D>>
	: D extends { kind: "morphTo"; types: () => infer TM }
		? (TM[keyof TM & string] extends infer C ? InstanceOf<C> : never) | null
		: (InstanceOf<RelatedClassOf<D>> & Extra) | null;

type PrevDepth<D extends number> = D extends 10
	? 9
	: D extends 9
		? 8
		: D extends 8
			? 7
			: D extends 7
				? 6
				: D extends 6
					? 5
					: D extends 5
						? 4
						: D extends 4
							? 3
							: D extends 3
								? 2
								: D extends 2
									? 1
									: 0;

/**
 * Relations of every model a `morphTo` relation can point at.
 *
 * The result is a union of relation maps; `AllRelationPaths` distributes over
 * it, so a path below a polymorphic relation is valid when *any* of its
 * targets declares it.
 */
export type MorphRelationsOf<D> = D extends { types: () => infer TM }
	? TM[keyof TM] extends infer MC
		? MC extends { relations: infer R extends Record<string, unknown> }
			? R
			: never
		: never
	: never;

/**
 * Every valid eager-load path for a relations map.
 *
 * The default depth is 6 levels — deep enough for real applications while
 * keeping the generated union small enough for the type checker. Paths below
 * a `morphTo` relation are resolved against the union of its target models.
 */
export type AllRelationPaths<R, Depth extends number = 5> = Depth extends 0
	? never
	: R extends unknown
		? {
				[K in keyof R & string]:
					| K
					| `${K}.${R[K] extends { related: () => infer RC }
							? AllRelationPaths<RelationsOf<RC>, PrevDepth<Depth>>
							: R[K] extends { types: () => unknown }
								? AllRelationPaths<MorphRelationsOf<R[K]>, PrevDepth<Depth>>
								: never}`;
			}[keyof R & string]
		: never;

/** Shape contributed by one eager-loaded path. */
export type LoadedFor<
	M,
	P extends string,
> = P extends `${infer K}.${infer Rest}`
	? K extends keyof RelationsOf<M>
		? RelationsOf<M>[K] extends { kind: "morphTo" }
			? {
					[key in K]: RelationValueOf<RelationsOf<M>[K]>;
				}
			: {
					[key in K]: RelationValueOf<
						RelationsOf<M>[K],
						LoadedFor<RelatedClassOf<RelationsOf<M>[K]>, Rest>
					>;
				}
		: unknown
	: P extends keyof RelationsOf<M>
		? { [key in P]: RelationValueOf<RelationsOf<M>[P]> }
		: unknown;

/** First segment of a (possibly nested) eager-load path. */
type FirstSegmentOf<P extends string> = P extends `${infer K}.${string}`
	? K
	: P;

/**
 * Nested remainders of `P` below one top-level relation:
 * `"posts.author"` for `K = "posts"` yields `"author"`, the bare `"posts"`
 * yields `never`.
 */
type RestSegments<P extends string, K extends string> = P extends K
	? never
	: P extends `${K}.${infer R}`
		? R
		: never;

/**
 * Shape contributed by a set of eager-load paths — merged per relation, so
 * `with("posts", "posts.author")` produces one `posts` property whose
 * elements carry the nested `author`, never two intersecting array types.
 */
export type LoadedUnion<M, P extends string> = {
	[K in FirstSegmentOf<P>]: K extends keyof RelationsOf<M>
		? RelationsOf<M>[K] extends { kind: "morphTo" }
			? RelationValueOf<RelationsOf<M>[K]>
			: RelationValueOf<
					RelationsOf<M>[K],
					RestSegments<P, K> extends never
						? unknown
						: LoadedUnion<RelatedClassOf<RelationsOf<M>[K]>, RestSegments<P, K>>
				>
		: unknown;
};

/** Relation names declared by a model class. */
export type RelationNamesOf<M> = keyof RelationsOf<M> & string;

/** Local scope map declared as `static scopes = { … }`. */
export type LocalScopesOf<M> = M extends {
	scopes: infer S extends Record<
		string,
		(query: never, ...args: never[]) => unknown
	>;
}
	? S
	: Record<never, never>;

/** Names of declared local scopes. */
export type LocalScopeNamesOf<M> = keyof LocalScopesOf<M> & string;

/** Extra arguments accepted by one local scope (after the query). */
export type LocalScopeArgsOf<
	M,
	K extends string,
> = K extends keyof LocalScopesOf<M>
	? LocalScopesOf<M>[K] extends (query: never, ...args: infer A) => unknown
		? A
		: never
	: never;

/** Global scope map declared as `static globalScopes = { … }`. */
export type GlobalScopesOf<M> = M extends {
	globalScopes: infer S extends Record<string, (query: never) => unknown>;
}
	? S
	: Record<never, never>;

/** Names of declared global scopes. */
export type GlobalScopeNamesOf<M> = keyof GlobalScopesOf<M> & string;

/**
 * Relation names usable with `withCount`/`withSum`/`withAvg`/`withMin`/
 * `withMax`.
 *
 * Polymorphic relations are included: the aggregate is computed per declared
 * morph type and the matching branch is selected through the type column.
 */
export type AggregateRelationNamesOf<M> = keyof RelationsOf<M> & string;

/** Safe alias for the allowed eager-load paths of a relations map. */
export type AllRelationPathsSafe<R> = AllRelationPaths<R>;

/**
 * A relation path accepted by the builder.
 *
 * Paths that follow declared relations are checked at compile time. Paths
 * deeper than the enumerated depth are accepted as well — the first segment is
 * still checked, the rest is validated at runtime — so arbitrarily deep
 * relation graphs stay usable without exploding the generated union.
 */
export type RelationPathOf<R> = AllRelationPathsSafe<R> | DeepRelationPaths<R>;

/**
 * Number of segments a path may have before the compile-time check relaxes.
 *
 * Paths with up to this many segments are validated at compile time against
 * the declared relations. Longer paths are accepted as well (the first segment
 * is still checked) and validated at runtime, so arbitrarily deep relation
 * graphs stay usable without exploding the generated union.
 */
export type RelationPathDepth = 5;

/** `".${string}"` repeated `N` times. */
type Seg = `${string}`;

/**
 * Tail patterns for paths that are longer than the enumerated depth — five
 * segments up to eleven.
 */
type DeepTailPatterns =
	| `.${Seg}.${Seg}.${Seg}.${Seg}.${Seg}`
	| `.${Seg}.${Seg}.${Seg}.${Seg}.${Seg}.${Seg}`
	| `.${Seg}.${Seg}.${Seg}.${Seg}.${Seg}.${Seg}.${Seg}`
	| `.${Seg}.${Seg}.${Seg}.${Seg}.${Seg}.${Seg}.${Seg}.${Seg}`
	| `.${Seg}.${Seg}.${Seg}.${Seg}.${Seg}.${Seg}.${Seg}.${Seg}.${Seg}`
	| `.${Seg}.${Seg}.${Seg}.${Seg}.${Seg}.${Seg}.${Seg}.${Seg}.${Seg}.${Seg}`
	| `.${Seg}.${Seg}.${Seg}.${Seg}.${Seg}.${Seg}.${Seg}.${Seg}.${Seg}.${Seg}.${Seg}`;

/** Paths with more segments than the enumerated depth. */
type DeepRelationPaths<R> = {
	[K in keyof R & string]: `${K}${DeepTailPatterns}`;
}[keyof R & string];

/** `"posts"` or `"posts as my"` → `"posts"`. */
export type RelationRefOf<P extends string> =
	P extends `${infer R} as ${string}` ? R : P;

/** Alias part of `"posts as my"`; `never` when no alias is declared. */
export type AliasOf<P extends string> = P extends `${string} as ${infer A}`
	? A
	: never;

/** Related model class of a (possibly aliased) relation reference. */
export type RelatedOfRelationRef<M, P extends string> =
	RelationRefOf<P> extends keyof RelationsOf<M>
		? RelatedClassOf<RelationsOf<M>[RelationRefOf<P>]>
		: never;

/** Last model class on a dotted eager-load path. */
export type FinalRelatedOf<
	M,
	P extends string,
> = P extends `${infer K}.${infer R}`
	? K extends keyof RelationsOf<M>
		? RelationsOf<M>[K] extends {
				kind: "morphTo";
				types: () => infer TM;
			}
			? FinalRelatedOfTargets<TM[keyof TM], R>
			: FinalRelatedOf<RelatedClassOf<RelationsOf<M>[K]>, R>
		: never
	: P extends keyof RelationsOf<M>
		? RelatedClassOf<RelationsOf<M>[P]>
		: never;

/**
 * `FinalRelatedOf` for a set of candidate models — a polymorphic relation
 * resolves to the union of its targets.
 */
export type FinalRelatedOfTargets<M, P extends string> = M extends unknown
	? FinalRelatedOf<M, P>
	: never;

/** Column names of a model class (schema-aware, `string` otherwise). */
export type ColumnsOfModel<M> = M extends {
	readonly __schema?: infer S extends Schema;
	readonly __table: infer T extends string;
}
	? T extends TableName<S>
		? ColumnNameOf<S, T>
		: string
	: string;

/** Value type of one column of a model's table. */
export type ColumnValueOfModel<M, C extends string> = M extends {
	readonly __schema?: infer S extends Schema;
	readonly __table: infer T extends string;
}
	? T extends TableName<S>
		? C extends ColumnNameOf<S, T>
			? RowOf<S, T>[C]
			: never
		: unknown
	: unknown;

/** Aggregate result key: `"total"` when aliased, `${ref}Sum${Column}` otherwise. */
export type AggregateKeyOf<P extends string, Suffix extends string> =
	AliasOf<P> extends never ? `${RelationRefOf<P>}${Suffix}` : AliasOf<P>;

/** Keys contributed to a model instance by `loadCount(...)`. */
export type CountExtrasOf<P extends string> = {
	readonly [K in P as AggregateKeyOf<K, "Count">]: number;
};

/** Keys contributed to a model instance by `loadSum`/`loadAvg`/`loadMin`/`loadMax`. */
export type AggregateExtrasOf<
	P extends string,
	C extends string,
	K extends AggregateKind,
> = {
	readonly [Key in P as AggregateKeyOf<
		Key,
		`${Capitalize<K>}${Capitalize<C>}`
	>]: number | null;
};

/** Result value of `withSum`/`withAvg`/`withMin`/`withMax`. */
export type RelationAggregateResult<
	M,
	P extends string,
	C extends string,
	K extends AggregateKind = "sum",
> =
	ColumnValueOfModel<RelatedOfRelationRef<M, P>, C> extends infer V
		? [V] extends [never]
			? number
			: V extends string
				? string
				: K extends "avg"
					? number
					: V extends bigint
						? bigint
						: number
		: number;

/**
 * Column accepted by an aggregate over a relation.
 *
 * A polymorphic relation has no single target table, so any column name is
 * accepted there and validated against every declared morph type at runtime.
 */
export type AggregateColumnOf<M, P extends string> = [
	RelatedOfRelationRef<M, P>,
] extends [never]
	? string
	: ColumnsOfModel<RelatedOfRelationRef<M, P>>;

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------

type AccessorMapOf<M> = M extends {
	accessors: infer A extends Record<string, (model: never) => unknown>;
}
	? A
	: Record<never, never>;

/** Names of computed accessors declared on a model class. */
export type AccessorNamesOf<M> = keyof AccessorMapOf<M> & string;

/** Return type of one declared accessor. */
export type AccessorValueOf<
	M,
	K extends string,
> = K extends keyof AccessorMapOf<M>
	? AccessorMapOf<M>[K] extends (...args: infer _Args) => infer R
		? R
		: never
	: never;

/** Intersects a model instance with its declared accessors (as properties). */
export type WithAccessors<M, I> = M extends {
	accessors: infer A extends Record<string, (model: never) => unknown>;
}
	? I & {
			readonly [K in keyof A & string]: A[K] extends (
				...args: infer _Args
			) => infer R
				? R
				: never;
		}
	: I;

// ---------------------------------------------------------------------------
// Public result types
// ---------------------------------------------------------------------------

/** Final row type of a query. */
export type ResultOf<
	S extends Schema,
	T extends TableName<S>,
	M,
	Loaded,
	Sel extends ColumnNameOf<S, T> | null,
> = [Sel] extends [null]
	? M extends undefined
		? TableRow<S[T]> & Loaded
		: WithAccessors<M, InstanceOf<M>> & Loaded
	: Pick<TableRow<S[T]>, Sel & keyof TableRow<S[T]>> & Loaded;

/** A page of results with its metadata. */
export interface Paginated<R> {
	data: Collection<R>;
	total: number;
	page: number;
	perPage: number;
	lastPage: number;
	from: number;
	to: number;
	hasMore: boolean;
}

/** A page without a total count (`simplePaginate`). */
export interface SimplePaginated<R> {
	data: Collection<R>;
	page: number;
	perPage: number;
	from: number;
	to: number;
	hasMore: boolean;
}

/** A cursor-paginated page (`cursorPaginate`). */
export interface CursorPaginated<R> {
	data: Collection<R>;
	perPage: number;
	/** Cursor for the next page (`null` on the last page). */
	nextCursor: string | null;
	/** Cursor for the previous page (`null` on the first page). */
	prevCursor: string | null;
	hasMore: boolean;
	hasPrevious: boolean;
}

/** Insert result — `id` is present for auto-increment / returning dialects. */
export interface InsertResult<Pk> {
	id: Pk | undefined;
}

/** Input type of a custom cast's `set` function (`never` when absent). */
export type CastSetInput<Spec> = Spec extends {
	enum: infer E;
}
	? E extends { from(value: unknown): infer C }
		? C
		: E extends Readonly<Record<string, string | number>>
			? E[keyof E]
			: string | number
	: Spec extends {
				set?: (value: infer V) => unknown;
			}
		? [V] extends [never]
			? never
			: V
		: never;

/**
 * Applies custom-cast input types over a payload: every column with a custom
 * `set` accepts that function's parameter type instead of the schema type.
 *
 * Both cast declarations are supported: a map (`static casts = { … }`) and a
 * method (`static casts() { return { … } }`).
 */
export type CastedValues<M, IO> = M extends {
	casts: infer C extends Record<string, unknown>;
}
	? CastedValuesOver<C, IO>
	: M extends { casts: () => infer R extends Record<string, unknown> }
		? CastedValuesOver<R, IO>
		: IO;

/** Applies one cast map over a payload. */
type CastedValuesOver<C extends Record<string, unknown>, IO> = {
	[K in keyof IO]: K extends keyof C
		? [CastSetInput<C[K]>] extends [never]
			? IO[K]
			: CastSetInput<C[K]>
		: IO[K];
};

/** The primary-key column of a table. */
export type PrimaryKeyOf<S extends Schema, T extends TableName<S>> = {
	[C in keyof S[T]]: S[T][C] extends { primaryKey: true } ? C : never;
}[keyof S[T]];

/** The insert payload of a model, before the casts are applied. */
type InsertPayloadOf<M, S extends Schema, T extends TableName<S>> = M extends {
	fillable: readonly (infer F extends string)[];
}
	? Pick<InsertOf<S, T>, F & keyof InsertOf<S, T>>
	: M extends { guarded: readonly (infer G extends string)[] }
		? Omit<InsertOf<S, T>, G & keyof InsertOf<S, T>>
		: InsertOf<S, T>;

/** Makes the primary key optional — models with unique ids generate it. */
type WithOptionalKey<Payload, S extends Schema, T extends TableName<S>> =
	PrimaryKeyOf<S, T> extends infer K
		? K extends keyof Payload
			? Omit<Payload, K> & Partial<Pick<Payload, K>>
			: Payload
		: Payload;

/** Values accepted by `Model.create()` when the model declares `fillable`. */
export type CreateValues<
	M,
	S extends Schema,
	T extends TableName<S>,
> = CastedValues<
	M,
	M extends { usesUniqueIds: true | "ulid" | "uuid" }
		? WithOptionalKey<InsertPayloadOf<M, S, T>, S, T>
		: InsertPayloadOf<M, S, T>
>;

/** Value type of one column (schema-aware). */
export type RowValueOf<
	S extends Schema,
	TT extends TableName<S>,
	C extends ColumnNameOf<S, TT>,
> = RowValue<ColumnsOf<S, TT>[C]>;

/** The narrowed builder handed to `where` / `whereNot` / `whereHas` callbacks. */
export interface WhereGroup<
	S extends Schema,
	T extends TableName<S>,
	J extends TableName<S> = never,
> {
	where<R extends ColumnRef<S, T, J>>(
		column: R,
		value: RefFilterValue<S, T, R>,
	): this;
	where<R extends ColumnRef<S, T, J>>(
		column: R,
		operator: ComparisonOperator,
		value: RefFilterValue<S, T, R>,
	): this;
	where<R extends ColumnRef<S, T, J>>(
		column: R,
		operator: "like" | "not like" | "ilike",
		value: string,
	): this;
	where(callback: (group: WhereGroup<S, T, J>) => void): this;
	orWhere<R extends ColumnRef<S, T, J>>(
		column: R,
		value: RefFilterValue<S, T, R>,
	): this;
	orWhere<R extends ColumnRef<S, T, J>>(
		column: R,
		operator: ComparisonOperator,
		value: RefFilterValue<S, T, R>,
	): this;
	orWhere<R extends ColumnRef<S, T, J>>(
		column: R,
		operator: "like" | "not like" | "ilike",
		value: string,
	): this;
	orWhere(callback: (group: WhereGroup<S, T, J>) => void): this;
	whereNot(callback: (group: WhereGroup<S, T, J>) => void): this;
	whereIn<R extends ColumnRef<S, T, J>>(
		column: R,
		values: ReadonlyArray<RefFilterValue<S, T, R>>,
	): this;
	whereNotIn<R extends ColumnRef<S, T, J>>(
		column: R,
		values: ReadonlyArray<RefFilterValue<S, T, R>>,
	): this;
	whereNull(column: ColumnRef<S, T, J>): this;
	whereNotNull(column: ColumnRef<S, T, J>): this;
	whereBetween<R extends ColumnRef<S, T, J>>(
		column: R,
		range: readonly [RefFilterValue<S, T, R>, RefFilterValue<S, T, R>],
	): this;
	whereRaw(
		expression: RawExpression | string,
		parameters?: readonly unknown[],
	): this;
	orWhereIn<R extends ColumnRef<S, T, J>>(
		column: R,
		values: ReadonlyArray<RefFilterValue<S, T, R>>,
	): this;
	orWhereNotIn<R extends ColumnRef<S, T, J>>(
		column: R,
		values: ReadonlyArray<RefFilterValue<S, T, R>>,
	): this;
	orWhereNull(column: ColumnRef<S, T, J>): this;
	orWhereNotNull(column: ColumnRef<S, T, J>): this;
	orWhereBetween<R extends ColumnRef<S, T, J>>(
		column: R,
		range: readonly [RefFilterValue<S, T, R>, RefFilterValue<S, T, R>],
	): this;
	orWhereNotBetween<R extends ColumnRef<S, T, J>>(
		column: R,
		range: readonly [RefFilterValue<S, T, R>, RefFilterValue<S, T, R>],
	): this;
	orWhereRaw(
		expression: RawExpression | string,
		parameters?: readonly unknown[],
	): this;
	orWhereColumn(
		left: ColumnRef<S, T, J>,
		operator: ComparisonOperator,
		right: ColumnRef<S, T, J>,
	): this;
	whereNotBetween<R extends ColumnRef<S, T, J>>(
		column: R,
		range: readonly [RefFilterValue<S, T, R>, RefFilterValue<S, T, R>],
	): this;
	whereLike<R extends ColumnRef<S, T, J>>(column: R, pattern: string): this;
	orWhereLike<R extends ColumnRef<S, T, J>>(column: R, pattern: string): this;
	whereNotLike<R extends ColumnRef<S, T, J>>(column: R, pattern: string): this;
	orWhereNotLike<R extends ColumnRef<S, T, J>>(
		column: R,
		pattern: string,
	): this;
	whereBetweenColumns(
		column: ColumnRef<S, T, J>,
		range: readonly [ColumnRef<S, T, J>, ColumnRef<S, T, J>],
	): this;
	whereNotBetweenColumns(
		column: ColumnRef<S, T, J>,
		range: readonly [ColumnRef<S, T, J>, ColumnRef<S, T, J>],
	): this;
}
