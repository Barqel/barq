// The typed, chainable query builder.
//
// Type parameters:
//   S      — the schema
//   T      — current table
//   M      — bound model class (model mode) or undefined (row mode)
//   Loaded — intersection of eager-loaded relation shapes accumulated by `with`
//   Sel    — selected columns (`null` = full row)
//   J      — tables added by joins (their columns become filterable)
//
// Runtime state is one mutable object. Methods that change the result TYPE
// (`select`, `addSelect`, `with`, `join`, …) return the same instance re-typed:
// a single, documented assertion boundary instead of a duplicated builder.

import { sql } from "kysely";
import { Collection } from "../collection";
import {
	type DialectKind,
	InvalidQueryError,
	ModelNotFoundError,
	UniqueConstraintError,
} from "../errors";
import { emitRetrieved } from "../model/model";
import type { Orm, TableMeta } from "../orm";
import {
	type AnyRelationDescriptor,
	type AnyRelations,
	relationAt,
} from "../relations/descriptors";
import { ofManyPredicateSql } from "../relations/of-many";
import {
	type ColumnDefinition,
	type ColumnMap,
	normalizeColumn,
} from "../schema/columns";
import type {
	ColumnNameOf,
	InsertOf,
	PrimaryKeyValueOf,
	Schema,
	TableName,
	UpdateOf,
} from "../schema/define";
import { hydrateRow } from "./hydrate";

import {
	foldEntries,
	type Predicate,
	trueExpression,
	type WhereEntry,
} from "./predicates";
import { quoteReference, type RawExpression, raw, rawToKysely } from "./raw";
import type {
	AggregateConstraint,
	AggregateKeyOf,
	AggregateKind,
	AggregateRelationNamesOf,
	AggregateValueOf,
	AllRelationPathsSafe,
	AverageValueOf,
	BuilderState,
	ColumnRef,
	ColumnsOfModel,
	ColumnValueOfModel,
	ComparisonOperator,
	CreateValues,
	CursorPaginated,
	FinalRelatedOf,
	InsertResult,
	InstanceOf,
	JoinType,
	LoadedUnion,
	LocalScopeArgsOf,
	LocalScopeNamesOf,
	NumericColumnOf,
	Paginated,
	RefFilterValue,
	RelatedOfRelationRef,
	RelationAggregateClause,
	RelationAggregateResult,
	RelationCountClause,
	RelationsOf,
	ResultOf,
	RowValueOf,
	SimplePaginated,
	SoftDeleteMode,
	TableOfModel,
	WhereGroup,
} from "./types";

/**
 * Erased Kysely builder surface — the single internal compile boundary.
 * Everything passing through here is immediately compiled and executed via
 * `orm.execute`, which translates driver errors and re-validates bindings.
 */
type AnyBuilder = any;

const KNOWN_JOIN_OPERATORS = new Set([
	"=",
	"==",
	"!=",
	"<>",
	">",
	">=",
	"<",
	"<=",
]);

function emptyState(): BuilderState {
	return {
		wheres: [],
		joins: [],
		orders: [],
		groups: [],
		havings: [],
		selected: null,
		distinct: false,
		selectSubs: [],
		withPaths: [],
		withCounts: [],
		withAggregates: [],
		withExists: [],
		unions: [],
		selectRaw: [],
		ordersRaw: [],
		groupsRaw: [],
		lock: null,
		softDeleteMode: "default",
	};
}

/** Parses `"posts as pending"` into its relation/alias parts. */
function parseRelationRef(
	reference: string,
	caller: string,
): { relation: string; alias: string | null } {
	const match = /^(.*?)\s+as\s+(.+)$/.exec(reference);
	if (match === null) return { relation: reference, alias: null };
	const [, relation, alias] = match as unknown as [string, string, string];
	if (relation.trim() === "" || alias.trim() === "") {
		throw new InvalidQueryError(
			`${caller}(${JSON.stringify(reference)}): expected "relation as alias".`,
		);
	}
	return { relation: relation.trim(), alias: alias.trim() };
}

/** Soft-delete column declared by a model class, or `null`. */
function softDeleteColumnOf<Sc extends Schema>(
	orm: Orm<Sc>,
	modelClass: unknown,
): string | null {
	const cls = modelClass as
		| { __table?: string; softDeletes?: boolean | { column?: string } }
		| undefined;
	const config = cls?.softDeletes;
	if (config === undefined || config === false) return null;
	const column =
		typeof config === "object" && config.column !== undefined
			? config.column
			: "deletedAt";
	const table = cls?.__table;
	if (table !== undefined) {
		const meta = orm.internalMeta(table as never);
		if (!Object.hasOwn(meta.columns, column)) {
			throw new InvalidQueryError(
				`Soft-delete column "${column}" does not exist on "${table}". Add it to the schema or configure a different column.`,
			);
		}
	}
	return column;
}

function requireKey(
	key: string | undefined,
	kind: string,
	relation: string,
): string {
	if (key === undefined) {
		throw new InvalidQueryError(
			`Relation "${relation}" (${kind}) is missing a required key. Re-declare it with the relation factory.`,
		);
	}
	return key;
}

function morphColumnsOf(
	descriptor: AnyRelationDescriptor,
	relation: string,
): { idColumn: string; typeColumn: string } {
	const name = descriptor.morphName;
	if (name === undefined) {
		throw new InvalidQueryError(
			`Relation "${relation}": morph descriptor is missing its name.`,
		);
	}
	return {
		idColumn: descriptor.idColumn ?? `${name}Id`,
		typeColumn: descriptor.typeColumn ?? `${name}Type`,
	};
}

/** Applies a default/only soft-delete filter to a related-table subquery. */
function applySoftScope<Sc extends Schema>(
	orm: Orm<Sc>,
	sub: AnyBuilder,
	relatedClass: unknown,
	mode: SoftDeleteMode,
	table: string,
): AnyBuilder {
	if (mode === "with") return sub;
	const column = softDeleteColumnOf(orm, relatedClass);
	if (column === null) return sub;
	return mode === "only"
		? sub.where(`${table}.${column}`, "is not", null)
		: sub.where(`${table}.${column}`, "is", null);
}

/** Qualifies unqualified predicate columns with the subquery's table. */
function qualifyEntries(
	entries: readonly WhereEntry[],
	table: string,
): WhereEntry[] {
	return entries.map((entry) => ({
		boolean: entry.boolean,
		predicate: qualifyPredicate(entry.predicate, table),
	}));
}

function qualifyPredicate(predicate: Predicate, table: string): Predicate {
	const qualify = (column: string) =>
		column.includes(".") ? column : `${table}.${column}`;
	switch (predicate.kind) {
		case "basic":
			return { ...predicate, column: qualify(predicate.column) };
		case "in":
			return { ...predicate, column: qualify(predicate.column) };
		case "null":
			return { ...predicate, column: qualify(predicate.column) };
		case "between":
			return { ...predicate, column: qualify(predicate.column) };
		case "group":
			return {
				kind: "group",
				entries: qualifyEntries(predicate.entries, table),
			};
		case "negate":
			return {
				kind: "negate",
				entries: qualifyEntries(predicate.entries, table),
			};
		case "raw":
		case "custom":
			return predicate;
	}
}

/** Applies a where-callback list inside a subquery. */
function applyEntries(
	sub: AnyBuilder,
	entries: readonly WhereEntry[],
	dialect: DialectKind,
	table?: string,
): AnyBuilder {
	if (entries.length === 0) return sub;
	const prepared =
		table === undefined ? entries : qualifyEntries(entries, table);
	return sub.where(
		(eb: AnyBuilder) =>
			foldEntries(eb, prepared, dialect) ?? trueExpression(eb),
	);
}

/**
 * Builds the FROM/WHERE part of a single-relation subquery, correlated to
 * `ownerTable`. `extra` runs after the correlation and soft-delete scope, so
 * callers can add constraints (or chain another EXISTS).
 */
function relationSubquery<Sc extends Schema>(
	orm: Orm<Sc>,
	eb: AnyBuilder,
	ownerTable: string,
	ownerClass: unknown,
	descriptor: AnyRelationDescriptor,
	relation: string,
	softMode: SoftDeleteMode,
	extra?: (sub: AnyBuilder) => AnyBuilder,
): AnyBuilder {
	const finish = (sub: AnyBuilder): AnyBuilder =>
		extra === undefined ? sub : extra(sub);
	switch (descriptor.kind) {
		case "hasMany":
		case "hasOne": {
			const relatedClass = descriptor.related?.();
			const relatedTable = (relatedClass as { __table: string }).__table;
			const foreignKey = requireKey(
				descriptor.foreignKey,
				descriptor.kind,
				relation,
			);
			let sub = eb
				.selectFrom(relatedTable)
				.whereRef(
					`${relatedTable}.${foreignKey}`,
					"=",
					`${ownerTable}.${descriptor.localKey ?? "id"}`,
				);
			sub = applySoftScope(orm, sub, relatedClass, softMode, relatedTable);
			const ofMany =
				descriptor.kind === "hasOne" ? descriptor.ofMany : undefined;
			if (ofMany !== undefined) {
				const relatedMeta = orm.internalMeta(relatedTable as never);
				if (!Object.hasOwn(relatedMeta.columns, ofMany.column)) {
					throw new InvalidQueryError(
						`Relation "${relation}": ofMany column "${ofMany.column}" does not exist on "${relatedTable}".`,
					);
				}
				const softColumn = softDeleteColumnOf(orm, relatedClass);
				sub = sub.where(
					rawToKysely(
						ofManyPredicateSql(orm.dialectKind, {
							table: relatedTable,
							column: ofMany.column,
							aggregate: ofMany.aggregate,
							foreignKey,
							correlate: {
								kind: "ref",
								table: ownerTable,
								column: descriptor.localKey ?? "id",
							},
							soft:
								softColumn === null
									? undefined
									: { column: softColumn, mode: softMode },
						}),
					),
				);
			}
			return finish(sub);
		}
		case "belongsTo": {
			const relatedClass = descriptor.related?.();
			const relatedTable = (relatedClass as { __table: string }).__table;
			const foreignKey = requireKey(
				descriptor.foreignKey,
				descriptor.kind,
				relation,
			);
			const ownerKey =
				descriptor.ownerKey ??
				orm.internalMeta(relatedTable as never).primaryKey ??
				"id";
			let sub = eb
				.selectFrom(relatedTable)
				.whereRef(
					`${relatedTable}.${ownerKey}`,
					"=",
					`${ownerTable}.${foreignKey}`,
				);
			sub = applySoftScope(orm, sub, relatedClass, softMode, relatedTable);
			return finish(sub);
		}
		case "morphMany":
		case "morphOne": {
			const relatedClass = descriptor.related?.();
			const relatedTable = (relatedClass as { __table: string }).__table;
			const { idColumn, typeColumn } = morphColumnsOf(descriptor, relation);
			let sub = eb
				.selectFrom(relatedTable)
				.whereRef(
					`${relatedTable}.${idColumn}`,
					"=",
					`${ownerTable}.${descriptor.localKey ?? "id"}`,
				)
				.where(
					`${relatedTable}.${typeColumn}`,
					"=",
					orm.morphAlias(ownerClass),
				);
			sub = applySoftScope(orm, sub, relatedClass, softMode, relatedTable);
			return finish(sub);
		}
		case "belongsToMany": {
			const relatedClass = descriptor.related?.();
			const relatedTable = (relatedClass as { __table: string }).__table;
			const pivot = descriptor.through;
			if (typeof pivot !== "string") {
				throw new InvalidQueryError(
					`Relation "${relation}" (belongsToMany) needs a pivot table name.`,
				);
			}
			const relatedPk = orm.internalMeta(relatedTable as never).primaryKey;
			if (relatedPk === null) {
				throw new InvalidQueryError(
					`Relation "${relation}": table "${relatedTable}" needs a primary key for belongsToMany.`,
				);
			}
			const foreignPivotKey = requireKey(
				descriptor.foreignPivotKey,
				"belongsToMany",
				relation,
			);
			const relatedPivotKey = requireKey(
				descriptor.relatedPivotKey,
				"belongsToMany",
				relation,
			);
			let sub = eb
				.selectFrom(relatedTable)
				.innerJoin(pivot, (builder: AnyBuilder) =>
					builder.onRef(
						`${pivot}.${relatedPivotKey}`,
						"=",
						`${relatedTable}.${relatedPk}`,
					),
				)
				.whereRef(
					`${pivot}.${foreignPivotKey}`,
					"=",
					`${ownerTable}.${descriptor.localKey ?? "id"}`,
				);
			sub = applySoftScope(orm, sub, relatedClass, softMode, relatedTable);
			return finish(sub);
		}
		case "morphToMany": {
			const relatedClass = descriptor.related?.();
			const relatedTable = (relatedClass as { __table: string }).__table;
			const pivot = descriptor.through;
			if (typeof pivot !== "string") {
				throw new InvalidQueryError(
					`Relation "${relation}" (morphToMany) needs a pivot table name.`,
				);
			}
			const relatedPk = orm.internalMeta(relatedTable as never).primaryKey;
			if (relatedPk === null) {
				throw new InvalidQueryError(
					`Relation "${relation}": table "${relatedTable}" needs a primary key for morphToMany.`,
				);
			}
			const foreignPivotKey = requireKey(
				descriptor.foreignPivotKey,
				"morphToMany",
				relation,
			);
			const relatedPivotKey = requireKey(
				descriptor.relatedPivotKey,
				"morphToMany",
				relation,
			);
			const morphName = descriptor.morphName;
			if (morphName === undefined) {
				throw new InvalidQueryError(
					`Relation "${relation}": morphToMany needs a morph name.`,
				);
			}
			let sub = eb
				.selectFrom(relatedTable)
				.innerJoin(pivot, (builder: AnyBuilder) =>
					builder.onRef(
						`${pivot}.${relatedPivotKey}`,
						"=",
						`${relatedTable}.${relatedPk}`,
					),
				)
				.whereRef(
					`${pivot}.${foreignPivotKey}`,
					"=",
					`${ownerTable}.${descriptor.localKey ?? "id"}`,
				)
				.where(
					`${pivot}.${morphName}Type`,
					"=",
					orm.morphAlias(
						descriptor.inverse === true ? relatedClass : ownerClass,
					),
				);
			sub = applySoftScope(orm, sub, relatedClass, softMode, relatedTable);
			return finish(sub);
		}
		case "hasManyThrough":
		case "hasOneThrough": {
			const relatedClass = descriptor.related?.();
			const relatedTable = (relatedClass as { __table: string }).__table;
			const throughThunk = descriptor.through;
			if (typeof throughThunk !== "function") {
				throw new InvalidQueryError(
					`Relation "${relation}" (${descriptor.kind}) needs a through model.`,
				);
			}
			const throughClass = throughThunk() as { __table: string };
			const throughTable = throughClass.__table;
			const throughMeta = orm.internalMeta(throughTable as never);
			const secondLocalKey =
				descriptor.secondLocalKey ?? throughMeta.primaryKey ?? "id";
			const firstKey = requireKey(
				descriptor.firstKey,
				descriptor.kind,
				relation,
			);
			const secondKey = requireKey(
				descriptor.secondKey,
				descriptor.kind,
				relation,
			);
			let sub = eb
				.selectFrom(relatedTable)
				.innerJoin(throughTable, (builder: AnyBuilder) =>
					builder.onRef(
						`${throughTable}.${secondLocalKey}`,
						"=",
						`${relatedTable}.${secondKey}`,
					),
				)
				.whereRef(
					`${throughTable}.${firstKey}`,
					"=",
					`${ownerTable}.${descriptor.localKey ?? "id"}`,
				);
			sub = applySoftScope(orm, sub, relatedClass, softMode, relatedTable);
			sub = applySoftScope(orm, sub, throughClass, softMode, throughTable);
			return finish(sub);
		}
		case "morphTo":
			throw new InvalidQueryError(
				`Relation "${relation}": morphTo cannot be used with withCount/withSum or nested whereHas. Query the concrete relations instead.`,
			);
	}
}

