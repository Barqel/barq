// Type-level surface of the query builder: column references, filter values,
// eager-load result shapes and the public result/page types.
//
// Everything here is types only — no runtime code — so hot paths never load
// this module.

import type { Collection } from "../collection";
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

export type JoinType = "inner" | "left" | "right";

export interface JoinClause {
	readonly type: JoinType;
	readonly table: string;
	readonly left: string;
	readonly operator: string;
	readonly right: string;
}

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
	selectSubs: SelectSubClause[];
	withPaths: WithPathClause[];
	withCounts: RelationCountClause[];
	withAggregates: RelationAggregateClause[];
	withExists: RelationExistsClause[];
	unions: UnionClause[];
	selectRaw: RawClause[];
	ordersRaw: RawClause[];
	groupsRaw: RawClause[];
	lock: "update" | "share" | null;
	softDeleteMode: SoftDeleteMode;
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
type PivotExtraOf<D> = D extends { kind: "belongsToMany" | "morphToMany" }
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

type PrevDepth<D extends number> = D extends 3 ? 2 : D extends 2 ? 1 : 0;

/** Every valid eager-load path for a relations map, up to 3 levels deep. */
export type AllRelationPaths<
	R,
	Depth extends 0 | 1 | 2 | 3 = 3,
> = Depth extends 0
	? never
	: {
			[K in keyof R & string]:
				| K
				| `${K}.${R[K] extends { related: () => infer RC }
						? AllRelationPaths<RelationsOf<RC>, PrevDepth<Depth>>
						: never}`;
		}[keyof R & string];

/** Shape contributed by one eager-loaded path. */
export type LoadedFor<
	M,
	P extends string,
> = P extends `${infer K}.${infer Rest}`
	? K extends keyof RelationsOf<M>
		? {
				[key in K]: RelationValueOf<
					RelationsOf<M>[K],
					LoadedFor<RelatedClassOf<RelationsOf<M>[K]>, Rest>
				>;
			}
		: never
	: P extends keyof RelationsOf<M>
		? { [key in P]: RelationValueOf<RelationsOf<M>[P]> }
		: never;

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
		? RelationValueOf<
				RelationsOf<M>[K],
				RestSegments<P, K> extends never
					? unknown
					: LoadedUnion<RelatedClassOf<RelationsOf<M>[K]>, RestSegments<P, K>>
			>
		: never;
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
 * `withMax`. `morphTo` has no single target table, so it is excluded.
 */
export type AggregateRelationNamesOf<M> = {
	[K in keyof RelationsOf<M> & string]: RelationsOf<M>[K] extends {
		kind: "morphTo";
	}
		? never
		: K;
}[keyof RelationsOf<M> & string];

/** Safe alias for the allowed eager-load paths of a relations map. */
export type AllRelationPathsSafe<R> = AllRelationPaths<R>;

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
		? FinalRelatedOf<RelatedClassOf<RelationsOf<M>[K]>, R>
		: never
	: P extends keyof RelationsOf<M>
		? RelatedClassOf<RelationsOf<M>[P]>
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

/** Result value of `withSum`/`withAvg`/`withMin`/`withMax`. */
export type RelationAggregateResult<
	M,
	P extends string,
	C extends string,
	K extends AggregateKind = "sum",
> =
	ColumnValueOfModel<RelatedOfRelationRef<M, P>, C> extends infer V
		? V extends string
			? string
			: K extends "avg"
				? number
				: V extends bigint
					? bigint
					: number
		: number;

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
	nextCursor: string | null;
	prevCursor: string | null;
	hasMore: boolean;
}

/** Insert result — `id` is present for auto-increment / returning dialects. */
export interface InsertResult<Pk> {
	id: Pk | undefined;
}

/** Input type of a custom cast's `set` function (`never` when absent). */
export type CastSetInput<Spec> = Spec extends {
	set?: (value: infer V) => unknown;
}
	? [V] extends [never]
		? never
		: V
	: never;

/**
 * Applies custom-cast input types over a payload: every column with a custom
 * `set` accepts that function's parameter type instead of the schema type.
 */
export type CastedValues<M, IO> = M extends {
	casts: infer C extends Record<string, unknown>;
}
	? {
			[K in keyof IO]: K extends keyof C
				? [CastSetInput<C[K]>] extends [never]
					? IO[K]
					: CastSetInput<C[K]>
				: IO[K];
		}
	: IO;

/** Values accepted by `Model.create()` when the model declares `fillable`. */
export type CreateValues<
	M,
	S extends Schema,
	T extends TableName<S>,
> = CastedValues<
	M,
	M extends {
		fillable: readonly (infer F extends string)[];
	}
		? Pick<InsertOf<S, T>, F & keyof InsertOf<S, T>>
		: M extends { guarded: readonly (infer G extends string)[] }
			? Omit<InsertOf<S, T>, G & keyof InsertOf<S, T>>
			: InsertOf<S, T>
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
}