/** Compiles one EXISTS step of a (possibly nested) `whereHas` path. */
function relationExists<Sc extends Schema>(
	orm: Orm<Sc>,
	dialect: DialectKind,
	eb: AnyBuilder,
	ownerTable: string,
	ownerClass: unknown,
	steps: readonly RelationStep[],
	entries: readonly WhereEntry[],
	softMode: SoftDeleteMode,
	onlyMorphTypes?: readonly string[],
): unknown {
	const step = steps[0]!;
	const rest = steps.slice(1);
	if (step.descriptor.kind === "morphTo") {
		if (rest.length > 0) {
			throw new InvalidQueryError(
				`whereHas("${step.path}"): nested paths below morphTo are not supported.`,
			);
		}
		const { idColumn, typeColumn } = morphColumnsOf(step.descriptor, step.path);
		const types = step.descriptor.types?.();
		if (types === undefined) {
			throw new InvalidQueryError(
				`whereHas("${step.path}"): morphTo needs a types map.`,
			);
		}
		// The relation's types map first; global morph-map aliases extend it so
		// the predicate agrees with `orm.morphAlias()` on the write side.
		const aliasEntries: Array<[string, { __table: string }]> = Object.entries(
			types,
		) as Array<[string, { __table: string }]>;
		const seenAliases = new Set(aliasEntries.map(([alias]) => alias));
		for (const [alias, modelClass] of orm.morphMapEntries()) {
			if (seenAliases.has(alias)) continue;
			aliasEntries.push([alias, modelClass]);
		}
		const alternatives: unknown[] = [];
		for (const [alias, modelClass] of aliasEntries) {
			if (onlyMorphTypes !== undefined && !onlyMorphTypes.includes(alias)) {
				continue;
			}
			const relatedTable = (modelClass as { __table: string }).__table;
			const ownerKey =
				step.descriptor.ownerKey ??
				orm.internalMeta(relatedTable as never).primaryKey ??
				"id";
			let sub = eb
				.selectFrom(relatedTable)
				.select(sql`1`.as("one"))
				.whereRef(
					`${relatedTable}.${ownerKey}`,
					"=",
					`${ownerTable}.${idColumn}`,
				);
			sub = applySoftScope(orm, sub, modelClass, softMode, relatedTable);
			sub = applyEntries(sub, entries, dialect, relatedTable);
			alternatives.push(
				eb.and([
					eb(eb.ref(`${ownerTable}.${typeColumn}`), "=", alias),
					eb.exists(sub),
				]),
			);
		}
		if (alternatives.length === 0) {
			return eb(eb.val(1), "=", eb.val(0));
		}
		return alternatives.length === 1 ? alternatives[0] : eb.or(alternatives);
	}
	const relatedTable = step.relatedTable;
	const extra =
		rest.length === 0
			? (sub: AnyBuilder) => applyEntries(sub, entries, dialect, relatedTable)
			: (sub: AnyBuilder) =>
					sub.where((eb2: AnyBuilder) =>
						relationExists(
							orm,
							dialect,
							eb2,
							relatedTable,
							step.relatedClass,
							rest,
							entries,
							softMode,
						),
					);
	const sub = relationSubquery(
		orm,
		eb,
		ownerTable,
		ownerClass,
		step.descriptor,
		step.path,
		softMode,
		extra,
	);
	return eb.exists(sub.select(sql`1`.as("one")));
}

interface RelationStep {
	readonly path: string;
	readonly descriptor: AnyRelationDescriptor;
	readonly ownerClass: unknown;
	readonly ownerTable: string;
	readonly relatedClass: unknown;
	readonly relatedTable: string;
}

/**
 * The query builder. Use `orm.table(name)` for the lightweight row path or
 * `Model.query()` for the model path.
 */
export class QueryBuilder<
	S extends Schema,
	T extends TableName<S>,
	M = undefined,
	Loaded = unknown,
	Sel extends ColumnNameOf<S, T> | null = null,
	J extends TableName<S> = never,
> implements WhereGroup<S, T, J>
{
	/** @internal */ readonly orm: Orm<S>;
	/** @internal */ readonly state: BuilderState;
	/** @internal */ readonly modelClass: M | undefined;
	/** @internal */ readonly tableName: T;
	/**
	 * Tables of an enclosing query that correlated subqueries may reference
	 * through `whereColumn` (see `whereExists` / `selectSub`).
	 */
	#outerTables: string[] = [];

	/** @internal */
	constructor(
		orm: Orm<S>,
		table: T,
		modelClass?: M,
		options: {
			readonly skipGlobalScopes?: boolean;
			readonly exceptGlobalScopes?: readonly string[];
		} = {},
	) {
		this.orm = orm;
		this.tableName = table;
		this.state = emptyState();
		this.modelClass = modelClass;
		// Table existence is validated eagerly.
		this.orm.internalMeta(table);
		if (!options.skipGlobalScopes) {
			const scopes = (
				modelClass as
					| { globalScopes?: Record<string, (query: unknown) => void> }
					| undefined
			)?.globalScopes;
			if (scopes !== undefined) {
				const except = new Set(options.exceptGlobalScopes ?? []);
				for (const [name, scope] of Object.entries(scopes)) {
					if (except.has(name)) continue;
					scope(this as unknown);
				}
			}
		}
	}

	/** Soft-delete column when the bound model declares `softDeletes`. */
	#softDeleteColumn(): string | null {
		return softDeleteColumnOf(this.orm, this.modelClass);
	}

	#requireSoftModel(method: string): string {
		const column = this.#softDeleteColumn();
		if (column === null) {
			throw new InvalidQueryError(
				`${method}() is only available on models with "static softDeletes = true". Table "${this.tableName}" does not use soft deletes.`,
			);
		}
		return column;
	}

	/** Includes soft-deleted rows (Eloquent `withTrashed()`). */
	withTrashed(): this {
		this.#requireSoftModel("withTrashed");
		this.state.softDeleteMode = "with";
		return this;
	}

	/** Restricts the query to soft-deleted rows (Eloquent `onlyTrashed()`). */
	onlyTrashed(): this {
		this.#requireSoftModel("onlyTrashed");
		this.state.softDeleteMode = "only";
		return this;
	}

	/** Retag the current instance with different type parameters. @internal */
	#ret<
		NewM,
		NewLoaded,
		NewSel extends ColumnNameOf<S, T> | null,
		NewJ extends TableName<S>,
	>(): QueryBuilder<S, T, NewM, NewLoaded, NewSel, NewJ> {
		return this as unknown as QueryBuilder<S, T, NewM, NewLoaded, NewSel, NewJ>;
	}

	#assertColumn(column: string, extraTables: readonly string[] = []): void {
		const qualified = column.includes(".");
		const table = qualified ? column.split(".")[0]! : this.tableName;
		const known =
			table === this.tableName ||
			extraTables.includes(table) ||
			this.#outerTables.includes(table) ||
			this.state.joins.some((join) => join.table === table);
		if (!known) {
			throw new InvalidQueryError(
				`Reference "${column}": table "${table}" is not part of this query. Join it first.`,
			);
		}
		const columns = this.orm.schema[table] as ColumnMap | undefined;
		if (!columns) {
			throw new InvalidQueryError(`Unknown table "${table}".`);
		}
		const name = qualified ? column.split(".").slice(1).join(".") : column;
		if (!Object.hasOwn(columns, name)) {
			throw new InvalidQueryError(
				`Unknown column "${name}" on table "${table}". Known columns: ${Object.keys(columns).join(", ")}.`,
			);
		}
	}

	#pushWhere(boolean: "and" | "or", predicate: Predicate): this {
		this.state.wheres.push({ boolean, predicate });
		return this;
	}

	#whereCallback(
		boolean: "and" | "or",
		negate: boolean,
		callback: (group: WhereGroup<S, T, J>) => void,
	): this {
		const child = new QueryBuilder<S, T, undefined, unknown, null, J>(
			this.orm,
			this.tableName,
			this.modelClass as undefined,
		);
		child.#outerTables = [...this.#outerTables];
		callback(child);
		if (child.state.wheres.length === 0) return this;
		return this.#pushWhere(boolean, {
			kind: negate ? "negate" : "group",
			entries: child.state.wheres,
		});
	}

	#basicWhere(
		boolean: "and" | "or",
		column: string,
		operatorOrValue: unknown,
		value: unknown,
		hasOperator: boolean,
	): this {
		this.#assertColumn(column);
		if (!hasOperator) {
			// Two-argument form: the third parameter *is* the value.
			// `where(col, null)` / `where(col, undefined)` follow Laravel and
			// compile to `is null` instead of `= null`.
			if (operatorOrValue === null || operatorOrValue === undefined) {
				return this.#pushWhere(boolean, { kind: "null", column, not: false });
			}
			return this.#pushWhere(boolean, {
				kind: "basic",
				column,
				operator: "=",
				value: operatorOrValue,
			});
		}
		if (value === null) {
			if (operatorOrValue === "=" || operatorOrValue === "==") {
				return this.#pushWhere(boolean, { kind: "null", column, not: false });
			}
			if (operatorOrValue === "!=" || operatorOrValue === "<>") {
				return this.#pushWhere(boolean, { kind: "null", column, not: true });
			}
			throw new InvalidQueryError(
				`where(${JSON.stringify(column)}, ${JSON.stringify(operatorOrValue)}, null) is not valid SQL. Use whereNull()/whereNotNull().`,
			);
		}
		return this.#pushWhere(boolean, {
			kind: "basic",
			column,
			operator: String(operatorOrValue),
			value,
		});
	}

	// -----------------------------------------------------------------------
	// where family
	// -----------------------------------------------------------------------

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
	where(
		columnOrCallback: string | ((group: WhereGroup<S, T, J>) => void),
		operatorOrValue?: unknown,
		value?: unknown,
	): this {
		if (typeof columnOrCallback === "function") {
			return this.#whereCallback("and", false, columnOrCallback);
		}
		return this.#basicWhere(
			"and",
			columnOrCallback,
			operatorOrValue as string,
			value,
			// biome-ignore lint/complexity/noArguments: the 2-argument overload (`where(col, value)`) is distinguished from the 3-argument one at runtime; a rest parameter would erase the typed overloads.
			arguments.length >= 3,
		);
	}

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
	orWhere(
		columnOrCallback: string | ((group: WhereGroup<S, T, J>) => void),
		operatorOrValue?: unknown,
		value?: unknown,
	): this {
		if (typeof columnOrCallback === "function") {
			return this.#whereCallback("or", false, columnOrCallback);
		}
		return this.#basicWhere(
			"or",
			columnOrCallback,
			operatorOrValue as string,
			value,
			// biome-ignore lint/complexity/noArguments: same overload dispatch as `where`.
			arguments.length >= 3,
		);
	}

	whereNot(callback: (group: WhereGroup<S, T, J>) => void): this {
		return this.#whereCallback("and", true, callback);
	}

	/** `OR` variant of `whereNot` — negates the group and links with `or`. */
	orWhereNot(callback: (group: WhereGroup<S, T, J>) => void): this {
		return this.#whereCallback("or", true, callback);
	}

	whereIn<R extends ColumnRef<S, T, J>>(
		column: R,
		values: ReadonlyArray<RefFilterValue<S, T, R>>,
	): this {
		this.#assertColumn(column);
		if (!Array.isArray(values)) {
			throw new InvalidQueryError(
				`whereIn(${JSON.stringify(column)}): values must be an array.`,
			);
		}
		return this.#pushWhere("and", { kind: "in", column, values, not: false });
	}

	whereNotIn<R extends ColumnRef<S, T, J>>(
		column: R,
		values: ReadonlyArray<RefFilterValue<S, T, R>>,
	): this {
		this.#assertColumn(column);
		if (!Array.isArray(values)) {
			throw new InvalidQueryError(
				`whereNotIn(${JSON.stringify(column)}): values must be an array.`,
			);
		}
		return this.#pushWhere("and", { kind: "in", column, values, not: true });
	}

	/** Renders a validated list of safe integers as SQL literals. */
	#integerLiterals(values: readonly unknown[], caller: string): string {
		if (!Array.isArray(values)) {
			throw new InvalidQueryError(`${caller}(): values must be an array.`);
		}
		return values
			.map((value) => {
				if (typeof value === "bigint") return value.toString();
				if (typeof value === "number" && Number.isSafeInteger(value)) {
					return String(value);
				}
				throw new InvalidQueryError(
					`${caller}(): every value must be a safe integer or bigint, got ${typeof value} ${String(value)}.`,
				);
			})
			.join(", ");
	}

	#quotedColumnRef(column: string): string {
		return quoteReference(column, this.orm.dialectKind);
	}

	/**
	 * `whereIntegerInRaw("id", [1, 2, 3])` — inlines validated integers so the
	 * statement carries no bindings (useful past driver placeholder limits).
	 * Values are safe integers or bigints; everything else is rejected.
	 */
	whereIntegerInRaw<R extends ColumnRef<S, T, J>>(
		column: R,
		values: ReadonlyArray<number | bigint>,
	): this {
		this.#assertColumn(column);
		if (values.length === 0) {
			return this.#pushWhere("and", {
				kind: "raw",
				expression: raw("1 = 0"),
			});
		}
		const list = this.#integerLiterals(values, "whereIntegerInRaw");
		return this.#pushWhere("and", {
			kind: "raw",
			expression: raw(`${this.#quotedColumnRef(column)} in (${list})`),
		});
	}

	/** `NOT IN` counterpart of `whereIntegerInRaw`. */
	whereIntegerNotInRaw<R extends ColumnRef<S, T, J>>(
		column: R,
		values: ReadonlyArray<number | bigint>,
	): this {
		this.#assertColumn(column);
		if (values.length === 0) {
			return this.#pushWhere("and", {
				kind: "raw",
				expression: raw("1 = 1"),
			});
		}
		const list = this.#integerLiterals(values, "whereIntegerNotInRaw");
		return this.#pushWhere("and", {
			kind: "raw",
			expression: raw(`${this.#quotedColumnRef(column)} not in (${list})`),
		});
	}

	#whereExistsSub<TT extends TableName<S>>(
		table: TT,
		callback:
			| ((query: QueryBuilder<S, TT, undefined, unknown, null, J | T>) => void)
			| undefined,
	): AnyBuilder {
		const sub = new QueryBuilder<S, TT, undefined, unknown, null, J | T>(
			this.orm,
			table,
		);
		sub.#outerTables = [
			this.tableName as string,
			...this.state.joins.map((join) => join.table),
			...this.#outerTables,
		];
		callback?.(sub as never);
		return sub;
	}

	/**
	 * Correlated `EXISTS` subquery. The callback receives a builder for
	 * `table` that also accepts this query's tables as column references, so
	 * correlations read naturally:
	 *
	 * ```ts
	 * User.query().whereExists("posts", (posts) =>
	 *   posts.whereColumn("posts.userId", "=", "users.id"),
	 * );
	 * ```
	 */
	whereExists<TT extends TableName<S>>(
		table: TT,
		callback?: (
			query: QueryBuilder<S, TT, undefined, unknown, null, J | T>,
		) => void,
	): this {
		return this.#pushExists(
			"and",
			false,
			this.#whereExistsSub(table, callback),
		);
	}

	/** `OR EXISTS` variant of `whereExists`. */
	orWhereExists<TT extends TableName<S>>(
		table: TT,
		callback?: (
			query: QueryBuilder<S, TT, undefined, unknown, null, J | T>,
		) => void,
	): this {
		return this.#pushExists("or", false, this.#whereExistsSub(table, callback));
	}

	/** `NOT EXISTS` counterpart of `whereExists`. */
	whereNotExists<TT extends TableName<S>>(
		table: TT,
		callback?: (
			query: QueryBuilder<S, TT, undefined, unknown, null, J | T>,
		) => void,
	): this {
		return this.#pushExists("and", true, this.#whereExistsSub(table, callback));
	}

	/** `OR NOT EXISTS` counterpart of `whereExists`. */
	orWhereNotExists<TT extends TableName<S>>(
		table: TT,
		callback?: (
			query: QueryBuilder<S, TT, undefined, unknown, null, J | T>,
		) => void,
	): this {
		return this.#pushExists("or", true, this.#whereExistsSub(table, callback));
	}

	#pushExists(
		boolean: "and" | "or",
		negated: boolean,
		sub: QueryBuilder<S, TableName<S>, unknown, unknown, null, never>,
	): this {
		const compiled = sub.#compileSelect();
		return this.#pushWhere(boolean, {
			kind: "custom",
			build: (eb: AnyBuilder) =>
				negated ? eb.not(eb.exists(compiled)) : eb.exists(compiled),
		});
	}

	/**
	 * Adds a scalar subquery to the select list under `alias` (Eloquent
	 * `selectSub`). The callback may correlate to this query's tables.
	 */
	selectSub<TT extends TableName<S>, const A extends string>(
		table: TT,
		alias: A,
		callback?: (
			query: QueryBuilder<S, TT, undefined, unknown, null, J | T>,
		) => void,
	): QueryBuilder<S, T, M, Loaded & { [K in A]: unknown }, Sel, J> {
		const sub = this.#whereExistsSub(table, callback);
		this.state.selectSubs.push({ alias, sub });
		return this.#ret<M, Loaded & { [K in A]: unknown }, Sel, J>();
	}

	#unionWith<
		TT extends TableName<S>,
		M2,
		L2,
		Sel2 extends ColumnNameOf<S, TT> | null,
		J2 extends TableName<S>,
	>(other: QueryBuilder<S, TT, M2, L2, Sel2, J2>, all: boolean): this {
		if ((other as { orm: object }).orm !== this.orm) {
			throw new InvalidQueryError(
				"union(): both queries must belong to the same Orm instance.",
			);
		}
		this.state.unions.push({ all, sub: other });
		return this;
	}

	/**
	 * Appends `UNION` of another query. Column lists must line up; the
	 * database enforces arity, the ORM cannot.
	 */
	union<
		TT extends TableName<S>,
		M2,
		L2,
		Sel2 extends ColumnNameOf<S, TT> | null,
		J2 extends TableName<S>,
	>(other: QueryBuilder<S, TT, M2, L2, Sel2, J2>): this {
		return this.#unionWith(other, false);
	}

	/** Appends `UNION ALL` of another query. */
	unionAll<
		TT extends TableName<S>,
		M2,
		L2,
		Sel2 extends ColumnNameOf<S, TT> | null,
		J2 extends TableName<S>,
	>(other: QueryBuilder<S, TT, M2, L2, Sel2, J2>): this {
		return this.#unionWith(other, true);
	}

	whereNull(column: ColumnRef<S, T, J>): this {
		this.#assertColumn(column);
		return this.#pushWhere("and", { kind: "null", column, not: false });
	}

	whereNotNull(column: ColumnRef<S, T, J>): this {
		this.#assertColumn(column);
		return this.#pushWhere("and", { kind: "null", column, not: true });
	}

	whereBetween<R extends ColumnRef<S, T, J>>(
		column: R,
		range: readonly [RefFilterValue<S, T, R>, RefFilterValue<S, T, R>],
	): this {
		this.#assertColumn(column);
		if (!Array.isArray(range) || range.length !== 2) {
			throw new InvalidQueryError(
				`whereBetween(${JSON.stringify(column)}): range must be a [min, max] tuple.`,
			);
		}
		return this.#pushWhere("and", {
			kind: "between",
			column,
			range: [range[0], range[1]],
			not: false,
		});
	}

	/** `NOT BETWEEN` counterpart of `whereBetween`. */
	whereNotBetween<R extends ColumnRef<S, T, J>>(
		column: R,
		range: readonly [RefFilterValue<S, T, R>, RefFilterValue<S, T, R>],
	): this {
		this.#assertColumn(column);
		if (!Array.isArray(range) || range.length !== 2) {
			throw new InvalidQueryError(
				`whereNotBetween(${JSON.stringify(column)}): range must be a [min, max] tuple.`,
			);
		}
		return this.#pushWhere("and", {
			kind: "between",
			column,
			range: [range[0], range[1]],
			not: true,
		});
	}

	/** `OR` variant of `whereNotBetween`. */
	orWhereNotBetween<R extends ColumnRef<S, T, J>>(
		column: R,
		range: readonly [RefFilterValue<S, T, R>, RefFilterValue<S, T, R>],
	): this {
		this.#assertColumn(column);
		if (!Array.isArray(range) || range.length !== 2) {
			throw new InvalidQueryError(
				`orWhereNotBetween(${JSON.stringify(column)}): range must be a [min, max] tuple.`,
			);
		}
		return this.#pushWhere("or", {
			kind: "between",
			column,
			range: [range[0], range[1]],
			not: true,
		});
	}

	whereRaw(
		expression: RawExpression | string,
		parameters?: readonly unknown[],
	): this {
		const value =
			typeof expression === "string"
				? raw(expression, parameters ?? [])
				: expression;
		return this.#pushWhere("and", { kind: "raw", expression: value });
	}

	/** Compares two columns (`where("posts.userId", "=", "users.id")`). */
	whereColumn(
		left: ColumnRef<S, T, J>,
		operator: ComparisonOperator,
		right: ColumnRef<S, T, J>,
	): this {
		this.#assertColumn(left);
		this.#assertColumn(right);
		if (!KNOWN_JOIN_OPERATORS.has(operator)) {
			throw new InvalidQueryError(
				`whereColumn(): unsupported operator ${JSON.stringify(operator)}.`,
			);
		}
		return this.#pushWhere("and", {
			kind: "custom",
			build: (eb) =>
				eb(
					eb.ref(left),
					(operator === "==" ? "=" : operator) as never,
					eb.ref(right),
				),
		});
	}

	/** Matches when any of `columns` satisfies the comparison. */
	whereAny<R extends ColumnRef<S, T, J>>(
		columns: readonly R[],
		operator: ComparisonOperator | "like" | "not like" | "ilike",
		value: RefFilterValue<S, T, R>,
	): this {
		if (columns.length === 0) {
			throw new InvalidQueryError(
				"whereAny(): at least one column is required.",
			);
		}
		return this.where((group) => {
			columns.forEach((column, index) => {
				if (index === 0) group.where(column, operator as never, value as never);
				else group.orWhere(column, operator as never, value as never);
			});
		});
	}

	/** Matches when every one of `columns` satisfies the comparison. */
	whereAll<R extends ColumnRef<S, T, J>>(
		columns: readonly R[],
		operator: ComparisonOperator | "like" | "not like" | "ilike",
		value: RefFilterValue<S, T, R>,
	): this {
		if (columns.length === 0) {
			throw new InvalidQueryError(
				"whereAll(): at least one column is required.",
			);
		}
		return this.where((group) => {
			for (const column of columns) {
				group.where(column, operator as never, value as never);
			}
		});
	}

	/** Matches when none of `columns` satisfies the comparison. */
	whereNone<R extends ColumnRef<S, T, J>>(
		columns: readonly R[],
		operator: ComparisonOperator | "like" | "not like" | "ilike",
		value: RefFilterValue<S, T, R>,
	): this {
		if (columns.length === 0) return this;
		return this.whereNot((group) => {
			columns.forEach((column, index) => {
				if (index === 0) group.where(column, operator as never, value as never);
				else group.orWhere(column, operator as never, value as never);
			});
		});
	}

	#dateExpression(
		part: "date" | "time" | "day" | "month" | "year",
		column: string,
	): ReturnType<typeof sql> {
		const dialect = this.orm.dialectKind;
		if (part === "date") {
			return dialect === "postgres"
				? sql`(${sql.ref(column)})::date`
				: sql`date(${sql.ref(column)})`;
		}
		if (part === "time") {
			return dialect === "postgres"
				? sql`(${sql.ref(column)})::time`
				: sql`time(${sql.ref(column)})`;
		}
		const format = part === "day" ? "%d" : part === "month" ? "%m" : "%Y";
		if (dialect === "sqlite") {
			return sql`cast(strftime(${format}, ${sql.ref(column)}) as integer)`;
		}
		if (dialect === "mysql") {
			const fn = part === "day" ? "day" : part === "month" ? "month" : "year";
			return sql`${sql.raw(fn)}(${sql.ref(column)})`;
		}
		return sql`cast(extract(${sql.raw(part)} from ${sql.ref(column)}) as integer)`;
	}

	#dateValue(
		part: "date" | "time" | "day" | "month" | "year",
		value: unknown,
	): unknown {
		if (part === "date" && value instanceof Date) {
			return value.toISOString().slice(0, 10);
		}
		if (part === "time" && value instanceof Date) {
			return value.toISOString().slice(11, 19);
		}
		return value;
	}

	#dateWhere(
		part: "date" | "time" | "day" | "month" | "year",
		column: ColumnRef<S, T, J>,
		operator: ComparisonOperator,
		value: unknown,
	): this {
		this.#assertColumn(column);
		if (!KNOWN_JOIN_OPERATORS.has(operator)) {
			throw new InvalidQueryError(
				`where${part.charAt(0).toUpperCase()}${part.slice(1)}(): unsupported operator ${JSON.stringify(operator)}.`,
			);
		}
		const expression = this.#dateExpression(part, column);
		const normalized = this.#dateValue(part, value);
		return this.#pushWhere("and", {
			kind: "custom",
			build: (eb) =>
				eb(
					expression as never,
					(operator === "==" ? "=" : operator) as never,
					normalized as never,
				),
		});
	}

	/** Compares the date part of a column. */
	whereDate(
		column: ColumnRef<S, T, J>,
		operator: ComparisonOperator,
		value: Date | string | number,
	): this {
		return this.#dateWhere("date", column, operator, value);
	}

	/** Compares the time part of a column. */
	whereTime(
		column: ColumnRef<S, T, J>,
		operator: ComparisonOperator,
		value: string | number,
	): this {
		return this.#dateWhere("time", column, operator, value);
	}

	whereDay(
		column: ColumnRef<S, T, J>,
		operator: ComparisonOperator,
		value: number,
	): this {
		return this.#dateWhere("day", column, operator, value);
	}

	whereMonth(
		column: ColumnRef<S, T, J>,
		operator: ComparisonOperator,
		value: number,
	): this {
		return this.#dateWhere("month", column, operator, value);
	}

	whereYear(
		column: ColumnRef<S, T, J>,
		operator: ComparisonOperator,
		value: number,
	): this {
		return this.#dateWhere("year", column, operator, value);
	}

	/** JSON containment (`@>`, `JSON_CONTAINS`, SQLite `json_each`). */
	whereJsonContains(column: ColumnRef<S, T, J>, value: unknown): this {
		this.#assertColumn(column);
		const dialect = this.orm.dialectKind;
		return this.#pushWhere("and", {
			kind: "custom",
			build: () => {
				if (dialect === "mysql") {
					return sql`json_contains(${sql.ref(column)}, ${JSON.stringify(value)})`;
				}
				if (dialect === "postgres") {
					return sql`(${sql.ref(column)})::jsonb @> ${JSON.stringify(value)}::jsonb`;
				}
				if (Array.isArray(value)) {
					return sql`not exists (select 1 from json_each(${JSON.stringify(value)}) as expected where expected.value not in (select value from json_each(${sql.ref(column)})))`;
				}
				if (value !== null && typeof value === "object") {
					return sql`not exists (select 1 from json_each(${JSON.stringify(value)}) as expected where json_extract(${sql.ref(column)}, '$.' || expected.key) is not expected.value)`;
				}
				return sql`exists (select 1 from json_each(${sql.ref(column)}) where json_each.value = ${value})`;
			},
		});
	}

	/** Compares the array length of a JSON column. */
	whereJsonLength(
		column: ColumnRef<S, T, J>,
		operator: ComparisonOperator,
		length: number,
	): this {
		this.#assertColumn(column);
		if (!KNOWN_JOIN_OPERATORS.has(operator)) {
			throw new InvalidQueryError(
				`whereJsonLength(): unsupported operator ${JSON.stringify(operator)}.`,
			);
		}
		const dialect = this.orm.dialectKind;
		const expression =
			dialect === "mysql"
				? sql`json_length(${sql.ref(column)})`
				: dialect === "postgres"
					? sql`jsonb_array_length((${sql.ref(column)})::jsonb)`
					: sql`json_array_length(${sql.ref(column)})`;
		return this.#pushWhere("and", {
			kind: "custom",
			build: (eb) =>
				eb(
					expression as never,
					(operator === "==" ? "=" : operator) as never,
					length as never,
				),
		});
	}

	// -----------------------------------------------------------------------
	// joins / ordering / grouping
	// -----------------------------------------------------------------------

	join<JT extends TableName<S>>(
		table: JT,
		left: ColumnRef<S, T, J>,
		operator: ComparisonOperator,
		right: `${JT}.${ColumnNameOf<S, JT>}`,
	): QueryBuilder<S, T, M, Loaded, Sel, J | JT> {
		return this.#join("inner", table, left, operator, right);
	}

	innerJoin<JT extends TableName<S>>(
		table: JT,
		left: ColumnRef<S, T, J>,
		operator: ComparisonOperator,
		right: `${JT}.${ColumnNameOf<S, JT>}`,
	): QueryBuilder<S, T, M, Loaded, Sel, J | JT> {
		return this.#join("inner", table, left, operator, right);
	}

	leftJoin<JT extends TableName<S>>(
		table: JT,
		left: ColumnRef<S, T, J>,
		operator: ComparisonOperator,
		right: `${JT}.${ColumnNameOf<S, JT>}`,
	): QueryBuilder<S, T, M, Loaded, Sel, J | JT> {
		return this.#join("left", table, left, operator, right);
	}

	rightJoin<JT extends TableName<S>>(
		table: JT,
		left: ColumnRef<S, T, J>,
		operator: ComparisonOperator,
		right: `${JT}.${ColumnNameOf<S, JT>}`,
	): QueryBuilder<S, T, M, Loaded, Sel, J | JT> {
		return this.#join("right", table, left, operator, right);
	}

	#join<JT extends TableName<S>>(
		type: JoinType,
		table: JT,
		left: string,
		operator: string,
		right: string,
	): QueryBuilder<S, T, M, Loaded, Sel, J | JT> {
		if (!Object.hasOwn(this.orm.schema, table)) {
			throw new InvalidQueryError(`join(): unknown table "${table}".`);
		}
		if (!KNOWN_JOIN_OPERATORS.has(operator)) {
			throw new InvalidQueryError(
				`join(): unsupported operator ${JSON.stringify(operator)}.`,
			);
		}
		this.#assertColumn(left);
		this.#assertColumn(right, [table]);
		this.state.joins.push({
			type,
			table: table as string,
			left,
			operator,
			right,
		});
		return this.#ret<M, Loaded, Sel, J | JT>();
	}

	orderBy<R extends ColumnRef<S, T, J>>(
		column: R,
		direction: "asc" | "desc" = "asc",
	): this {
		if (direction !== "asc" && direction !== "desc") {
			throw new InvalidQueryError(
				`orderBy(): direction must be "asc" or "desc", got ${JSON.stringify(direction)}.`,
			);
		}
		this.#assertColumn(column);
		this.state.orders.push({ column, direction });
		return this;
	}

	orderByDesc<R extends ColumnRef<S, T, J>>(column: R): this {
		return this.orderBy(column, "desc");
	}

	groupBy<R extends ColumnRef<S, T, J>>(...columns: R[]): this {
		for (const column of columns) {
			this.#assertColumn(column);
			this.state.groups.push(column);
		}
		return this;
	}

	/** Adds a raw ORDER BY expression. */
	orderByRaw(
		expression: RawExpression | string,
		parameters?: readonly unknown[],
	): this {
		this.state.ordersRaw.push({
			expression:
				typeof expression === "string"
					? raw(expression, parameters ?? [])
					: expression,
		});
		return this;
	}

	/** Adds a raw GROUP BY expression. */
	groupByRaw(
		expression: RawExpression | string,
		parameters?: readonly unknown[],
	): this {
		this.state.groupsRaw.push({
			expression:
				typeof expression === "string"
					? raw(expression, parameters ?? [])
					: expression,
		});
		return this;
	}

	/** Adds a raw SELECT expression (`alias` keeps the result typed). */
	selectRaw<Row extends Record<string, unknown> = Record<string, unknown>>(
		expression: RawExpression | string,
		alias?: string,
		parameters?: readonly unknown[],
	): QueryBuilder<S, T, M, Loaded & Row, Sel, J> {
		this.state.selectRaw.push({
			expression:
				typeof expression === "string"
					? raw(expression, parameters ?? [])
					: expression,
			alias,
		});
		return this.#ret<M, Loaded & Row, Sel, J>();
	}

	/** Convenience: order by `createdAt` descending. */
	latest(column: ColumnRef<S, T, J> = "createdAt" as never): this {
		return this.orderBy(column, "desc");
	}

	/** Convenience: order by `createdAt` ascending. */
	oldest(column: ColumnRef<S, T, J> = "createdAt" as never): this {
		return this.orderBy(column, "asc");
	}

	/**
	 * Orders rows randomly (`rand()` on MySQL, `random()` on PostgreSQL and
	 * SQLite). Seedable random ordering is not portable and not provided.
	 */
	inRandomOrder(): this {
		return this.orderByRaw(
			this.orm.dialectKind === "mysql" ? "rand()" : "random()",
		);
	}

	/** Removes every existing order (optionally adds a new one). */
	reorder(
		column?: ColumnRef<S, T, J>,
		direction: "asc" | "desc" = "asc",
	): this {
		this.state.orders = [];
		this.state.ordersRaw = [];
		return column === undefined ? this : this.orderBy(column, direction);
	}

	/** Adds `FOR UPDATE` on MySQL/PostgreSQL (no-op on SQLite). */
	lockForUpdate(): this {
		this.state.lock = "update";
		return this;
	}

	/** Adds `FOR SHARE` on MySQL/PostgreSQL (no-op on SQLite). */
	sharedLock(): this {
		this.state.lock = "share";
		return this;
	}

	having(
		column: ColumnRef<S, T, J>,
		operator: ComparisonOperator | "like" | "not like" | "ilike",
		value: unknown,
	): this {
		this.#assertColumn(column);
		this.state.havings.push({
			boolean: "and",
			predicate: { kind: "basic", column, operator, value },
		});
		return this;
	}

	havingRaw(
		expression: RawExpression | string,
		parameters?: readonly unknown[],
	): this {
		const value =
			typeof expression === "string"
				? raw(expression, parameters ?? [])
				: expression;
		this.state.havings.push({
			boolean: "and",
			predicate: { kind: "raw", expression: value },
		});
		return this;
	}

	limit(count: number): this {
		if (!Number.isInteger(count) || count < 0) {
			throw new InvalidQueryError(
				`limit(): expected a non-negative integer, got ${count}.`,
			);
		}
		this.state.limit = count;
		return this;
	}

	offset(count: number): this {
		if (!Number.isInteger(count) || count < 0) {
			throw new InvalidQueryError(
				`offset(): expected a non-negative integer, got ${count}.`,
			);
		}
		this.state.offset = count;
		return this;
	}

	distinct(): this {
		this.state.distinct = true;
		return this;
	}

	// -----------------------------------------------------------------------
	// select
	// -----------------------------------------------------------------------

	select<C extends ColumnNameOf<S, T>>(
		...columns: C[]
	): QueryBuilder<S, T, M, Loaded, C, J> {
		if (columns.length === 0) {
			throw new InvalidQueryError("select(): at least one column is required.");
		}
		for (const column of columns) {
			if (column.includes(".")) {
				throw new InvalidQueryError(
					`select(${JSON.stringify(column)}): qualified columns are not supported. Select base-table columns and use with()/whereHas() for related data.`,
				);
			}
			this.#assertColumn(column);
		}
		this.state.selected = [...columns];
		return this.#ret<M, Loaded, C, J>();
	}

	addSelect<C extends ColumnNameOf<S, T>>(
		...columns: C[]
	): QueryBuilder<S, T, M, Loaded, Exclude<Sel, null> | C, J> {
		if (columns.length === 0) {
			throw new InvalidQueryError(
				"addSelect(): at least one column is required.",
			);
		}
		for (const column of columns) {
			if (column.includes(".")) {
				throw new InvalidQueryError(
					`addSelect(${JSON.stringify(column)}): qualified columns are not supported.`,
				);
			}
			this.#assertColumn(column);
		}
		this.state.selected = [...(this.state.selected ?? []), ...columns];
		return this.#ret<M, Loaded, Exclude<Sel, null> | C, J>();
	}

	// -----------------------------------------------------------------------
	// conditional composition / cloning
	// -----------------------------------------------------------------------

	when(
		condition: boolean,
		callback: (query: this) => void,
		fallback?: (query: this) => void,
	): this {
		if (condition) callback(this);
		else fallback?.(this);
		return this;
	}

	/** Inverse of `when` — applies `callback` only when `condition` is falsy. */
	unless(
		condition: boolean,
		callback: (query: this) => void,
		fallback?: (query: this) => void,
	): this {
		if (!condition) callback(this);
		else fallback?.(this);
		return this;
	}

	/**
	 * Applies one named local scope declared in `static scopes`.
	 *
	 * ```ts
	 * User.query().scope("active").get();
	 * ```
	 */
	scope<K extends LocalScopeNamesOf<M>>(
		name: K,
		...args: LocalScopeArgsOf<M, K>
	): this {
		const scopes = (
			this.modelClass as
				| {
						scopes?: Record<
							string,
							(query: unknown, ...rest: unknown[]) => void
						>;
				  }
				| undefined
		)?.scopes;
		const scope = scopes?.[name];
		if (scope === undefined) {
			throw new InvalidQueryError(
				`scope(${JSON.stringify(name)}): local scope is not defined on the model.`,
			);
		}
		scope(this, ...args);
		return this;
	}

	clone(): QueryBuilder<S, T, M, Loaded, Sel, J> {
		const copy = new QueryBuilder<S, T, M, Loaded, Sel, J>(
			this.orm,
			this.tableName,
			this.modelClass,
			{ skipGlobalScopes: true },
		);
		copy.#outerTables = [...this.#outerTables];
		Object.assign(copy.state, {
			wheres: [...this.state.wheres],
			joins: [...this.state.joins],
			orders: [...this.state.orders],
			groups: [...this.state.groups],
			havings: [...this.state.havings],
			selectSubs: [...this.state.selectSubs],
			withPaths: [...this.state.withPaths],
			withCounts: [...this.state.withCounts],
			withAggregates: [...this.state.withAggregates],
			withExists: [...this.state.withExists],
			unions: [...this.state.unions],
			selectRaw: [...this.state.selectRaw],
			ordersRaw: [...this.state.ordersRaw],
			groupsRaw: [...this.state.groupsRaw],
			lock: this.state.lock,
			softDeleteMode: this.state.softDeleteMode,
			limit: this.state.limit,
			offset: this.state.offset,
			selected: this.state.selected ? [...this.state.selected] : null,
			distinct: this.state.distinct,
		});
		return copy;
	}

	// -----------------------------------------------------------------------
	// eager loading
	// -----------------------------------------------------------------------

	/** Relation map of the bound model (or an empty object in row mode). */
	#relations(): AnyRelations | undefined {
		return (this.modelClass as { relations?: AnyRelations } | undefined)
			?.relations;
	}

	#requireRelation(
		relations: AnyRelations | undefined,
		relation: string,
		caller: string,
	): AnyRelationDescriptor {
		const descriptor = relationAt(relations, relation);
		if (descriptor === undefined) {
			throw new InvalidQueryError(
				`${caller}(${JSON.stringify(relation)}): relation is not defined on the model.`,
			);
		}
		return descriptor;
	}

	#pushWithPath(
		relations: AnyRelations | undefined,
		path: string,
		constrain?: (query: unknown) => void,
	): void {
		const descriptor = this.#requireRelation(relations, path, "with");
		if (constrain !== undefined && descriptor.kind === "morphTo") {
			throw new InvalidQueryError(
				`with(${JSON.stringify(path)}): morphTo relations cannot be constrained. Constrain the concrete relations instead.`,
			);
		}
		this.state.withPaths.push({ path, constrain });
	}

	/**
	 * Eager-loads relations (batched — never one query per parent).
	 *
	 * Accepts paths or a map of path → constraint callback:
	 *
	 * ```ts
	 * User.query().with("posts", "team");
	 * User.query().with({
	 *   posts: (q) => q.where("published", true),
	 *   "posts.comments": (q) => q.orderBy("id"),
	 * });
	 * ```
	 */
	with<P extends AllRelationPathsSafe<RelationsOf<M>>>(
		...paths: P[]
	): QueryBuilder<S, T, M, Loaded & LoadedUnion<M, P>, Sel, J>;
	with<const C extends object>(
		constraints: C &
			WithConstraints<M, S> &
			Record<Exclude<keyof C, keyof WithConstraints<M, S>>, never>,
	): QueryBuilder<S, T, M, Loaded & LoadedUnion<M, keyof C & string>, Sel, J>;
	with(
		first?: unknown,
		...rest: unknown[]
	): QueryBuilder<S, T, M, any, Sel, J> {
		if (this.modelClass === undefined) {
			throw new InvalidQueryError(
				"with() is only available on model queries. Use Model.query() or orm.model(table).query().",
			);
		}
		const relations = this.#relations();
		if (first !== null && typeof first === "object" && !Array.isArray(first)) {
			if (rest.length > 0) {
				throw new InvalidQueryError(
					"with(): pass either relation paths or one constraint map, not both.",
				);
			}
			for (const [path, constrain] of Object.entries(
				first as Record<string, unknown>,
			)) {
				if (typeof constrain !== "function") {
					throw new InvalidQueryError(
						`with(): the constraint for "${path}" must be a function.`,
					);
				}
				this.#pushWithPath(
					relations,
					path,
					constrain as (query: unknown) => void,
				);
			}
		} else {
			for (const path of [first, ...rest]) {
				if (typeof path !== "string") {
					throw new InvalidQueryError(
						"with(): expected relation path strings or one constraint map.",
					);
				}
				this.#pushWithPath(relations, path);
			}
		}
		return this as unknown as QueryBuilder<S, T, M, any, Sel, J>;
	}

	/**
	 * Adds a typed count of a relation to every row (`postsCount`).
	 * Supports `"posts as pendingCount"` aliases, or one constraint map:
	 *
	 * ```ts
	 * User.query().withCount({ posts: (q) => q.where("published", true) });
	 * ```
	 */
	withCount<
		P extends
			| AggregateRelationNamesOf<M>
			| `${AggregateRelationNamesOf<M>} as ${string}`,
	>(
		...references: P[]
	): QueryBuilder<
		S,
		T,
		M,
		Loaded & { [K in P as AggregateKeyOf<K, "Count">]: number },
		Sel,
		J
	>;
	withCount<const C extends object>(
		constraints: C &
			WithAggregateConstraints<M, S> &
			Record<Exclude<keyof C, keyof WithAggregateConstraints<M, S>>, never>,
	): QueryBuilder<
		S,
		T,
		M,
		Loaded & { [K in keyof C & string as AggregateKeyOf<K, "Count">]: number },
		Sel,
		J
	>;
	withCount(
		first?: unknown,
		...rest: unknown[]
	): QueryBuilder<S, T, M, any, Sel, J> {
		const relations = this.#relations();
		if (first !== null && typeof first === "object" && !Array.isArray(first)) {
			if (rest.length > 0) {
				throw new InvalidQueryError(
					"withCount(): pass either relation references or one constraint map, not both.",
				);
			}
			for (const [reference, constrain] of Object.entries(
				first as Record<string, unknown>,
			)) {
				if (typeof constrain !== "function") {
					throw new InvalidQueryError(
						`withCount(): the constraint for "${reference}" must be a function.`,
					);
				}
				const { relation, alias } = parseRelationRef(reference, "withCount");
				const descriptor = this.#requireRelation(
					relations,
					relation,
					"withCount",
				);
				this.state.withCounts.push({
					relation,
					alias: alias ?? `${relation}Count`,
					constraint: this.#captureAggregateConstraint(
						descriptor,
						relation,
						"withCount",
						constrain as (query: unknown) => void,
					),
				});
			}
			return this as unknown as QueryBuilder<S, T, M, any, Sel, J>;
		}
		for (const reference of [first, ...rest]) {
			const { relation, alias } = parseRelationRef(
				reference as string,
				"withCount",
			);
			const descriptor = this.#requireRelation(
				relations,
				relation,
				"withCount",
			);
			this.state.withCounts.push({
				relation,
				alias: alias ?? `${relation}Count`,
				constraint: this.#captureAggregateConstraint(
					descriptor,
					relation,
					"withCount",
					undefined,
				),
			});
		}
		return this as unknown as QueryBuilder<S, T, M, any, Sel, J>;
	}

	/** Adds a boolean `EXISTS` flag for a relation (`${relation}Exists`). */
	withExists<
		P extends
			| AggregateRelationNamesOf<M>
			| `${AggregateRelationNamesOf<M>} as ${string}`,
	>(
		...references: P[]
	): QueryBuilder<
		S,
		T,
		M,
		Loaded & { [K in P as AggregateKeyOf<K, "Exists">]: boolean },
		Sel,
		J
	>;
	withExists<const C extends object>(
		constraints: C &
			WithAggregateConstraints<M, S> &
			Record<Exclude<keyof C, keyof WithAggregateConstraints<M, S>>, never>,
	): QueryBuilder<
		S,
		T,
		M,
		Loaded & {
			[K in keyof C & string as AggregateKeyOf<K, "Exists">]: boolean;
		},
		Sel,
		J
	>;
	withExists(
		first?: unknown,
		...rest: unknown[]
	): QueryBuilder<S, T, M, any, Sel, J> {
		const relations = this.#relations();
		if (first !== null && typeof first === "object" && !Array.isArray(first)) {
			if (rest.length > 0) {
				throw new InvalidQueryError(
					"withExists(): pass either relation references or one constraint map, not both.",
				);
			}
			for (const [reference, constrain] of Object.entries(
				first as Record<string, unknown>,
			)) {
				if (typeof constrain !== "function") {
					throw new InvalidQueryError(
						`withExists(): the constraint for "${reference}" must be a function.`,
					);
				}
				const { relation, alias } = parseRelationRef(reference, "withExists");
				const descriptor = this.#requireRelation(
					relations,
					relation,
					"withExists",
				);
				this.state.withExists.push({
					relation,
					alias: alias ?? `${relation}Exists`,
					constraint: this.#captureAggregateConstraint(
						descriptor,
						relation,
						"withExists",
						constrain as (query: unknown) => void,
					),
				});
			}
			return this as unknown as QueryBuilder<S, T, M, any, Sel, J>;
		}
		for (const reference of [first, ...rest]) {
			const { relation, alias } = parseRelationRef(
				reference as string,
				"withExists",
			);
			const descriptor = this.#requireRelation(
				relations,
				relation,
				"withExists",
			);
			this.state.withExists.push({
				relation,
				alias: alias ?? `${relation}Exists`,
				constraint: this.#captureAggregateConstraint(
					descriptor,
					relation,
					"withExists",
					undefined,
				),
			});
		}
		return this as unknown as QueryBuilder<S, T, M, any, Sel, J>;
	}

	/** Adds `SUM(related.column)` as `${relation}Sum${Column}` (or an alias). */
	withSum<
		P extends
			| AggregateRelationNamesOf<M>
			| `${AggregateRelationNamesOf<M>} as ${string}`,
		C extends ColumnsOfModel<RelatedOfRelationRef<M, P>>,
	>(
		reference: P,
		column: C,
		constrain?: AggregateConstraintCallback<S, M, P>,
	): QueryBuilder<
		S,
		T,
		M,
		Loaded & {
			[K in P as AggregateKeyOf<
				K,
				`Sum${Capitalize<C>}`
			>]: RelationAggregateResult<M, K, C, "sum"> | null;
		},
		Sel,
		J
	> {
		this.#addAggregate(
			"sum",
			"withSum",
			reference,
			column as string,
			constrain as ((query: unknown) => void) | undefined,
		);
		return this.#ret<
			M,
			Loaded & {
				[K in P as AggregateKeyOf<
					K,
					`Sum${Capitalize<C>}`
				>]: RelationAggregateResult<M, K, C, "sum"> | null;
			},
			Sel,
			J
		>();
	}

	/** Adds `AVG(related.column)` as `${relation}Avg${Column}` (or an alias). */
	withAvg<
		P extends
			| AggregateRelationNamesOf<M>
			| `${AggregateRelationNamesOf<M>} as ${string}`,
		C extends ColumnsOfModel<RelatedOfRelationRef<M, P>>,
	>(
		reference: P,
		column: C,
		constrain?: AggregateConstraintCallback<S, M, P>,
	): QueryBuilder<
		S,
		T,
		M,
		Loaded & {
			[K in P as AggregateKeyOf<
				K,
				`Avg${Capitalize<C>}`
			>]: RelationAggregateResult<M, K, C, "avg"> | null;
		},
		Sel,
		J
	> {
		this.#addAggregate(
			"avg",
			"withAvg",
			reference,
			column as string,
			constrain as ((query: unknown) => void) | undefined,
		);
		return this.#ret<
			M,
			Loaded & {
				[K in P as AggregateKeyOf<
					K,
					`Avg${Capitalize<C>}`
				>]: RelationAggregateResult<M, K, C, "avg"> | null;
			},
			Sel,
			J
		>();
	}

	/** Adds `MIN(related.column)` as `${relation}Min${Column}` (or an alias). */
	withMin<
		P extends
			| AggregateRelationNamesOf<M>
			| `${AggregateRelationNamesOf<M>} as ${string}`,
		C extends ColumnsOfModel<RelatedOfRelationRef<M, P>>,
	>(
		reference: P,
		column: C,
		constrain?: AggregateConstraintCallback<S, M, P>,
	): QueryBuilder<
		S,
		T,
		M,
		Loaded & {
			[K in P as AggregateKeyOf<
				K,
				`Min${Capitalize<C>}`
			>]: RelationAggregateResult<M, K, C, "min"> | null;
		},
		Sel,
		J
	> {
		this.#addAggregate(
			"min",
			"withMin",
			reference,
			column as string,
			constrain as ((query: unknown) => void) | undefined,
		);
		return this.#ret<
			M,
			Loaded & {
				[K in P as AggregateKeyOf<
					K,
					`Min${Capitalize<C>}`
				>]: RelationAggregateResult<M, K, C, "min"> | null;
			},
			Sel,
			J
		>();
	}

	/** Adds `MAX(related.column)` as `${relation}Max${Column}` (or an alias). */
	withMax<
		P extends
			| AggregateRelationNamesOf<M>
			| `${AggregateRelationNamesOf<M>} as ${string}`,
		C extends ColumnsOfModel<RelatedOfRelationRef<M, P>>,
	>(
		reference: P,
		column: C,
		constrain?: AggregateConstraintCallback<S, M, P>,
	): QueryBuilder<
		S,
		T,
		M,
		Loaded & {
			[K in P as AggregateKeyOf<
				K,
				`Max${Capitalize<C>}`
			>]: RelationAggregateResult<M, K, C, "max"> | null;
		},
		Sel,
		J
	> {
		this.#addAggregate(
			"max",
			"withMax",
			reference,
			column as string,
			constrain as ((query: unknown) => void) | undefined,
		);
		return this.#ret<
			M,
			Loaded & {
				[K in P as AggregateKeyOf<
					K,
					`Max${Capitalize<C>}`
				>]: RelationAggregateResult<M, K, C, "max"> | null;
			},
			Sel,
			J
		>();
	}

	/**
	 * Runs an aggregate-constraint callback against a throwaway builder for the
	 * related table and captures its where-clauses + soft-delete mode. Anything
	 * that cannot be represented inside a correlated subquery is rejected
	 * loudly instead of being silently dropped.
	 */
	#captureAggregateConstraint(
		descriptor: AnyRelationDescriptor,
		relation: string,
		caller: string,
		callback: ((query: unknown) => void) | undefined,
	): AggregateConstraint {
		if (callback === undefined) {
			return { wheres: [], softDeleteMode: "default" };
		}
		const relatedClass = descriptor.related?.() as
			| { __table: string }
			| undefined;
		const relatedTable = relatedClass?.__table;
		if (relatedTable === undefined) {
			throw new InvalidQueryError(
				`${caller}(${JSON.stringify(relation)}): relation has no target table.`,
			);
		}
		const child = new QueryBuilder<
			Schema,
			TableName<Schema>,
			unknown,
			unknown,
			null,
			never
		>(
			this.orm as unknown as Orm<Schema>,
			relatedTable as TableName<Schema>,
			relatedClass as never,
		);
		callback(child);
		const unsupported =
			child.state.joins.length > 0 ||
			child.state.groups.length > 0 ||
			child.state.groupsRaw.length > 0 ||
			child.state.orders.length > 0 ||
			child.state.ordersRaw.length > 0 ||
			child.state.havings.length > 0 ||
			child.state.limit !== undefined ||
			child.state.offset !== undefined ||
			child.state.distinct ||
			child.state.unions.length > 0 ||
			child.state.selectSubs.length > 0 ||
			child.state.selectRaw.length > 0 ||
			child.state.withPaths.length > 0 ||
			child.state.withCounts.length > 0 ||
			child.state.withAggregates.length > 0 ||
			child.state.withExists.length > 0 ||
			child.state.selected !== null;
		if (unsupported) {
			throw new InvalidQueryError(
				`${caller}(${JSON.stringify(relation)}): aggregate constraints support where-clauses and withTrashed() only.`,
			);
		}
		return {
			wheres: child.state.wheres,
			softDeleteMode: child.state.softDeleteMode,
		};
	}

	#addAggregate(
		kind: AggregateKind,
		caller: string,
		reference: string,
		column: string,
		constrain?: (query: unknown) => void,
	): void {
		const { relation, alias } = parseRelationRef(reference, caller);
		const descriptor = this.#requireRelation(
			this.#relations(),
			relation,
			caller,
		);
		if (descriptor.kind === "morphTo") {
			throw new InvalidQueryError(
				`${caller}(${JSON.stringify(reference)}): morphTo relations cannot be aggregated.`,
			);
		}
		const relatedTable = (
			descriptor.related?.() as { __table: string } | undefined
		)?.__table;
		if (relatedTable === undefined) {
			throw new InvalidQueryError(
				`${caller}(${JSON.stringify(reference)}): relation has no target table.`,
			);
		}
		const meta = this.orm.internalMeta(relatedTable as never);
		if (!Object.hasOwn(meta.columns, column)) {
			throw new InvalidQueryError(
				`${caller}(${JSON.stringify(reference)}, ${JSON.stringify(column)}): unknown column "${column}" on "${relatedTable}".`,
			);
		}
		const capitalized = column.charAt(0).toUpperCase() + column.slice(1);
		const capitalizedKind = kind.charAt(0).toUpperCase() + kind.slice(1);
		this.state.withAggregates.push({
			relation,
			alias: alias ?? `${relation}${capitalizedKind}${capitalized}`,
			kind,
			column,
			constraint: this.#captureAggregateConstraint(
				descriptor,
				relation,
				caller,
				constrain,
			),
		});
	}

	/**
	 * Generic aggregate egress — dispatches to `withCount`, `withExists`,
	 * `withSum`, `withAvg`, `withMin` or `withMax` based on `options.function`.
	 *
	 * ```ts
	 * User.query().withAggregate("posts", { function: "sum", column: "views" });
	 * ```
	 */
	withAggregate<
		P extends
			| AggregateRelationNamesOf<M>
			| `${AggregateRelationNamesOf<M>} as ${string}`,
	>(
		reference: P,
		options: {
			readonly function: "count";
			readonly constrain?: AggregateConstraintCallback<S, M, P>;
		},
	): QueryBuilder<
		S,
		T,
		M,
		Loaded & { [K in P as AggregateKeyOf<K, "Count">]: number },
		Sel,
		J
	>;
	withAggregate<
		P extends
			| AggregateRelationNamesOf<M>
			| `${AggregateRelationNamesOf<M>} as ${string}`,
	>(
		reference: P,
		options: {
			readonly function: "exists";
			readonly constrain?: AggregateConstraintCallback<S, M, P>;
		},
	): QueryBuilder<
		S,
		T,
		M,
		Loaded & { [K in P as AggregateKeyOf<K, "Exists">]: boolean },
		Sel,
		J
	>;
	withAggregate<
		P extends
			| AggregateRelationNamesOf<M>
			| `${AggregateRelationNamesOf<M>} as ${string}`,
		const F extends AggregateKind,
		C extends ColumnsOfModel<RelatedOfRelationRef<M, P>>,
	>(
		reference: P,
		options: {
			readonly function: F;
			readonly column: C;
			readonly constrain?: AggregateConstraintCallback<S, M, P>;
		},
	): QueryBuilder<
		S,
		T,
		M,
		Loaded & {
			[K in P as AggregateKeyOf<
				K,
				`${Capitalize<F>}${Capitalize<C>}`
			>]: RelationAggregateResult<M, K, C, F> | null;
		},
		Sel,
		J
	>;
	withAggregate(
		reference: string,
		options: {
			readonly function: string;
			readonly column?: string;
			readonly constrain?: (query: any) => void;
		},
	): QueryBuilder<S, T, M, any, Sel, J> {
		const fn = options.function;
		if (fn === "count") {
			const relations = this.#relations();
			const { relation, alias } = parseRelationRef(reference, "withAggregate");
			const descriptor = this.#requireRelation(
				relations,
				relation,
				"withAggregate",
			);
			this.state.withCounts.push({
				relation,
				alias: alias ?? `${relation}Count`,
				constraint: this.#captureAggregateConstraint(
					descriptor,
					relation,
					"withAggregate",
					options.constrain,
				),
			});
			return this as unknown as QueryBuilder<S, T, M, any, Sel, J>;
		}
		if (fn === "exists") {
			const relations = this.#relations();
			const { relation, alias } = parseRelationRef(reference, "withAggregate");
			const descriptor = this.#requireRelation(
				relations,
				relation,
				"withAggregate",
			);
			this.state.withExists.push({
				relation,
				alias: alias ?? `${relation}Exists`,
				constraint: this.#captureAggregateConstraint(
					descriptor,
					relation,
					"withAggregate",
					options.constrain,
				),
			});
			return this as unknown as QueryBuilder<S, T, M, any, Sel, J>;
		}
		if (fn !== "sum" && fn !== "avg" && fn !== "min" && fn !== "max") {
			throw new InvalidQueryError(
				`withAggregate(): function must be "count", "exists", "sum", "avg", "min" or "max", got ${JSON.stringify(fn)}.`,
			);
		}
		if (options.column === undefined) {
			throw new InvalidQueryError(
				`withAggregate(): function "${fn}" requires a column.`,
			);
		}
		this.#addAggregate(
			fn,
			"withAggregate",
			reference,
			options.column,
			options.constrain,
		);
		return this as unknown as QueryBuilder<S, T, M, any, Sel, J>;
	}

	/**
	 * Restricts the query to rows that have at least one related row.
	 * Compiled to a correlated `EXISTS` subquery (nested paths chain EXISTS).
	 */
	whereHas<P extends AllRelationPathsSafe<RelationsOf<M>>>(
		path: P,
		callback?: WhereHasCallback<S, M, P>,
	): this {
		return this.#whereHas("and", false, path, callback);
	}

	/** `OR` variant of `whereHas`. */
	orWhereHas<P extends AllRelationPathsSafe<RelationsOf<M>>>(
		path: P,
		callback?: WhereHasCallback<S, M, P>,
	): this {
		return this.#whereHas("or", false, path, callback);
	}

	/** Restricts the query to rows with no related rows. */
	whereDoesntHave<P extends AllRelationPathsSafe<RelationsOf<M>>>(
		path: P,
		callback?: WhereHasCallback<S, M, P>,
	): this {
		return this.#whereHas("and", true, path, callback);
	}

	/** `OR` variant of `whereDoesntHave`. */
	orWhereDoesntHave<P extends AllRelationPathsSafe<RelationsOf<M>>>(
		path: P,
		callback?: WhereHasCallback<S, M, P>,
	): this {
		return this.#whereHas("or", true, path, callback);
	}

	/** Alias of `whereHas` (Eloquent `has`). */
	has<P extends AllRelationPathsSafe<RelationsOf<M>>>(
		path: P,
		callback?: WhereHasCallback<S, M, P>,
	): this {
		return this.whereHas(path, callback);
	}

	/** Alias of `whereDoesntHave` (Eloquent `doesntHave`). */
	doesntHave<P extends AllRelationPathsSafe<RelationsOf<M>>>(
		path: P,
		callback?: WhereHasCallback<S, M, P>,
	): this {
		return this.whereDoesntHave(path, callback);
	}

	/** Constrains a relation and eagerly loads it in the same call. */
	withWhereHas<P extends AllRelationPathsSafe<RelationsOf<M>>>(
		path: P,
		callback?: WhereHasCallback<S, M, P>,
	): QueryBuilder<S, T, M, Loaded & LoadedUnion<M, P>, Sel, J> {
		this.#pushWithPath(
			this.#relations(),
			path as string,
			callback as unknown as ((query: unknown) => void) | undefined,
		);
		this.whereHas(path, callback);
		return this.#ret<M, Loaded & LoadedUnion<M, P>, Sel, J>();
	}

	/** Constrains a has-many/has-one relation by a related column. */
	whereRelation<
		P extends AllRelationPathsSafe<RelationsOf<M>>,
		C extends ColumnsOfModel<FinalRelatedOf<M, P>>,
	>(
		path: P,
		column: C,
		operator: ComparisonOperator | "like" | "not like" | "ilike",
		value: ColumnValueOfModel<FinalRelatedOf<M, P>, C>,
	): this {
		return this.whereHas(path, ((
			group: WhereGroup<S, TableName<Schema>, never>,
		) => {
			group.where(column as never, operator as never, value as never);
		}) as never);
	}

	/**
	 * Constrains a belongsTo relation from a model instance or model class.
	 * The relation is inferred from the class when omitted.
	 */
	whereBelongsTo(modelOrClass: object, relation?: string): this {
		const relatedClass =
			typeof modelOrClass === "function"
				? modelOrClass
				: (modelOrClass.constructor as object);
		const relations = this.#relations() ?? {};
		let name = relation;
		if (name === undefined) {
			name = Object.entries(relations).find(
				([, descriptor]) =>
					descriptor.kind === "belongsTo" &&
					descriptor.related?.() === relatedClass,
			)?.[0];
		}
		if (name === undefined) {
			throw new InvalidQueryError(
				"whereBelongsTo(): could not infer a belongsTo relation for the given model. Pass the relation name explicitly.",
			);
		}
		const descriptor = this.#requireRelation(relations, name, "whereBelongsTo");
		if (descriptor.kind !== "belongsTo") {
			throw new InvalidQueryError(
				`whereBelongsTo(${JSON.stringify(name)}): relation is not belongsTo.`,
			);
		}
		const foreignKey = requireKey(descriptor.foreignKey, descriptor.kind, name);
		const ownerKey = descriptor.ownerKey ?? "id";
		if (typeof modelOrClass === "function") {
			throw new InvalidQueryError(
				"whereBelongsTo(): pass a model instance, not the model class.",
			);
		}
		const value = (
			modelOrClass as unknown as { get(column: string): unknown }
		).get(ownerKey);
		return this.where(foreignKey as never, value as never);
	}

	/**
	 * Restricts a morphTo relation to the given morph aliases.
	 *
	 * `types` is an array of aliases or `"*"` for every declared type.
	 */
	whereHasMorph(
		path: string,
		types: readonly string[] | "*",
		callback?: (
			query: QueryBuilder<
				Schema,
				TableName<Schema>,
				unknown,
				unknown,
				null,
				never
			>,
		) => void,
	): this {
		const steps = this.#resolveRelationChain(path);
		const last = steps[steps.length - 1]!;
		if (last.descriptor.kind !== "morphTo") {
			throw new InvalidQueryError(
				`whereHasMorph(${JSON.stringify(path)}): relation is not morphTo.`,
			);
		}
		const typeMap = last.descriptor.types?.() ?? {};
		const onlyTypes =
			types === "*" ? undefined : types.filter((type) => type in typeMap);
		if (types !== "*" && onlyTypes !== undefined && onlyTypes.length === 0) {
			throw new InvalidQueryError(
				`whereHasMorph(${JSON.stringify(path)}): none of the given morph types are declared.`,
			);
		}
		let entries: readonly WhereEntry[] = [];
		const callbackTypes =
			onlyTypes ?? (types === "*" ? Object.keys(typeMap) : []);
		if (callback !== undefined && callbackTypes.length > 0) {
			const firstClass = typeMap[callbackTypes[0]!];
			if (firstClass !== undefined) {
				const child = new QueryBuilder<
					Schema,
					TableName<Schema>,
					unknown,
					unknown,
					null,
					never
				>(
					this.orm as unknown as Orm<Schema>,
					firstClass.__table as TableName<Schema>,
					firstClass as unknown,
				);
				callback(child);
				entries = child.state.wheres;
			}
		}
		const dialect = this.orm.dialectKind;
		return this.#pushWhere("and", {
			kind: "custom",
			build: (eb) =>
				relationExists(
					this.orm,
					dialect,
					eb,
					this.tableName as string,
					this.modelClass,
					steps,
					entries,
					"default",
					onlyTypes,
				),
		});
	}

	#whereHas(
		boolean: "and" | "or",
		negated: boolean,
		path: string,
		callback?: (group: never) => void,
	): this {
		if (this.modelClass === undefined) {
			throw new InvalidQueryError(
				"whereHas() is only available on model queries. Use Model.query().",
			);
		}
		const steps = this.#resolveRelationChain(path);
		const last = steps[steps.length - 1]!;
		let entries: readonly WhereEntry[] = [];
		let softMode: SoftDeleteMode = "default";
		if (callback !== undefined) {
			if (last.descriptor.kind === "morphTo") {
				throw new InvalidQueryError(
					`whereHas(${JSON.stringify(path)}): constraining a morphTo relation is not supported.`,
				);
			}
			const child = new QueryBuilder<
				S,
				TableName<S>,
				unknown,
				unknown,
				null,
				never
			>(this.orm, last.relatedTable as TableName<S>, last.relatedClass);
			callback(child as never);
			entries = child.state.wheres;
			softMode = child.state.softDeleteMode;
		}
		const dialect = this.orm.dialectKind;
		return this.#pushWhere(boolean, {
			kind: "custom",
			build: (eb) => {
				const expression = relationExists(
					this.orm,
					dialect,
					eb,
					this.tableName as string,
					this.modelClass,
					steps,
					entries,
					softMode,
				);
				return negated ? eb.not(expression as never) : expression;
			},
		});
	}

	#resolveRelationChain(path: string): RelationStep[] {
		const segments = path.split(".");
		const steps: RelationStep[] = [];
		let relations = this.#relations();
		let ownerClass: unknown = this.modelClass;
		let ownerTable = this.tableName as string;
		for (let index = 0; index < segments.length; index += 1) {
			const segment = segments[index]!;
			if (segment === "") {
				throw new InvalidQueryError(
					`Invalid relation path ${JSON.stringify(path)}.`,
				);
			}
			const descriptor = relations?.[segment];
			if (descriptor === undefined) {
				throw new InvalidQueryError(
					`whereHas(${JSON.stringify(path)}): relation "${segment}" is not defined on "${ownerTable}".`,
				);
			}
			if (descriptor.kind === "morphTo") {
				if (index !== segments.length - 1) {
					throw new InvalidQueryError(
						`whereHas(${JSON.stringify(path)}): nested paths below morphTo are not supported.`,
					);
				}
				steps.push({
					path,
					descriptor,
					ownerClass,
					ownerTable,
					relatedClass: null,
					relatedTable: "",
				});
				return steps;
			}
			const relatedClass = descriptor.related?.() as
				| { __table: string; relations?: AnyRelations }
				| undefined;
			if (relatedClass === undefined) {
				throw new InvalidQueryError(
					`whereHas(${JSON.stringify(path)}): relation "${segment}" has no target model.`,
				);
			}
			const relatedTable = relatedClass.__table;
			steps.push({
				path,
				descriptor,
				ownerClass,
				ownerTable,
				relatedClass,
				relatedTable,
			});
			ownerClass = relatedClass;
			ownerTable = relatedTable;
			relations = relatedClass.relations;
		}
		return steps;
	}

	// -----------------------------------------------------------------------
	// SQL inspection
	// -----------------------------------------------------------------------

	/** Compiles the current SELECT query without executing it. */
	toSQL(): { sql: string; parameters: readonly unknown[] } {
		const compiled = this.#compileSelect().compile();
		return { sql: compiled.sql, parameters: compiled.parameters };
	}

	// -----------------------------------------------------------------------
	// reads
	// -----------------------------------------------------------------------

	/** Executes the query and returns all rows as a collection. */
	async get(): Promise<Collection<ResultOf<S, T, M, Loaded, Sel>>> {
		const compiled = this.#compileSelect().compile();
		const result = await this.orm.execute(compiled);
		const rows = this.#materialize(
			result.rows as Array<Record<string, unknown>>,
		);
		if (this.modelClass !== undefined) {
			if (this.state.withPaths.length > 0) {
				await this.orm.eagerLoadModels(rows, this.state.withPaths);
			}
			await emitRetrieved(this.modelClass as object, rows);
		}
		return Collection.make(rows as Array<ResultOf<S, T, M, Loaded, Sel>>);
	}

	/** Returns the first row or `null`. */
	async first(): Promise<ResultOf<S, T, M, Loaded, Sel> | null> {
		const rows = await this.clone().limit(1).get();
		return rows[0] ?? null;
	}

	/** Returns the first row or throws `ModelNotFoundError`. */
	async firstOrFail(): Promise<ResultOf<S, T, M, Loaded, Sel>> {
		const row = await this.first();
		if (row === null) throw new ModelNotFoundError(this.tableName, undefined);
		return row;
	}

	/** Finds one row by primary key. */
	async find(
		id: PrimaryKeyValueOf<S, T>,
	): Promise<ResultOf<S, T, M, Loaded, Sel> | null> {
		const meta = this.orm.internalMeta(this.tableName);
		if (!meta.primaryKey) {
			throw new InvalidQueryError(
				`find(): table "${this.tableName}" declares no primary key.`,
			);
		}
		return this.clone()
			.where(meta.primaryKey as never, id as never)
			.first();
	}

	/** Finds one row by primary key or throws `ModelNotFoundError`. */
	async findOrFail(
		id: PrimaryKeyValueOf<S, T>,
	): Promise<ResultOf<S, T, M, Loaded, Sel>> {
		const row = await this.find(id);
		if (row === null) throw new ModelNotFoundError(this.tableName, id);
		return row;
	}

	/** First row matching one column comparison, or `null`. */
	async firstWhere<R extends ColumnRef<S, T, J>>(
		column: R,
		operator: ComparisonOperator | "like" | "not like" | "ilike",
		value: RefFilterValue<S, T, R>,
	): Promise<ResultOf<S, T, M, Loaded, Sel> | null> {
		return this.clone()
			.where(column as never, operator as never, value as never)
			.first();
	}

	/** Value of one column on the first row, or `null`. */
	async value<C extends ColumnNameOf<S, T>>(
		column: C,
	): Promise<RowValueOf<S, T, C> | null> {
		const row = await this.clone().select(column).first();
		if (row === null) return null;
		return this.#readColumn(row as object, column) as RowValueOf<S, T, C>;
	}

	/** Exactly one row — throws when zero or multiple rows match. */
	async sole(): Promise<ResultOf<S, T, M, Loaded, Sel>> {
		const rows = await this.clone().limit(2).get();
		if (rows.length === 0) {
			throw new ModelNotFoundError(this.tableName, undefined);
		}
		if (rows.length > 1) {
			throw new InvalidQueryError(
				`sole(): more than one row matched on "${this.tableName}".`,
			);
		}
		return rows[0]!;
	}

	/**
	 * Value of one column from the single matching row — throws
	 * `ModelNotFoundError` when nothing matches and `InvalidQueryError` when
	 * several rows do.
	 */
	async soleValue<C extends ColumnNameOf<S, T>>(
		column: C,
	): Promise<RowValueOf<S, T, C>> {
		const rows = await this.clone().select(column).limit(2).get();
		if (rows.length === 0) {
			throw new ModelNotFoundError(this.tableName, undefined);
		}
		if (rows.length > 1) {
			throw new InvalidQueryError(
				`soleValue(${JSON.stringify(column)}): more than one row matched on "${this.tableName}".`,
			);
		}
		return this.#readColumn(rows[0] as object, column) as RowValueOf<S, T, C>;
	}

	/** First row, or the result of a callback. */
	async firstOr<TResult>(
		callback: () => TResult | Promise<TResult>,
	): Promise<ResultOf<S, T, M, Loaded, Sel> | TResult> {
		const row = await this.first();
		return row ?? (await callback());
	}

	/** Finds by primary key, or calls the callback. */
	async findOr<TResult>(
		id: PrimaryKeyValueOf<S, T>,
		callback: () => TResult | Promise<TResult>,
	): Promise<ResultOf<S, T, M, Loaded, Sel> | TResult> {
		const row = await this.find(id);
		return row ?? (await callback());
	}

	/** Finds by primary key or returns a new (unsaved) model instance. */
	async findOrNew(
		id: PrimaryKeyValueOf<S, T>,
	): Promise<ResultOf<S, T, M, Loaded, Sel>> {
		const row = await this.find(id);
		if (row !== null) return row;
		if (this.modelClass === undefined) {
			throw new InvalidQueryError(
				"findOrNew() is only available on model queries.",
			);
		}
		const meta = this.orm.internalMeta(this.tableName);
		if (meta.primaryKey === null) {
			throw new InvalidQueryError(
				`findOrNew(): table "${this.tableName}" declares no primary key.`,
			);
		}
		const instance = this.orm.hydrateModelRow(
			this.modelClass,
			{},
			false,
		) as unknown as { set(column: string, value: unknown): unknown };
		instance.set(meta.primaryKey, id);
		return instance as ResultOf<S, T, M, Loaded, Sel>;
	}

	/** First match for attributes or a new (unsaved) model filled with both maps. */
	async firstOrNew(
		attributes: Record<string, unknown>,
		values: Record<string, unknown> = {},
	): Promise<ResultOf<S, T, M, Loaded, Sel>> {
		let query = this.clone();
		for (const [column, value] of Object.entries(attributes)) {
			query = query.where(column as never, value as never);
		}
		const row = await query.first();
		if (row !== null) return row;
		if (this.modelClass === undefined) {
			throw new InvalidQueryError(
				"firstOrNew() is only available on model queries.",
			);
		}
		const instance = this.orm.hydrateModelRow(
			this.modelClass,
			{},
			false,
		) as unknown as { fill(values: Record<string, unknown>): unknown };
		instance.fill({ ...attributes, ...values });
		return instance as ResultOf<S, T, M, Loaded, Sel>;
	}

	/** First match, or creates a model from both maps. */
	async firstOrCreate(
		attributes: Record<string, unknown>,
		values: Record<string, unknown> = {},
	): Promise<ResultOf<S, T, M, Loaded, Sel>> {
		const existing = await this.firstOrNew(attributes, values);
		const persisted = (existing as unknown as { isDirty(): boolean }).isDirty();
		if (persisted) {
			await (existing as unknown as { save(): Promise<unknown> }).save();
		}
		return existing;
	}

	/**
	 * Insert-first sibling of `firstOrCreate`: attempts the INSERT and, when
	 * the database rejects it with a unique-constraint violation, returns the
	 * row that won the race. Immune to the find-then-insert race window.
	 */
	async createOrFirst(
		attributes: Record<string, unknown>,
		values: Record<string, unknown> = {},
	): Promise<ResultOf<S, T, M, Loaded, Sel>> {
		if (this.modelClass === undefined) {
			throw new InvalidQueryError(
				"createOrFirst() is only available on model queries.",
			);
		}
		try {
			return (await this.create({
				...attributes,
				...values,
			} as never)) as ResultOf<S, T, M, Loaded, Sel>;
		} catch (error) {
			if (!(error instanceof UniqueConstraintError)) throw error;
			const existing = (await this.firstOrNew(attributes)) as unknown;
			const dirty = (existing as { isDirty(): boolean }).isDirty();
			if (dirty) {
				// The conflict did not come from `attributes`; surface the
				// original unique violation instead of masking it.
				throw error;
			}
			return existing as ResultOf<S, T, M, Loaded, Sel>;
		}
	}

	/** Returns the values of a single column. */
	async pluck<C extends ColumnNameOf<S, T>>(
		column: C,
	): Promise<Collection<RowValueOf<S, T, C>>> {
		const rows = await this.clone().select(column).get();
		return rows.map(
			(row) => this.#readColumn(row as object, column) as never,
		) as unknown as Collection<RowValueOf<S, T, C>>;
	}

	/** Whether at least one row matches. */
	async exists(): Promise<boolean> {
		const executor = this.orm.executor() as AnyBuilder;
		let query: AnyBuilder = executor.selectFrom(this.tableName);
		query = this.#applyJoins(query);
		query = this.#applyWheres(query);
		query = query.select(sql`1`.as("one")).limit(1);
		const result = await this.orm.execute(query.compile());
		return result.rows.length > 0;
	}

	/** Whether no row matches (`!exists()`). */
	async doesntExist(): Promise<boolean> {
		return !(await this.exists());
	}

	/** Total number of matching rows (group-aware). */
	async count(): Promise<number> {
		const executor = this.orm.executor() as AnyBuilder;
		if (this.state.groups.length > 0) {
			const inner = this.clone();
			inner.state.orders = [];
			inner.state.limit = undefined;
			inner.state.offset = undefined;
			inner.state.selected = null;
			const wrapped = executor
				.selectFrom(inner.#compileSelect().as("grouped"))
				.select((eb: AnyBuilder) => eb.fn.countAll().as("count"));
			const result = await this.orm.execute(wrapped.compile());
			return Number(
				(result.rows[0] as { count?: unknown } | undefined)?.count ?? 0,
			);
		}
		let query: AnyBuilder = executor.selectFrom(this.tableName);
		query = this.#applyJoins(query);
		query = this.#applyWheres(query);
		query = query.select((eb: AnyBuilder) => eb.fn.countAll().as("count"));
		const result = await this.orm.execute(query.compile());
		return Number(
			(result.rows[0] as { count?: unknown } | undefined)?.count ?? 0,
		);
	}

	/** Minimum value of a numeric column. */
	async min<C extends NumericColumnOf<S, T>>(
		column: C,
	): Promise<AggregateValueOf<S, T, C> | null> {
		return (await this.#aggregate("min", column)) as never;
	}

	/** Maximum value of a numeric column. */
	async max<C extends NumericColumnOf<S, T>>(
		column: C,
	): Promise<AggregateValueOf<S, T, C> | null> {
		return (await this.#aggregate("max", column)) as never;
	}

	/** Sum of a numeric column. */
	async sum<C extends NumericColumnOf<S, T>>(
		column: C,
	): Promise<AggregateValueOf<S, T, C> | null> {
		return (await this.#aggregate("sum", column)) as never;
	}

	/** Average of a numeric column. */
	async avg<C extends NumericColumnOf<S, T>>(
		column: C,
	): Promise<AverageValueOf<S, T, C> | null> {
		return (await this.#aggregate("avg", column)) as never;
	}

	/** Paginates the query — one `count()` query plus one page query. */
	async paginate(
		perPage = 15,
		page = 1,
	): Promise<Paginated<ResultOf<S, T, M, Loaded, Sel>>> {
		if (!Number.isInteger(perPage) || perPage <= 0) {
			throw new InvalidQueryError(
				`paginate(): perPage must be a positive integer, got ${perPage}.`,
			);
		}
		if (!Number.isInteger(page) || page < 1) {
			throw new InvalidQueryError(
				`paginate(): page must be >= 1, got ${page}.`,
			);
		}
		const total = await this.clone().count();
		const data = await this.clone()
			.limit(perPage)
			.offset((page - 1) * perPage)
			.get();
		const lastPage = Math.max(1, Math.ceil(total / perPage));
		const from = data.length > 0 ? (page - 1) * perPage + 1 : 0;
		return {
			data,
			total,
			page,
			perPage,
			lastPage,
			from,
			to: data.length > 0 ? from + data.length - 1 : 0,
			hasMore: page < lastPage,
		};
	}

	/**
	 * Iterates the result in pages. The callback returns `false` to stop.
	 * Pages are ordered by primary key when no explicit order exists.
	 */
	async chunk(
		size: number,
		callback: (
			rows: Collection<ResultOf<S, T, M, Loaded, Sel>>,
			page: number,
		) => boolean | void,
	): Promise<void> {
		if (!Number.isInteger(size) || size <= 0) {
			throw new InvalidQueryError(
				`chunk(): size must be a positive integer, got ${size}.`,
			);
		}
		const meta = this.orm.internalMeta(this.tableName);
		for (let page = 1; ; page += 1) {
			const query = this.clone()
				.limit(size)
				.offset((page - 1) * size);
			if (query.state.orders.length === 0 && meta.primaryKey) {
				query.orderBy(meta.primaryKey as never);
			}
			const rows = await query.get();
			if (rows.length === 0) return;
			const keepGoing = callback(rows, page);
			if (keepGoing === false || rows.length < size) return;
		}
	}

	/** A page without the total count (`simplePaginate`). */
	async simplePaginate(
		perPage = 15,
		page = 1,
	): Promise<SimplePaginated<ResultOf<S, T, M, Loaded, Sel>>> {
		if (!Number.isInteger(perPage) || perPage <= 0) {
			throw new InvalidQueryError(
				`simplePaginate(): perPage must be a positive integer, got ${perPage}.`,
			);
		}
		if (!Number.isInteger(page) || page < 1) {
			throw new InvalidQueryError(
				`simplePaginate(): page must be >= 1, got ${page}.`,
			);
		}
		const rows = await this.clone()
			.limit(perPage + 1)
			.offset((page - 1) * perPage)
			.get();
		const hasMore = rows.length > perPage;
		const data = Collection.make(rows.all().slice(0, perPage));
		const from = data.length > 0 ? (page - 1) * perPage + 1 : 0;
		return {
			data,
			page,
			perPage,
			from,
			to: data.length > 0 ? from + data.length - 1 : 0,
			hasMore,
		};
	}

	/**
	 * Cursor pagination on one ordered column (primary key by default).
	 * Only forward cursors are emitted; pass `options.cursor` to continue.
	 */
	async cursorPaginate<C extends ColumnNameOf<S, T>>(
		perPage = 15,
		options: {
			readonly cursor?: string | null;
			readonly column?: C;
			readonly direction?: "asc" | "desc";
		} = {},
	): Promise<CursorPaginated<ResultOf<S, T, M, Loaded, Sel>>> {
		if (!Number.isInteger(perPage) || perPage <= 0) {
			throw new InvalidQueryError(
				`cursorPaginate(): perPage must be a positive integer, got ${perPage}.`,
			);
		}
		const meta = this.orm.internalMeta(this.tableName);
		const column = options.column ?? (meta.primaryKey as C | null);
		if (column === null || column === undefined) {
			throw new InvalidQueryError(
				`cursorPaginate(): table "${this.tableName}" declares no primary key; pass an explicit column.`,
			);
		}
		const direction = options.direction ?? "asc";
		let query = this.clone().reorder(column, direction);
		if (options.cursor !== undefined && options.cursor !== null) {
			let decoded: unknown;
			try {
				decoded = JSON.parse(
					Buffer.from(options.cursor, "base64url").toString("utf8"),
				);
			} catch {
				throw new InvalidQueryError(
					"cursorPaginate(): the cursor is malformed.",
				);
			}
			const value = decoded as { value?: unknown };
			if (!value || typeof value !== "object" || !("value" in value)) {
				throw new InvalidQueryError(
					"cursorPaginate(): the cursor is malformed.",
				);
			}
			query = query.where(
				column as never,
				(direction === "asc" ? ">" : "<") as never,
				value.value as never,
			);
		}
		const rows = await query.limit(perPage + 1).get();
		const hasMore = rows.length > perPage;
		const data = Collection.make(rows.all().slice(0, perPage));
		const last = data[data.length - 1];
		const nextCursor =
			hasMore && last !== undefined
				? Buffer.from(
						JSON.stringify({ value: this.#readColumn(last as object, column) }),
						"utf8",
					).toString("base64url")
				: null;
		return {
			data,
			perPage,
			nextCursor,
			prevCursor: null,
			hasMore,
		};
	}

	/** Iterates rows in key-set chunks (no OFFSET drift). */
	async *lazyById(
		size = 1000,
		column?: ColumnNameOf<S, T>,
	): AsyncGenerator<ResultOf<S, T, M, Loaded, Sel>, void, undefined> {
		if (!Number.isInteger(size) || size <= 0) {
			throw new InvalidQueryError(
				`lazyById(): size must be a positive integer, got ${size}.`,
			);
		}
		const meta = this.orm.internalMeta(this.tableName);
		const key = column ?? (meta.primaryKey as ColumnNameOf<S, T> | null);
		if (key === null || key === undefined) {
			throw new InvalidQueryError(
				`lazyById(): table "${this.tableName}" declares no primary key; pass an explicit column.`,
			);
		}
		let last: unknown;
		for (;;) {
			let query = this.clone().reorder(key, "asc").limit(size);
			if (last !== undefined) {
				query = query.where(key as never, ">" as never, last as never);
			}
			const rows = await query.get();
			if (rows.length === 0) return;
			for (const row of rows) yield row;
			if (rows.length < size) return;
			last = this.#readColumn(rows[rows.length - 1] as object, key);
			if (last === undefined || last === null) return;
		}
	}

	/** Iterates rows in key-set chunks, defaulting to the primary key. */
	lazy(
		size = 1000,
	): AsyncGenerator<ResultOf<S, T, M, Loaded, Sel>, void, undefined> {
		return this.lazyById(size);
	}

	/** Key-set chunking; the callback receives a collection per page. */
	async chunkById(
		size: number,
		callback: (
			rows: Collection<ResultOf<S, T, M, Loaded, Sel>>,
			page: number,
		) => boolean | void,
		column?: ColumnNameOf<S, T>,
	): Promise<void> {
		if (!Number.isInteger(size) || size <= 0) {
			throw new InvalidQueryError(
				`chunkById(): size must be a positive integer, got ${size}.`,
			);
		}
		const meta = this.orm.internalMeta(this.tableName);
		const key = column ?? (meta.primaryKey as ColumnNameOf<S, T> | null);
		if (key === null || key === undefined) {
			throw new InvalidQueryError(
				`chunkById(): table "${this.tableName}" declares no primary key; pass an explicit column.`,
			);
		}
		let last: unknown;
		for (let page = 1; ; page += 1) {
			let query = this.clone().reorder(key, "asc").limit(size);
			if (last !== undefined) {
				query = query.where(key as never, ">" as never, last as never);
			}
			const rows = await query.get();
			if (rows.length === 0) return;
			const keepGoing = callback(rows, page);
			if (keepGoing === false || rows.length < size) return;
			last = this.#readColumn(rows[rows.length - 1] as object, key);
			if (last === undefined || last === null) return;
		}
	}

	/** Async iterator over rows, fetched in batches of `size`. */
	async *cursor(
		size = 100,
	): AsyncGenerator<ResultOf<S, T, M, Loaded, Sel>, void, undefined> {
		if (!Number.isInteger(size) || size <= 0) {
			throw new InvalidQueryError(
				`cursor(): size must be a positive integer, got ${size}.`,
			);
		}
		const meta = this.orm.internalMeta(this.tableName);
		for (let page = 1; ; page += 1) {
			const query = this.clone()
				.limit(size)
				.offset((page - 1) * size);
			if (query.state.orders.length === 0 && meta.primaryKey) {
				query.orderBy(meta.primaryKey as never);
			}
			const rows = await query.get();
			if (rows.length === 0) return;
			for (const row of rows) yield row;
			if (rows.length < size) return;
		}
	}

	// -----------------------------------------------------------------------
	// writes
	// -----------------------------------------------------------------------

	/** Inserts one row or an array of rows. */
	async insert(
		values: InsertOf<S, T> | ReadonlyArray<InsertOf<S, T>>,
	): Promise<InsertResult<PrimaryKeyValueOf<S, T>>> {
		const meta = this.orm.internalMeta(this.tableName);
		const input = (Array.isArray(values) ? values : [values]) as Array<
			Record<string, unknown>
		>;
		if (input.length === 0) return { id: undefined };
		const cleaned = input.map((row) => this.#cleanWriteRow(row, meta, {}));
		if (cleaned.some((row) => Object.keys(row).length === 0)) {
			throw new InvalidQueryError("insert(): no writable columns provided.");
		}
		const executor = this.orm.executor() as AnyBuilder;
		const query: AnyBuilder = executor
			.insertInto(this.tableName)
			.values(cleaned.length === 1 ? cleaned[0] : cleaned);
		const pk = meta.primaryKey;
		if (pk && this.orm.dialectKind !== "mysql") {
			const result = await this.orm.execute(query.returning(pk).compile());
			const value =
				input.length === 1
					? (result.rows[0] as Record<string, unknown> | undefined)?.[pk]
					: undefined;
			return { id: this.#convertValue(meta, pk, value) as never };
		}
		const result = await this.orm.execute(query.compile());
		const value = result.insertId !== undefined ? result.insertId : undefined;
		const id = pk ? this.#convertValue(meta, pk, value) : value;
		return { id: id as never };
	}

	/** Inserts many rows — returns the number of inserted rows. */
	async insertMany(values: ReadonlyArray<InsertOf<S, T>>): Promise<number> {
		if (values.length === 0) return 0;
		await this.insert(values);
		return values.length;
	}

	/** Inserts rows and silently ignores conflicts (`INSERT IGNORE` / `DO NOTHING`). */
	async insertOrIgnore(
		values: InsertOf<S, T> | ReadonlyArray<InsertOf<S, T>>,
	): Promise<InsertResult<PrimaryKeyValueOf<S, T>>> {
		const meta = this.orm.internalMeta(this.tableName);
		const input = (Array.isArray(values) ? values : [values]) as Array<
			Record<string, unknown>
		>;
		if (input.length === 0) return { id: undefined };
		const cleaned = input.map((row) => this.#cleanWriteRow(row, meta, {}));
		const executor = this.orm.executor() as AnyBuilder;
		const query = executor
			.insertInto(this.tableName)
			.values(cleaned.length === 1 ? cleaned[0] : cleaned)
			.ignore();
		const result = await this.orm.execute(query.compile());
		const pk = meta.primaryKey;
		const value = result.insertId === undefined ? undefined : result.insertId;
		return {
			id: (pk ? this.#convertValue(meta, pk, value) : value) as never,
		};
	}

	/** Updates the first matching row, or inserts when nothing matched. */
	async updateOrInsert(
		attributes: Record<string, unknown>,
		values: Record<string, unknown> = {},
	): Promise<boolean> {
		let query = this.clone();
		for (const [column, value] of Object.entries(attributes)) {
			query = query.where(column as never, value as never);
		}
		const affected = await query.update(values as never);
		if (affected > 0) return true;
		const meta = this.orm.internalMeta(this.tableName);
		const payload = this.#cleanWriteRow({ ...attributes, ...values }, meta, {});
		if (Object.keys(payload).length === 0) {
			throw new InvalidQueryError(
				"updateOrInsert(): no writable columns provided.",
			);
		}
		await this.insert(payload as never);
		return true;
	}

	/** Empties the table using the dialect's truncate statement. */
	async truncate(): Promise<void> {
		const quote = (name: string) =>
			this.orm.dialectKind === "mysql"
				? `\`${name.replaceAll("`", "``")}\``
				: `"${name.replaceAll('"', '""')}"`;
		const table = quote(this.tableName);
		if (this.orm.dialectKind === "sqlite") {
			await this.orm.raw(`delete from ${table}`);
			return;
		}
		await this.orm.raw(`truncate table ${table}`);
	}

	/** Atomically adds per-column amounts in one UPDATE. */
	async incrementEach(
		values: Partial<Record<NumericColumnOf<S, T>, number>>,
		extra?: Omit<UpdateOf<S, T>, NumericColumnOf<S, T>>,
	): Promise<number> {
		return this.#incrementMany(values as Record<string, number>, extra, 1);
	}

	/** Atomically subtracts per-column amounts in one UPDATE. */
	async decrementEach(
		values: Partial<Record<NumericColumnOf<S, T>, number>>,
		extra?: Omit<UpdateOf<S, T>, NumericColumnOf<S, T>>,
	): Promise<number> {
		return this.#incrementMany(values as Record<string, number>, extra, -1);
	}

	async #incrementMany(
		values: Record<string, number>,
		extra: Record<string, unknown> | undefined,
		sign: 1 | -1,
	): Promise<number> {
		const meta = this.orm.internalMeta(this.tableName);
		const set: Record<string, unknown> = {
			...this.#cleanWriteRow(extra ?? {}, meta, { dropPrimaryKey: true }),
		};
		for (const [column, amount] of Object.entries(values)) {
			if (typeof amount !== "number" || !Number.isFinite(amount)) {
				throw new InvalidQueryError(
					`incrementEach(): "${column}" must be a finite number.`,
				);
			}
			if (!Object.hasOwn(meta.columns, column)) {
				throw new InvalidQueryError(
					`incrementEach(): unknown column "${column}" on "${this.tableName}".`,
				);
			}
			if (column === meta.primaryKey || meta.generated.has(column)) {
				throw new InvalidQueryError(
					`incrementEach(): cannot modify generated or primary-key column "${column}".`,
				);
			}
			const definition = normalizeColumn(
				this.tableName,
				column,
				meta.columns[column]!,
			);
			if (
				definition.type !== "integer" &&
				definition.type !== "bigint" &&
				definition.type !== "float" &&
				definition.type !== "double" &&
				definition.type !== "decimal"
			) {
				throw new InvalidQueryError(
					`incrementEach(): column "${column}" is ${definition.type}, not numeric.`,
				);
			}
			set[column] = sql`${sql.ref(column)} + ${amount * sign}`;
		}
		if (Object.keys(set).length === 0) return 0;
		const executor = this.orm.executor() as AnyBuilder;
		let query: AnyBuilder = executor.updateTable(this.tableName).set(set);
		query = this.#applyWheres(query);
		const result = await this.orm.execute(query.compile());
		return Number(result.numAffectedRows ?? 0);
	}

	/** Updates every matching row — returns the number of affected rows. */
	async update(values: UpdateOf<S, T>): Promise<number> {
		const meta = this.orm.internalMeta(this.tableName);
		const cleaned = this.#cleanWriteRow(
			values as Record<string, unknown>,
			meta,
			{
				dropPrimaryKey: true,
			},
		);
		if (Object.keys(cleaned).length === 0) return 0;
		const executor = this.orm.executor() as AnyBuilder;
		let query: AnyBuilder = executor.updateTable(this.tableName).set(cleaned);
		query = this.#applyWheres(query);
		const result = await this.orm.execute(query.compile());
		return Number(result.numAffectedRows ?? 0);
	}

	/**
	 * Deletes every matching row — returns the number of affected rows.
	 * On soft-delete models this sets the `deletedAt` column instead.
	 */
	async delete(): Promise<number> {
		const softColumn = this.#softDeleteColumn();
		if (softColumn !== null) {
			return this.update({ [softColumn]: new Date() } as never);
		}
		const executor = this.orm.executor() as AnyBuilder;
		let query: AnyBuilder = executor.deleteFrom(this.tableName);
		query = this.#applyWheres(query);
		const result = await this.orm.execute(query.compile());
		return Number(result.numAffectedRows ?? 0);
	}

	/**
	 * Permanently deletes matching rows, even on soft-delete models.
	 * Use `withTrashed()` to include already-trashed rows.
	 */
	async forceDelete(): Promise<number> {
		const executor = this.orm.executor() as AnyBuilder;
		let query: AnyBuilder = executor.deleteFrom(this.tableName);
		query = this.#applyWheres(query);
		const result = await this.orm.execute(query.compile());
		return Number(result.numAffectedRows ?? 0);
	}

	/**
	 * Restores soft-deleted rows (combine with `onlyTrashed()` or
	 * `withTrashed()`); returns the number of affected rows.
	 */
	async restore(): Promise<number> {
		const softColumn = this.#requireSoftModel("restore");
		return this.update({ [softColumn]: null } as never);
	}

	/** Atomically adds `by` to a numeric column — returns affected rows. */
	async increment<C extends NumericColumnOf<S, T>>(
		column: C,
		by: number | bigint = 1,
		extra?: Omit<UpdateOf<S, T>, C>,
	): Promise<number> {
		return this.#incrementBy(
			column as string,
			by,
			(extra ?? {}) as Record<string, unknown>,
			"increment",
		);
	}

	/** Atomically subtracts `by` from a numeric column. */
	async decrement<C extends NumericColumnOf<S, T>>(
		column: C,
		by: number | bigint = 1,
		extra?: Omit<UpdateOf<S, T>, C>,
	): Promise<number> {
		return this.#incrementBy(
			column as string,
			-by,
			(extra ?? {}) as Record<string, unknown>,
			"decrement",
		);
	}

	async #incrementBy(
		column: string,
		delta: number | bigint,
		extra: Record<string, unknown>,
		caller: string,
	): Promise<number> {
		if (
			typeof delta !== "bigint" &&
			(typeof delta !== "number" || !Number.isFinite(delta))
		) {
			throw new InvalidQueryError(
				`${caller}(): the amount must be a finite number or bigint.`,
			);
		}
		const meta = this.orm.internalMeta(this.tableName);
		if (!Object.hasOwn(meta.columns, column)) {
			throw new InvalidQueryError(
				`${caller}(): unknown column "${column}" on "${this.tableName}".`,
			);
		}
		if (meta.generated.has(column) || column === meta.primaryKey) {
			throw new InvalidQueryError(
				`${caller}(): cannot modify generated or primary-key column "${column}".`,
			);
		}
		const definition = normalizeColumn(
			this.tableName,
			column,
			meta.columns[column]!,
		);
		if (
			definition.type !== "integer" &&
			definition.type !== "bigint" &&
			definition.type !== "float" &&
			definition.type !== "double" &&
			definition.type !== "decimal"
		) {
			throw new InvalidQueryError(
				`${caller}(): column "${column}" on "${this.tableName}" is ${definition.type}, not numeric.`,
			);
		}
		if (Object.hasOwn(extra, column)) {
			throw new InvalidQueryError(
				`${caller}(): the extra update must not contain "${column}".`,
			);
		}
		const cleaned = this.#cleanWriteRow(extra, meta, { dropPrimaryKey: true });
		const executor = this.orm.executor() as AnyBuilder;
		let query: AnyBuilder = executor.updateTable(this.tableName).set({
			...cleaned,
			[column]: sql`${sql.ref(column)} + ${delta}`,
		});
		query = this.#applyWheres(query);
		const result = await this.orm.execute(query.compile());
		return Number(result.numAffectedRows ?? 0);
	}

	/**
	 * Inserts rows, updating existing ones on conflict.
	 *
	 * ```ts
	 * await User.query().upsert(
	 *   { email: "a@b.c", name: "A" },
	 *   { conflictOn: "email", update: ["name"] },
	 * );
	 * ```
	 */
	async upsert(
		values: InsertOf<S, T> | ReadonlyArray<InsertOf<S, T>>,
		options: {
			conflictOn: ColumnNameOf<S, T> | ReadonlyArray<ColumnNameOf<S, T>>;
			update?: ReadonlyArray<ColumnNameOf<S, T>>;
		},
	): Promise<number> {
		const meta = this.orm.internalMeta(this.tableName);
		const input = (Array.isArray(values) ? values : [values]) as Array<
			Record<string, unknown>
		>;
		if (input.length === 0) return 0;
		const conflictColumns = Array.isArray(options.conflictOn)
			? [...options.conflictOn]
			: [options.conflictOn];
		for (const column of conflictColumns) {
			if (!Object.hasOwn(meta.columns, column)) {
				throw new InvalidQueryError(
					`upsert(): conflict column "${column}" does not exist on "${this.tableName}".`,
				);
			}
		}
		const cleaned = input.map((row) => this.#cleanWriteRow(row, meta, {}));
		const first = cleaned[0]!;
		const updateColumns =
			options.update !== undefined
				? [...options.update]
				: Object.keys(first).filter(
						(column) =>
							!conflictColumns.includes(column as never) &&
							!meta.generated.has(column) &&
							column !== meta.primaryKey,
					);
		if (updateColumns.length === 0) {
			throw new InvalidQueryError(
				"upsert(): nothing to update — pass `update` or provide non-conflict columns.",
			);
		}
		for (const column of updateColumns) {
			if (!Object.hasOwn(meta.columns, column) || meta.generated.has(column)) {
				throw new InvalidQueryError(
					`upsert(): cannot update column "${column}" on "${this.tableName}".`,
				);
			}
		}
		const executor = this.orm.executor() as AnyBuilder;
		const insert = executor
			.insertInto(this.tableName)
			.values(cleaned.length === 1 ? cleaned[0] : cleaned);
		// Referencing the incoming row differs per dialect. MySQL has no
		// `ON CONFLICT` at all: it compiles to `ON DUPLICATE KEY UPDATE` and
		// reads the incoming row through `values(<column>)`. The conflict
		// target cannot be expressed — MySQL picks the unique key itself.
		const query =
			this.orm.dialectKind === "mysql"
				? insert.onDuplicateKeyUpdate(
						Object.fromEntries(
							updateColumns.map((column) => [
								column,
								sql`values(${sql.ref(column)})`,
							]),
						),
					)
				: insert.onConflict((oc: AnyBuilder) =>
						oc
							.columns(conflictColumns)
							.doUpdateSet(
								Object.fromEntries(
									updateColumns.map((column) => [
										column,
										(eb: AnyBuilder) => eb.ref(`excluded.${column}`),
									]),
								),
							),
					);
		const result = await this.orm.execute(query.compile());
		return Number(result.numAffectedRows ?? cleaned.length);
	}

	/** Creates a model instance through the bound model class. */
	async create(values: CreateValues<M, S, T>): Promise<InstanceOf<M>> {
		if (this.modelClass === undefined) {
			throw new InvalidQueryError(
				"create() is only available on model queries. Use Model.create() instead.",
			);
		}
		const model = this.modelClass as {
			create: (input: unknown) => Promise<InstanceOf<M>>;
		};
		return model.create(values);
	}

	// -----------------------------------------------------------------------
	// internal compile surface
	// -----------------------------------------------------------------------

	#compileSelect(): AnyBuilder {
		const executor = this.orm.executor() as AnyBuilder;
		let query: AnyBuilder = executor.selectFrom(this.tableName);
		query = this.#applyJoins(query);
		query = this.#applyWheres(query);
		// Select the base row before appending computed columns. MySQL rejects
		// `select expr, *` (wildcards must come first), while `select *, expr`
		// is valid on every supported dialect.
		if (this.state.selected !== null) {
			const qualifier = this.state.joins.length > 0 ? `${this.tableName}.` : "";
			query = query.select(
				this.state.selected.map((column) => `${qualifier}${column}`),
			);
		} else if (this.state.joins.length > 0) {
			// With joins, spread `*` would leak joined columns into rows the
			// types do not describe. Base columns are selected explicitly.
			query = query.select(
				Object.keys(this.orm.schema[this.tableName] as ColumnMap).map(
					(column) => `${this.tableName}.${column}`,
				),
			);
		} else {
			query = query.selectAll();
		}
		for (const count of this.state.withCounts) {
			query = query.select((eb: AnyBuilder) =>
				this.#countSubquery(eb, count).as(count.alias),
			);
		}
		for (const aggregate of this.state.withAggregates) {
			query = query.select((eb: AnyBuilder) =>
				this.#aggregateSubquery(eb, aggregate).as(aggregate.alias),
			);
		}
		for (const exists of this.state.withExists) {
			query = query.select((eb: AnyBuilder) => {
				const descriptor = this.#requireRelation(
					this.#relations(),
					exists.relation,
					"withExists",
				);
				const relatedTable = (
					descriptor.related?.() as { __table: string } | undefined
				)?.__table;
				if (relatedTable === undefined) {
					throw new InvalidQueryError(
						`withExists(${JSON.stringify(exists.relation)}): relation has no target table.`,
					);
				}
				const sub = relationSubquery(
					this.orm,
					eb,
					this.tableName as string,
					this.modelClass,
					descriptor,
					exists.relation,
					exists.constraint.softDeleteMode,
					(inner) =>
						applyEntries(
							inner,
							exists.constraint.wheres,
							this.orm.dialectKind,
							relatedTable,
						),
				).select(sql`1`.as("one"));
				return eb.exists(sub).as(exists.alias);
			});
		}
		for (const rawClause of this.state.selectRaw) {
			query = query.select(
				rawClause.alias === undefined
					? rawToKysely(rawClause.expression)
					: rawToKysely(rawClause.expression).as(rawClause.alias),
			);
		}
		for (const subClause of this.state.selectSubs) {
			const sub = subClause.sub as unknown as QueryBuilder<
				S,
				TableName<S>,
				unknown,
				unknown,
				null,
				never
			>;
			query = query.select(sub.#compileSelect().as(subClause.alias));
		}
		if (this.state.distinct) query = query.distinct();
		for (const group of this.state.groups) query = query.groupBy(group);
		for (const group of this.state.groupsRaw) {
			query = query.groupBy(rawToKysely(group.expression));
		}
		if (this.state.havings.length > 0) {
			query = query.having(
				(eb: AnyBuilder) =>
					foldEntries(eb, this.state.havings, this.orm.dialectKind) ??
					trueExpression(eb),
			);
		}
		for (const union of this.state.unions) {
			const sub = union.sub as unknown as QueryBuilder<
				S,
				TableName<S>,
				unknown,
				unknown,
				null,
				never
			>;
			const compiled = sub.#compileSelect();
			query = union.all ? query.unionAll(compiled) : query.union(compiled);
		}
		for (const order of this.state.orders) {
			query = query.orderBy(order.column, order.direction);
		}
		for (const order of this.state.ordersRaw) {
			query = query.orderBy(rawToKysely(order.expression));
		}
		if (this.state.lock !== null && this.orm.dialectKind !== "sqlite") {
			query =
				this.state.lock === "update" ? query.forUpdate() : query.forShare();
		}
		if (this.state.limit !== undefined) query = query.limit(this.state.limit);
		if (this.state.offset !== undefined)
			query = query.offset(this.state.offset);
		return query;
	}

	#applyJoins(query: AnyBuilder): AnyBuilder {
		for (const join of this.state.joins) {
			const method =
				join.type === "left"
					? "leftJoin"
					: join.type === "right"
						? "rightJoin"
						: "innerJoin";
			query = query[method](join.table, (builder: AnyBuilder) =>
				builder.onRef(join.left, join.operator, join.right),
			);
		}
		return query;
	}

	#applyWheres(query: AnyBuilder): AnyBuilder {
		const entries = this.#scopedWheres();
		if (entries.length === 0) return query;
		return query.where(
			(eb: AnyBuilder) =>
				foldEntries(eb, entries, this.orm.dialectKind) ?? trueExpression(eb),
		);
	}

	/**
	 * The effective WHERE list: soft-delete scope first, then user predicates
	 * wrapped in one group so `a or b` stays `(deleted_at is null and (a or b))`.
	 */
	#scopedWheres(): readonly WhereEntry[] {
		const softColumn = this.#softDeleteColumn();
		if (softColumn === null || this.state.softDeleteMode === "with") {
			return this.state.wheres;
		}
		const soft: WhereEntry = {
			boolean: "and",
			predicate: {
				kind: "null",
				column: softColumn,
				not: this.state.softDeleteMode === "only",
			},
		};
		if (this.state.wheres.length === 0) return [soft];
		return [
			soft,
			{
				boolean: "and",
				predicate: { kind: "group", entries: this.state.wheres },
			},
		];
	}

	#countSubquery(eb: AnyBuilder, count: RelationCountClause): AnyBuilder {
		const descriptor = this.#requireRelation(
			this.#relations(),
			count.relation,
			"withCount",
		);
		const relatedTable = (
			descriptor.related?.() as { __table: string } | undefined
		)?.__table;
		if (relatedTable === undefined) {
			throw new InvalidQueryError(
				`withCount(${JSON.stringify(count.relation)}): relation has no target table.`,
			);
		}
		const sub = relationSubquery(
			this.orm,
			eb,
			this.tableName as string,
			this.modelClass,
			descriptor,
			count.relation,
			count.constraint.softDeleteMode,
			(inner) =>
				applyEntries(
					inner,
					count.constraint.wheres,
					this.orm.dialectKind,
					relatedTable,
				),
		);
		return sub.select((eb2: AnyBuilder) => eb2.fn.countAll().as("count"));
	}

	#aggregateSubquery(
		eb: AnyBuilder,
		aggregate: RelationAggregateClause,
	): AnyBuilder {
		const descriptor = this.#requireRelation(
			this.#relations(),
			aggregate.relation,
			"withAggregate",
		);
		const relatedTable = (
			descriptor.related?.() as { __table: string } | undefined
		)?.__table;
		if (relatedTable === undefined) {
			throw new InvalidQueryError(
				`with${aggregate.kind}(${JSON.stringify(aggregate.relation)}): relation has no target table.`,
			);
		}
		const sub = relationSubquery(
			this.orm,
			eb,
			this.tableName as string,
			this.modelClass,
			descriptor,
			aggregate.relation,
			aggregate.constraint.softDeleteMode,
			(inner) =>
				applyEntries(
					inner,
					aggregate.constraint.wheres,
					this.orm.dialectKind,
					relatedTable,
				),
		);
		const column = `${relatedTable}.${aggregate.column}`;
		return sub.select((eb2: AnyBuilder) =>
			eb2.fn[aggregate.kind](column).as("value"),
		);
	}

	async #aggregate(
		fn: "min" | "max" | "sum" | "avg",
		column: string,
	): Promise<number | string | bigint | null> {
		const executor = this.orm.executor() as AnyBuilder;
		let query: AnyBuilder = executor.selectFrom(this.tableName);
		query = this.#applyJoins(query);
		query = this.#applyWheres(query);
		query = query.select((eb: AnyBuilder) => eb.fn[fn](column).as("value"));
		const result = await this.orm.execute(query.compile());
		const value =
			(result.rows[0] as { value?: unknown } | undefined)?.value ?? null;
		if (value === null) return null;
		const definition = normalizeColumn(
			this.tableName,
			column,
			this.orm.internalMeta(this.tableName).columns[column]!,
		);
		// `decimal` is exposed as string (database-accurate precision); every
		// other aggregate input is numeric in the public types. PostgreSQL and
		// MySQL return numeric aggregate results as strings from their drivers.
		if (definition.type === "decimal") return String(value);
		if (definition.bigInt === true && fn !== "avg") {
			return typeof value === "bigint" ? value : BigInt(String(value));
		}
		return Number(value);
	}

	/** Applies the table's column conversion to one raw driver value. */
	#convertValue(meta: TableMeta, column: string, value: unknown): unknown {
		if (value === undefined || value === null) return value;
		return hydrateRow(meta.plan, { [column]: value })[column];
	}

	#cleanWriteRow(
		row: Record<string, unknown>,
		meta: TableMeta,
		options: { dropPrimaryKey?: boolean },
	): Record<string, unknown> {
		const output: Record<string, unknown> = {};
		for (const [column, value] of Object.entries(row)) {
			if (!Object.hasOwn(meta.columns, column)) {
				throw new InvalidQueryError(
					`Unknown column "${column}" on table "${meta.table}".`,
				);
			}
			if (value === undefined) continue;
			if (meta.generated.has(column)) continue;
			if (options.dropPrimaryKey === true && column === meta.primaryKey)
				continue;
			output[column] = value;
		}
		return output;
	}

	#readColumn(row: object, column: string): unknown {
		const getter = (row as { get?: (name: string) => unknown }).get;
		if (typeof getter === "function") return getter.call(row, column);
		return (row as Record<string, unknown>)[column];
	}

	#materialize(rows: Array<Record<string, unknown>>): unknown[] {
		const meta = this.orm.internalMeta(this.tableName);
		const aggregateConverters = new Map<string, (value: unknown) => unknown>();
		for (const aggregate of this.state.withAggregates) {
			const definition = this.#aggregateDefinition(aggregate);
			aggregateConverters.set(aggregate.alias, (value) => {
				if (definition.type === "decimal") return String(value);
				if (definition.bigInt === true && aggregate.kind !== "avg") {
					return typeof value === "bigint" ? value : BigInt(String(value));
				}
				return Number(value);
			});
		}
		const normalized = rows.map((row) => {
			let copy = row;
			for (const count of this.state.withCounts) {
				const value = copy[count.alias];
				if (
					value === null ||
					value === undefined ||
					typeof value === "number"
				) {
					continue;
				}
				const numeric = Number(value);
				if (!Number.isNaN(numeric)) {
					if (copy === row) copy = { ...row };
					copy[count.alias] = numeric;
				}
			}
			for (const [alias, convert] of aggregateConverters) {
				const value = copy[alias];
				if (value === null || value === undefined) continue;
				const converted = convert(value);
				if (converted !== value) {
					if (copy === row) copy = { ...row };
					copy[alias] = converted;
				}
			}
			for (const exists of this.state.withExists) {
				if (copy === row) copy = { ...row };
				copy[exists.alias] = Boolean(copy[exists.alias]);
			}
			return copy;
		});
		const converted =
			meta.plan.readers.length > 0
				? normalized.map((row) => hydrateRow(meta.plan, row))
				: normalized;
		if (this.modelClass === undefined) return converted;
		return converted.map((row) =>
			this.orm.hydrateModelRow(this.modelClass, row, true),
		);
	}

	#aggregateDefinition(aggregate: RelationAggregateClause): ColumnDefinition {
		const descriptor = this.#requireRelation(
			this.#relations(),
			aggregate.relation,
			"withAggregate",
		);
		const relatedTable = (
			descriptor.related?.() as { __table: string } | undefined
		)?.__table;
		if (relatedTable === undefined) {
			throw new InvalidQueryError(
				`with${aggregate.kind}(${JSON.stringify(aggregate.relation)}): relation has no target table.`,
			);
		}
		const relatedMeta = this.orm.internalMeta(relatedTable as never);
		const input = relatedMeta.columns[aggregate.column];
		if (input === undefined) {
			throw new InvalidQueryError(
				`with${aggregate.kind}(${JSON.stringify(aggregate.relation)}): unknown column "${aggregate.column}".`,
			);
		}
		return normalizeColumn(relatedTable, aggregate.column, input);
	}
}

/**
 * Builder handed to a `whereHas` callback for the last relation on a path.
 * Morphs-to have no concrete target, so the callback type is `never` and
 * passing one is a compile error.
 */
export type WhereHasCallback<S extends Schema, M, P extends string> = [
	FinalRelatedOf<M, P>,
] extends [never]
	? never
	: (
			group: WhereGroup<S, TableOfModel<FinalRelatedOf<M, P>> & TableName<S>>,
		) => void;

/** Callback map accepted by `with({ … })`. Morph-to paths are `never`. */
export type WithConstraints<M, S extends Schema> = {
	[P in AllRelationPathsSafe<RelationsOf<M>>]?: [FinalRelatedOf<M, P>] extends [
		never,
	]
		? never
		: (
				query: QueryBuilder<
					S,
					TableOfModel<FinalRelatedOf<M, P>> & TableName<S>,
					FinalRelatedOf<M, P>,
					unknown,
					null,
					never
				>,
			) => void;
};

/**
 * Constraint callback accepted by `withCount`/`withExists`/`withSum`/… for one
 * relation reference. Only where-clauses and `withTrashed()` survive; anything
 * else throws at build time.
 */
export type AggregateConstraintCallback<
	S extends Schema,
	M,
	P extends string,
> = [FinalRelatedOf<M, P>] extends [never]
	? never
	: (
			query: QueryBuilder<
				S,
				TableOfModel<FinalRelatedOf<M, P>> & TableName<S>,
				FinalRelatedOf<M, P>,
				unknown,
				null,
				never
			>,
		) => void;

/** Constraint map accepted by `withCount({ … })` / `withExists({ … })`. */
export type WithAggregateConstraints<M, S extends Schema> = {
	[P in
		| AggregateRelationNamesOf<M>
		| `${AggregateRelationNamesOf<M>} as ${string}`]?: AggregateConstraintCallback<
		S,
		M,
		P
	>;
};
