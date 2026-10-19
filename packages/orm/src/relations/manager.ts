// Relation write managers — Eloquent's relationship-object surface.
//
// `user.relation("posts")` returns a manager bound to that one parent row:
//
//   await user.relation("posts").create({ title: "Hello" });
//   await user.relation("tags").attach([1, 2]);
//   await user.relation("tags").sync([2, 3]);
//   await user.relation("country").associate(country);
//
// Querying through a manager is scoped to the parent (no lazy relation
// access): `user.relation("posts").query().where("published", true).get()`.

import { Collection } from "../collection";
import { InvalidQueryError, ModelNotFoundError } from "../errors";
import { emitPivotEvent } from "../model/events";
import type { ModelClass } from "../model/model";
import type { Orm } from "../orm";
import { QueryBuilder } from "../query/builder";
import { hydrateRow } from "../query/hydrate";
import { raw } from "../query/raw";
import type {
	AggregateKeyOf,
	AggregateRelationNamesOf,
	AllRelationPathsSafe,
	CreateValues,
	InstanceOf,
	LoadedUnion,
	RelationNamesOf,
	RelationsOf,
} from "../query/types";
import type {
	ColumnNameOf,
	PrimaryKeyValueOf,
	Schema,
	TableName,
} from "../schema/define";
import {
	type AnyRelationDescriptor,
	type AnyRelations,
	type ModelLike,
} from "./descriptors";
import { ofManyPredicateSql } from "./of-many";
import { preparePivotValues } from "./pivot";

/** Minimal structural model surface used by relation managers. */
interface ModelLikeStatic extends ModelLike {
	create?: (values: Record<string, unknown>) => Promise<object>;
	createMany?: (
		rows: ReadonlyArray<Record<string, unknown>>,
	) => Promise<Collection<object>>;
	__orm?: Orm<Schema>;
	__table: string;
}

/** Structural shape of a related model row returned by a manager. */
export interface RelatedRecord {
	get(column: string): unknown;
	save(): Promise<unknown>;
}

/** Injected from the model layer at construction time. */
export interface RelationManagerDeps {
	readonly internalsSymbol: symbol;
	readonly normalize: (
		modelClass: unknown,
		values: Record<string, unknown>,
		mode: "create" | "update",
	) => Record<string, unknown>;
}

interface ManagerContext {
	readonly orm: Orm<Schema>;
	readonly owner: object;
	readonly ownerMeta: {
		readonly table: string;
		readonly primaryKey: string | null;
		readonly relations: AnyRelations;
	};
	readonly descriptor: AnyRelationDescriptor;
	readonly name: string;
	readonly deps: RelationManagerDeps;
}

function internalsOf(model: object, deps: RelationManagerDeps) {
	const accessor = (
		model as unknown as Record<
			symbol,
			| (() => {
					attributes(): Record<string, unknown>;
					assign(values: Record<string, unknown>): void;
					persisted(): boolean;
			  })
			| undefined
		>
	)[deps.internalsSymbol];
	if (accessor === undefined) {
		throw new InvalidQueryError(
			"Relation manager received an object that is not a model instance.",
		);
	}
	return accessor.call(model);
}

function quoteIdentifier(name: string, dialect: string): string {
	if (dialect === "mysql") return `\`${name.replaceAll("`", "``")}\``;
	return `"${name.replaceAll('"', '""')}"`;
}

/** Soft-delete column declared by a model class, or `null`. */
function softDeleteColumnOf(modelClass: object): string | null {
	const cls = modelClass as {
		softDeletes?: boolean | { column?: string };
	};
	const config = cls.softDeletes;
	if (config === undefined || config === false) return null;
	return typeof config === "object" && config.column !== undefined
		? config.column
		: "deletedAt";
}

function requireKey(
	key: string | undefined,
	kind: string,
	relation: string,
): string {
	if (key === undefined) {
		throw new InvalidQueryError(
			`Relation "${relation}" (${kind}) is missing a required key.`,
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

function isPivotKind(kind: string): kind is "belongsToMany" | "morphToMany" {
	return kind === "belongsToMany" || kind === "morphToMany";
}

/** Operators accepted by `wherePivot` — never interpolated from user text. */
const PIVOT_OPERATORS = new Set([
	"=",
	"!=",
	"<>",
	"<",
	"<=",
	">",
	">=",
	"like",
	"not like",
]);

/**
 * Fluent relation manager for one parent model instance.
 *
 * It is deliberately *not* a lazy relation: `query()` builds a new scoped
 * builder, and every write method uses explicit SQL. Accessing `user.posts`
 * still requires eager loading.
 */
export class RelationManager {
	readonly #ctx: ManagerContext;

	/** `wherePivot` / `wherePivotIn` conditions applied to the pivot subquery. */
	#pivotWheres: Array<
		| {
				readonly kind: "basic";
				readonly column: string;
				readonly operator: string;
				readonly value: unknown;
		  }
		| {
				readonly kind: "in";
				readonly column: string;
				readonly values: unknown[];
		  }
	> = [];

	/** `orderByPivot` orders, applied as correlated pivot subqueries. */
	#pivotOrders: Array<{
		readonly column: string;
		readonly direction: "asc" | "desc";
	}> = [];

	/** @internal — use `model.relation(name)`. */
	constructor(context: ManagerContext) {
		this.#ctx = context;
	}

	#descriptor(): AnyRelationDescriptor {
		return this.#ctx.descriptor;
	}

	#assertPivotKind(caller: string): void {
		const descriptor = this.#descriptor();
		if (!isPivotKind(descriptor.kind)) {
			throw new InvalidQueryError(
				`Relation "${this.#ctx.name}" (${descriptor.kind}) does not use a pivot table; ${caller}() is unavailable.`,
			);
		}
	}

	/** Class of the parent model instance behind this manager. */
	#ownerClass(): object {
		return this.#ctx.owner.constructor;
	}

	/**
	 * Alias stored in a pivot's `${name}Type` column: the owner's for
	 * `morphToMany`, the related class's for `morphedByMany`.
	 */
	#pivotMorphAlias(descriptor: AnyRelationDescriptor): string {
		const cls =
			descriptor.inverse === true
				? (descriptor.related?.() as object | undefined)
				: this.#ownerClass();
		return this.#ctx.orm.morphAlias(cls);
	}

	/**
	 * Filters on a pivot column (Eloquent `wherePivot`). Two arguments compare
	 * with `=`, three accept the documented operators (`=`, `!=`, `<>`, `<`,
	 * `<=`, `>`, `>=`, `like`, `not like`). Chainable.
	 */
	wherePivot(column: string, value: unknown): this;
	wherePivot(column: string, operator: string, value: unknown): this;
	wherePivot(column: string, operatorOrValue: unknown, value?: unknown): this {
		this.#assertPivotKind("wherePivot");
		if (typeof operatorOrValue === "string" && value !== undefined) {
			const operator = operatorOrValue.trim().toLowerCase();
			if (!PIVOT_OPERATORS.has(operator)) {
				throw new InvalidQueryError(
					`wherePivot(): unsupported operator ${JSON.stringify(operatorOrValue)} — use =, !=, <>, <, <=, >, >=, like or not like.`,
				);
			}
			this.#pivotWheres.push({ kind: "basic", column, operator, value });
			return this;
		}
		if (value !== undefined) {
			throw new InvalidQueryError(
				`wherePivot(): unsupported operator ${JSON.stringify(operatorOrValue)} — use =, !=, <>, <, <=, >, >=, like or not like.`,
			);
		}
		this.#pivotWheres.push({
			kind: "basic",
			column,
			operator: "=",
			value: operatorOrValue,
		});
		return this;
	}

	/** Filters on a pivot column with an `IN` list (Eloquent `wherePivotIn`). */
	wherePivotIn(column: string, values: readonly unknown[]): this {
		this.#assertPivotKind("wherePivotIn");
		this.#pivotWheres.push({ kind: "in", column, values: [...values] });
		return this;
	}

	/** Orders by a pivot column (Eloquent `orderByPivot`). Chainable. */
	orderByPivot(column: string, direction: "asc" | "desc" = "asc"): this {
		this.#assertPivotKind("orderByPivot");
		if (direction !== "asc" && direction !== "desc") {
			throw new InvalidQueryError(
				`orderByPivot(): direction must be "asc" or "desc", got ${JSON.stringify(direction)}.`,
			);
		}
		this.#pivotOrders.push({ column, direction });
		return this;
	}

	/** `and <column> <op> ?` fragments for pivot filters. */
	#pivotWhereSql(dialect: string): {
		sql: string;
		parameters: unknown[];
	} {
		let sql = "";
		const parameters: unknown[] = [];
		for (const where of this.#pivotWheres) {
			if (where.kind === "in") {
				if (where.values.length === 0) {
					sql += " and 1 = 0";
					continue;
				}
				const placeholders = where.values.map(() => "?").join(", ");
				sql += ` and ${quoteIdentifier(where.column, dialect)} in (${placeholders})`;
				parameters.push(...where.values);
				continue;
			}
			sql += ` and ${quoteIdentifier(where.column, dialect)} ${where.operator} ?`;
			parameters.push(where.value);
		}
		return { sql, parameters };
	}

	#ownerAttributes(): Record<string, unknown> {
		return internalsOf(this.#ctx.owner, this.#ctx.deps).attributes();
	}

	#ownerKey(): unknown {
		const key =
			this.#descriptor().localKey ?? this.#ctx.ownerMeta.primaryKey ?? "id";
		return this.#ownerAttributes()[key];
	}

	#relatedClass(): ModelLikeStatic {
		const related = this.#descriptor().related?.() as
			| ModelLikeStatic
			| undefined;
		if (related === undefined) {
			throw new InvalidQueryError(
				`Relation "${this.#ctx.name}" has no concrete target model.`,
			);
		}
		return related;
	}

	/**
	 * Builder for a `morphTo` relation, resolved from this row's
	 * `${name}Type` value (relation types map → global morph map).
	 */
	#morphToQuery(
		descriptor: AnyRelationDescriptor,
	): QueryBuilder<
		Schema,
		TableName<Schema>,
		ModelClass<Schema, TableName<Schema>>,
		unknown,
		null,
		never
	> {
		const { idColumn, typeColumn } = morphColumnsOf(descriptor, this.#ctx.name);
		const type = this.#ownerAttributes()[typeColumn];
		const types = descriptor.types?.();
		const modelClass =
			typeof type === "string"
				? (types?.[type] ?? this.#ctx.orm.morphClass(type))
				: undefined;
		if (modelClass === undefined) {
			throw new InvalidQueryError(
				`Relation "${this.#ctx.name}" (morphTo): this row's "${typeColumn}" is ${JSON.stringify(type)} — no model class is registered for it.`,
			);
		}
		const ownerKeyColumn = descriptor.ownerKey ?? "id";
		return new QueryBuilder<
			Schema,
			TableName<Schema>,
			ModelClass<Schema, TableName<Schema>>,
			unknown,
			null,
			never
		>(
			this.#ctx.orm,
			modelClass.__table as TableName<Schema>,
			modelClass as unknown as ModelClass<Schema, TableName<Schema>>,
		).where(
			ownerKeyColumn as never,
			this.#ownerAttributes()[idColumn] as never,
		);
	}

	/** A builder scoped to this parent's related rows. */
	query(): QueryBuilder<
		Schema,
		TableName<Schema>,
		ModelClass<Schema, TableName<Schema>>,
		unknown,
		null,
		never
	> {
		const descriptor = this.#descriptor();
		const orm = this.#ctx.orm;
		const ownerKey = this.#ownerKey();
		// `morphTo` has no concrete target in the descriptor: it is resolved
		// from this row's type column (relation types map → global morph map).
		if (descriptor.kind === "morphTo") {
			return this.#morphToQuery(descriptor);
		}
		const related = this.#relatedClass();
		const relatedTable = related.__table as TableName<Schema>;
		const builder = new QueryBuilder<
			Schema,
			TableName<Schema>,
			ModelClass<Schema, TableName<Schema>>,
			unknown,
			null,
			never
		>(
			orm,
			relatedTable,
			related as unknown as ModelClass<Schema, TableName<Schema>>,
		);
		const dialect = orm.dialectKind;

		if (descriptor.kind === "hasMany" || descriptor.kind === "hasOne") {
			const foreignKey = requireKey(
				descriptor.foreignKey,
				descriptor.kind,
				this.#ctx.name,
			);
			builder.where(foreignKey as never, ownerKey as never);
			const ofMany =
				descriptor.kind === "hasOne" ? descriptor.ofMany : undefined;
			if (ofMany !== undefined) {
				const relatedMeta = orm.internalMeta(relatedTable as never);
				if (!Object.hasOwn(relatedMeta.columns, ofMany.column)) {
					throw new InvalidQueryError(
						`Relation "${this.#ctx.name}": ofMany column "${ofMany.column}" does not exist on "${relatedTable}".`,
					);
				}
				if (relatedMeta.primaryKey === null) {
					throw new InvalidQueryError(
						`Relation "${this.#ctx.name}": table "${relatedTable}" needs a primary key for one-of-many selection.`,
					);
				}
				const softColumn = softDeleteColumnOf(related);
				builder.whereRaw(
					ofManyPredicateSql(dialect, {
						table: relatedTable,
						column: ofMany.column,
						aggregate: ofMany.aggregate,
						foreignKey,
						primaryKey: relatedMeta.primaryKey,
						correlate: { kind: "value", column: foreignKey, value: ownerKey },
						soft:
							softColumn === null
								? undefined
								: { column: softColumn, mode: "default" },
					}),
				);
			}
			return builder;
		}

		if (descriptor.kind === "morphMany" || descriptor.kind === "morphOne") {
			const { idColumn, typeColumn } = morphColumnsOf(
				descriptor,
				this.#ctx.name,
			);
			builder
				.where(idColumn as never, ownerKey as never)
				.where(
					typeColumn as never,
					this.#ctx.orm.morphAlias(this.#ownerClass()) as never,
				);
			return builder;
		}

		if (descriptor.kind === "belongsTo") {
			const foreignKey = requireKey(
				descriptor.foreignKey,
				descriptor.kind,
				this.#ctx.name,
			);
			const ownerKeyColumn = descriptor.ownerKey ?? "id";
			const foreignValue = this.#ownerAttributes()[foreignKey];
			if (foreignValue === null || foreignValue === undefined) {
				builder.whereRaw(raw("1 = 0"));
			} else {
				builder.where(ownerKeyColumn as never, foreignValue as never);
			}
			return builder;
		}

		if (
			descriptor.kind === "hasManyThrough" ||
			descriptor.kind === "hasOneThrough"
		) {
			const throughThunk = descriptor.through;
			if (typeof throughThunk !== "function") {
				throw new InvalidQueryError(
					`Relation "${this.#ctx.name}" (${descriptor.kind}) needs a through model.`,
				);
			}
			const throughClass = throughThunk() as ModelLikeStatic;
			const throughTable = throughClass.__table;
			const firstKey = requireKey(
				descriptor.firstKey,
				descriptor.kind,
				this.#ctx.name,
			);
			const secondKey = requireKey(
				descriptor.secondKey,
				descriptor.kind,
				this.#ctx.name,
			);
			const throughMeta = orm.internalMeta(throughTable as never);
			const secondLocalKey =
				descriptor.secondLocalKey ?? throughMeta.primaryKey ?? "id";
			const sqlText = `${quoteIdentifier(relatedTable, dialect)}.${quoteIdentifier(
				secondKey,
				dialect,
			)} in (select ${quoteIdentifier(secondLocalKey, dialect)} from ${quoteIdentifier(
				throughTable,
				dialect,
			)} where ${quoteIdentifier(firstKey, dialect)} = ?)`;
			builder.whereRaw(raw(sqlText, [ownerKey]));
			return builder;
		}

		if (isPivotKind(descriptor.kind)) {
			const through = descriptor.through;
			if (typeof through !== "string") {
				throw new InvalidQueryError(
					`Relation "${this.#ctx.name}" (${descriptor.kind}) needs a pivot table.`,
				);
			}
			const foreignPivotKey = requireKey(
				descriptor.foreignPivotKey,
				descriptor.kind,
				this.#ctx.name,
			);
			const relatedPivotKey = requireKey(
				descriptor.relatedPivotKey,
				descriptor.kind,
				this.#ctx.name,
			);
			const relatedMeta = orm.internalMeta(relatedTable as never);
			const relatedPk = relatedMeta.primaryKey;
			if (relatedPk === null) {
				throw new InvalidQueryError(
					`Relation "${this.#ctx.name}": "${relatedTable}" needs a primary key.`,
				);
			}
			const morphName =
				descriptor.kind === "morphToMany" ? descriptor.morphName : undefined;
			if (descriptor.kind === "morphToMany" && morphName === undefined) {
				throw new InvalidQueryError(
					`Relation "${this.#ctx.name}": morphToMany needs a morph name.`,
				);
			}
			let sqlText = `${quoteIdentifier(relatedTable, dialect)}.${quoteIdentifier(
				relatedPk,
				dialect,
			)} in (select ${quoteIdentifier(relatedPivotKey, dialect)} from ${quoteIdentifier(
				through,
				dialect,
			)} where ${quoteIdentifier(foreignPivotKey, dialect)} = ?`;
			const parameters: unknown[] = [ownerKey];
			if (morphName !== undefined) {
				sqlText += ` and ${quoteIdentifier(`${morphName}Type`, dialect)} = ?`;
				parameters.push(this.#pivotMorphAlias(descriptor));
			}
			const pivotFilters = this.#pivotWhereSql(dialect);
			sqlText += pivotFilters.sql;
			parameters.push(...pivotFilters.parameters);
			sqlText += ")";
			builder.whereRaw(raw(sqlText, parameters));
			// `orderByPivot`: one correlated scalar subquery per order, reading
			// the pivot row that satisfies the same pivot filters.
			for (const order of this.#pivotOrders) {
				const conditions = this.#pivotWhereSql(dialect);
				let orderSql =
					`(select ${quoteIdentifier(order.column, dialect)} from ${quoteIdentifier(through, dialect)} where ` +
					`${quoteIdentifier(relatedPivotKey, dialect)} = ${quoteIdentifier(relatedTable, dialect)}.${quoteIdentifier(relatedPk, dialect)}` +
					` and ${quoteIdentifier(foreignPivotKey, dialect)} = ?`;
				const orderParameters: unknown[] = [ownerKey];
				if (morphName !== undefined) {
					orderSql += ` and ${quoteIdentifier(`${morphName}Type`, dialect)} = ?`;
					orderParameters.push(this.#pivotMorphAlias(descriptor));
				}
				orderSql += `${conditions.sql} limit 1) ${order.direction}`;
				orderParameters.push(...conditions.parameters);
				builder.orderByRaw(raw(orderSql, orderParameters));
			}
			return builder;
		}

		throw new InvalidQueryError(
			`Relation "${this.#ctx.name}" (${descriptor.kind}) cannot be queried through a manager.`,
		);
	}

	// -----------------------------------------------------------------------
	// writes: has-one / has-many / morph-one / morph-many / morph-to
	// -----------------------------------------------------------------------

	/** Adds the parent key to a related instance and saves it. */
	async save(model: object): Promise<RelatedRecord> {
		const descriptor = this.#descriptor();
		const attributes = internalsOf(model, this.#ctx.deps);
		const ownerKey = this.#ownerKey();
		if (descriptor.kind === "hasMany" || descriptor.kind === "hasOne") {
			const foreignKey = requireKey(
				descriptor.foreignKey,
				descriptor.kind,
				this.#ctx.name,
			);
			attributes.assign({ [foreignKey]: ownerKey });
			await (model as { save(): Promise<unknown> }).save();
			return model as RelatedRecord;
		}
		if (descriptor.kind === "morphMany" || descriptor.kind === "morphOne") {
			const { idColumn, typeColumn } = morphColumnsOf(
				descriptor,
				this.#ctx.name,
			);
			attributes.assign({
				[idColumn]: ownerKey,
				[typeColumn]: this.#ctx.orm.morphAlias(this.#ownerClass()),
			});
			await (model as { save(): Promise<unknown> }).save();
			return model as RelatedRecord;
		}
		if (descriptor.kind === "belongsTo") {
			return this.associate(model) as RelatedRecord;
		}
		if (descriptor.kind === "morphTo") {
			return this.associate(model) as RelatedRecord;
		}
		if (isPivotKind(descriptor.kind)) {
			await (model as { save(): Promise<unknown> }).save();
			const pk = this.#relatedPrimaryKey();
			const id = internalsOf(model, this.#ctx.deps).attributes()[pk];
			await this.attach([id]);
			return model as RelatedRecord;
		}
		throw new InvalidQueryError(
			`Relation "${this.#ctx.name}" (${descriptor.kind}) does not support save().`,
		);
	}

	/** Saves many related instances. */
	async saveMany(
		models: readonly object[],
	): Promise<Collection<RelatedRecord>> {
		const saved: RelatedRecord[] = [];
		for (const model of models) saved.push(await this.save(model));
		return Collection.make(saved);
	}

	/** Creates a related row with the parent key applied. */
	async create(values: Record<string, unknown>): Promise<RelatedRecord> {
		const descriptor = this.#descriptor();
		const related = this.#relatedClass();
		const payload = { ...values };
		const ownerKey = this.#ownerKey();
		if (descriptor.kind === "hasMany" || descriptor.kind === "hasOne") {
			payload[
				requireKey(descriptor.foreignKey, descriptor.kind, this.#ctx.name)
			] = ownerKey;
		} else if (
			descriptor.kind === "morphMany" ||
			descriptor.kind === "morphOne"
		) {
			const { idColumn, typeColumn } = morphColumnsOf(
				descriptor,
				this.#ctx.name,
			);
			payload[idColumn] = ownerKey;
			payload[typeColumn] = this.#ctx.orm.morphAlias(this.#ownerClass());
		} else if (
			descriptor.kind === "belongsTo" ||
			descriptor.kind === "morphTo"
		) {
			const instance = await this.#createInstance(related, payload);
			await this.associate(instance);
			return instance;
		} else if (isPivotKind(descriptor.kind)) {
			const instance = await this.#createInstance(related, payload);
			const pk = this.#relatedPrimaryKey();
			const id = internalsOf(instance, this.#ctx.deps).attributes()[pk];
			await this.attach([id]);
			return instance;
		} else {
			throw new InvalidQueryError(
				`Relation "${this.#ctx.name}" (${descriptor.kind}) does not support create().`,
			);
		}
		return this.#createInstance(related, payload);
	}

	/** Creates many related rows. */
	async createMany(
		rows: ReadonlyArray<Record<string, unknown>>,
	): Promise<Collection<RelatedRecord>> {
		const created: RelatedRecord[] = [];
		for (const row of rows) created.push(await this.create(row));
		return Collection.make(created);
	}

	async #createInstance(
		related: ModelLikeStatic,
		values: Record<string, unknown>,
	): Promise<RelatedRecord> {
		const normalized = this.#ctx.deps.normalize(related, values, "create");
		const instance = this.#ctx.orm.hydrateModelRow(
			related,
			{},
			false,
		) as object & Record<string, unknown>;
		internalsOf(instance, this.#ctx.deps).assign(normalized);
		const saved = await (
			instance as unknown as { save(): Promise<unknown> }
		).save();
		if (saved === false) {
			throw new InvalidQueryError(
				`Relation "${this.#ctx.name}": creating a related model was cancelled by an event listener.`,
			);
		}
		return instance as unknown as RelatedRecord;
	}

	// -----------------------------------------------------------------------
	// belongsTo / morphTo association
	// -----------------------------------------------------------------------

	/** Associates a belongsTo/morphTo target with this parent (local change). */
	associate(model: object): object {
		const descriptor = this.#descriptor();
		const related = (model.constructor as ModelLikeStatic).__table;
		if (related === undefined) {
			throw new InvalidQueryError("associate(): expected a model instance.");
		}
		const target = internalsOf(model, this.#ctx.deps).attributes();
		if (descriptor.kind === "belongsTo") {
			const foreignKey = requireKey(
				descriptor.foreignKey,
				descriptor.kind,
				this.#ctx.name,
			);
			const ownerKey = descriptor.ownerKey ?? "id";
			internalsOf(this.#ctx.owner, this.#ctx.deps).assign({
				[foreignKey]: target[ownerKey],
			});
			return this.#ctx.owner;
		}
		if (descriptor.kind === "morphTo") {
			const { idColumn, typeColumn } = morphColumnsOf(
				descriptor,
				this.#ctx.name,
			);
			const ownerKey = descriptor.ownerKey ?? "id";
			internalsOf(this.#ctx.owner, this.#ctx.deps).assign({
				[idColumn]: target[ownerKey],
				[typeColumn]: this.#ctx.orm.morphAlias(model.constructor),
			});
			return this.#ctx.owner;
		}
		throw new InvalidQueryError(
			`Relation "${this.#ctx.name}" (${descriptor.kind}) does not support associate().`,
		);
	}

	/** Clears a belongsTo/morphTo association (local change). */
	dissociate(): object {
		const descriptor = this.#descriptor();
		if (descriptor.kind === "belongsTo") {
			const foreignKey = requireKey(
				descriptor.foreignKey,
				descriptor.kind,
				this.#ctx.name,
			);
			internalsOf(this.#ctx.owner, this.#ctx.deps).assign({
				[foreignKey]: null,
			});
			return this.#ctx.owner;
		}
		if (descriptor.kind === "morphTo") {
			const { idColumn, typeColumn } = morphColumnsOf(
				descriptor,
				this.#ctx.name,
			);
			internalsOf(this.#ctx.owner, this.#ctx.deps).assign({
				[idColumn]: null,
				[typeColumn]: null,
			});
			return this.#ctx.owner;
		}
		throw new InvalidQueryError(
			`Relation "${this.#ctx.name}" (${descriptor.kind}) does not support dissociate().`,
		);
	}

	// -----------------------------------------------------------------------
	// pivot writes
	// -----------------------------------------------------------------------

	#pivotInfo(): {
		through: string;
		foreignPivotKey: string;
		relatedPivotKey: string;
		ownerKey: unknown;
		morphType: string | null;
	} {
		const descriptor = this.#descriptor();
		if (!isPivotKind(descriptor.kind)) {
			throw new InvalidQueryError(
				`Relation "${this.#ctx.name}" (${descriptor.kind}) does not use a pivot table.`,
			);
		}
		const through = descriptor.through;
		if (typeof through !== "string") {
			throw new InvalidQueryError(
				`Relation "${this.#ctx.name}" needs a pivot table name.`,
			);
		}
		const morphType =
			descriptor.kind === "morphToMany"
				? this.#pivotMorphAlias(descriptor)
				: null;
		return {
			through,
			foreignPivotKey: requireKey(
				descriptor.foreignPivotKey,
				descriptor.kind,
				this.#ctx.name,
			),
			relatedPivotKey: requireKey(
				descriptor.relatedPivotKey,
				descriptor.kind,
				this.#ctx.name,
			),
			ownerKey: this.#ownerKey(),
			morphType,
		};
	}

	#pivotValues(id: unknown, attributes: Record<string, unknown> = {}) {
		const pivot = this.#pivotInfo();
		const values: Record<string, unknown> = {
			...attributes,
			[pivot.foreignPivotKey]: pivot.ownerKey,
			[pivot.relatedPivotKey]: id,
		};
		if (pivot.morphType !== null) {
			const morphName = this.#descriptor().morphName;
			if (morphName !== undefined) values[`${morphName}Type`] = pivot.morphType;
		}
		// `timestamps` on the relation also stamps newly attached pivot rows.
		const timestamps = this.#descriptor().pivotTimestamps;
		if (timestamps !== undefined) {
			const now = new Date();
			for (const column of timestamps) {
				if (values[column] === undefined) values[column] = now;
			}
		}
		return values;
	}

	/** Inserts pivot rows (`attach`). */
	async attach(
		ids: unknown | readonly unknown[],
		attributes: Record<string, unknown> = {},
	): Promise<number> {
		const list = Array.isArray(ids) ? ids : [ids];
		if (list.length === 0) return 0;
		// Eloquent fires pivot events on the parent model; `pivotAttaching`
		// may cancel the write by returning `false`.
		if (!(await this.#pivotEvent("pivotAttaching", list, attributes))) {
			return 0;
		}
		const pivot = this.#pivotInfo();
		const rows = list.map((id) => this.#pivotValues(id, attributes));
		const pivotClass = this.#descriptor().pivotClass;
		const prepared =
			pivotClass === undefined
				? rows
				: rows.map((row) =>
						preparePivotValues(pivotClass, row, this.#ctx.orm.encryptionKey),
					);
		const executor = this.#ctx.orm.executor() as unknown as {
			insertInto(table: string): {
				values(values: unknown): {
					compile(): unknown;
				};
			};
		};
		const compiled = executor
			.insertInto(pivot.through)
			.values(prepared.length === 1 ? prepared[0] : prepared)
			.compile();
		const result = await this.#ctx.orm.execute(compiled as never);
		await this.#pivotEvent("pivotAttached", list, attributes);
		return Number(result.numAffectedRows ?? rows.length);
	}

	/** Deletes pivot rows; with no ids, deletes every row for this parent. */
	async detach(ids?: unknown | readonly unknown[]): Promise<number> {
		const pivot = this.#pivotInfo();
		const list =
			ids === undefined ? null : Array.isArray(ids) ? [...ids] : [ids];
		if (list !== null && list.length === 0) return 0;
		if (!(await this.#pivotEvent("pivotDetaching", list, {}))) return 0;
		const executor = this.#ctx.orm.executor() as unknown as {
			deleteFrom(table: string): {
				where(column: string, op: string, value: unknown): unknown;
				compile(): unknown;
			};
		};
		let query = executor
			.deleteFrom(pivot.through)
			.where(pivot.foreignPivotKey, "=", pivot.ownerKey) as unknown as {
			where(column: string, op: string, value: unknown): unknown;
			compile(): unknown;
		};
		if (pivot.morphType !== null) {
			const morphName = this.#descriptor().morphName;
			if (morphName !== undefined) {
				query = query.where(`${morphName}Type`, "=", pivot.morphType) as never;
			}
		}
		if (list !== null) {
			query = query.where(pivot.relatedPivotKey, "in", list) as never;
		}
		const result = await this.#ctx.orm.execute(query.compile() as never);
		await this.#pivotEvent("pivotDetached", list, {});
		return Number(result.numAffectedRows ?? 0);
	}

	/** Emits a pivot event on the parent model class. */
	#pivotEvent(
		event:
			| "pivotAttaching"
			| "pivotAttached"
			| "pivotDetaching"
			| "pivotDetached"
			| "pivotUpdating"
			| "pivotUpdated",
		ids: readonly unknown[] | null,
		attributes: Record<string, unknown>,
	): Promise<boolean> {
		return emitPivotEvent(this.#ownerClass(), event, {
			model: this.#ctx.owner,
			relation: this.#ctx.name,
			ids,
			attributes,
		});
	}

	/** Current related ids stored in the pivot table. */
	async #currentPivotIds(): Promise<unknown[]> {
		const pivot = this.#pivotInfo();
		const executor = this.#ctx.orm.executor() as unknown as {
			selectFrom(table: string): {
				select(column: string): unknown;
				where(column: string, op: string, value: unknown): unknown;
				compile(): unknown;
			};
		};
		const selected = executor
			.selectFrom(pivot.through)
			.select(pivot.relatedPivotKey) as unknown as {
			where(column: string, op: string, value: unknown): unknown;
			compile(): unknown;
		};
		let query = selected.where(
			pivot.foreignPivotKey,
			"=",
			pivot.ownerKey,
		) as unknown as {
			where(column: string, op: string, value: unknown): unknown;
			compile(): unknown;
		};
		if (pivot.morphType !== null) {
			const morphName = this.#descriptor().morphName;
			if (morphName !== undefined) {
				query = query.where(`${morphName}Type`, "=", pivot.morphType) as never;
			}
		}
		const result = await this.#ctx.orm.execute(query.compile() as never);
		const related = this.#relatedClass();
		const relatedMeta = this.#ctx.orm.internalMeta(related.__table as never);
		const relatedPk = relatedMeta.primaryKey ?? "id";
		return (result.rows as Array<Record<string, unknown>>).map(
			(row) =>
				hydrateRow(relatedMeta.plan, {
					[relatedPk]: row[pivot.relatedPivotKey],
				})[relatedPk],
		);
	}

	/** Synchronizes the pivot table with `ids`. */
	async sync(
		ids: readonly unknown[],
		detaching = true,
	): Promise<{ attached: unknown[]; detached: unknown[]; updated: unknown[] }> {
		const normalized = [...new Set(ids)];
		const current = await this.#currentPivotIds();
		const currentSet = new Set(current);
		const nextSet = new Set(normalized);
		const attached = normalized.filter((id) => !currentSet.has(id));
		const detached = current.filter((id) => !nextSet.has(id));
		if (attached.length > 0) await this.attach(attached);
		if (detaching && detached.length > 0) await this.detach(detached);
		return { attached, detached: detaching ? detached : [], updated: [] };
	}

	/** Syncs without detaching missing ids. */
	syncWithoutDetaching(
		ids: readonly unknown[],
	): Promise<{ attached: unknown[]; detached: unknown[]; updated: unknown[] }> {
		return this.sync(ids, false);
	}

	/** Toggles ids: present rows are detached, absent rows attached. */
	async toggle(
		ids: readonly unknown[],
	): Promise<{ attached: unknown[]; detached: unknown[] }> {
		const current = new Set(await this.#currentPivotIds());
		const attached: unknown[] = [];
		const detached: unknown[] = [];
		for (const id of ids) {
			if (current.has(id)) detached.push(id);
			else attached.push(id);
		}
		if (attached.length > 0) await this.attach(attached);
		if (detached.length > 0) await this.detach(detached);
		return { attached, detached };
	}

	/** Updates pivot columns for one related id. */
	async updateExistingPivot(
		id: unknown,
		attributes: Record<string, unknown>,
	): Promise<number> {
		if (!(await this.#pivotEvent("pivotUpdating", [id], attributes))) {
			return 0;
		}
		const pivot = this.#pivotInfo();
		const executor = this.#ctx.orm.executor() as unknown as {
			updateTable(table: string): {
				set(values: Record<string, unknown>): unknown;
				where(column: string, op: string, value: unknown): unknown;
				compile(): unknown;
			};
		};
		// `timestamps` refreshes the pivot `updatedAt` unless the caller set it.
		const timestamps = this.#descriptor().pivotTimestamps;
		const rawValues =
			timestamps === undefined || Object.hasOwn(attributes, timestamps[1])
				? attributes
				: { ...attributes, [timestamps[1]]: new Date() };
		// Custom pivot models (`using`) prepare write values through casts.
		const pivotClass = this.#descriptor().pivotClass;
		const values =
			pivotClass === undefined
				? rawValues
				: preparePivotValues(
						pivotClass,
						rawValues,
						this.#ctx.orm.encryptionKey,
					);
		const updated = executor
			.updateTable(pivot.through)
			.set(values) as unknown as {
			where(column: string, op: string, value: unknown): unknown;
			compile(): unknown;
		};
		let query = updated.where(
			pivot.foreignPivotKey,
			"=",
			pivot.ownerKey,
		) as unknown as {
			where(column: string, op: string, value: unknown): unknown;
			compile(): unknown;
		};
		if (pivot.morphType !== null) {
			const morphName = this.#descriptor().morphName;
			if (morphName !== undefined) {
				query = query.where(`${morphName}Type`, "=", pivot.morphType) as never;
			}
		}
		query = query.where(pivot.relatedPivotKey, "=", id) as never;
		const result = await this.#ctx.orm.execute(query.compile() as never);
		await this.#pivotEvent("pivotUpdated", [id], attributes);
		return Number(result.numAffectedRows ?? 0);
	}

	/** Attaches missing ids and updates all listed pivot rows with `values`. */
	async syncWithPivotValues(
		ids: readonly unknown[],
		values: Record<string, unknown>,
	): Promise<{ attached: unknown[]; detached: unknown[]; updated: unknown[] }> {
		const result = await this.sync(ids);
		for (const id of ids) await this.updateExistingPivot(id, values);
		result.updated = [...ids];
		return result;
	}

	/** First row of this relation (convenience around `query().first()`). */
	async first(): Promise<RelatedRecord | null> {
		return (await this.query().first()) as RelatedRecord | null;
	}

	/** All related rows (convenience around `query().get()`). */
	async get(): Promise<Collection<RelatedRecord>> {
		return Collection.make((await this.query().get()) as RelatedRecord[]);
	}

	/** Count of related rows. */
	async count(): Promise<number> {
		return this.query().count();
	}

	/** Finds one related row by primary key inside this relation. */
	async find(id: unknown): Promise<RelatedRecord | null> {
		const pk = this.#relatedPrimaryKey();
		return (await this.query()
			.where(pk as never, id as never)
			.first()) as RelatedRecord | null;
	}

	/** Finds one related row or throws. */
	async findOrFail(id: unknown): Promise<RelatedRecord> {
		const row = await this.find(id);
		if (row === null) {
			throw new ModelNotFoundError(this.#relatedClass().__table, id);
		}
		return row;
	}

	/** Whether this relation contains the given related id. */
	async has(id: unknown): Promise<boolean> {
		return (await this.find(id)) !== null;
	}

	#relatedPrimaryKey(): string {
		const related = this.#relatedClass();
		return (
			this.#ctx.orm.internalMeta(related.__table as never).primaryKey ?? "id"
		);
	}
}

// ---------------------------------------------------------------------------
// Typed relation-manager surface
// ---------------------------------------------------------------------------

/** Table of the related model (falls back to `never` for morphTo). */
export type RelatedTableOf<D> = D extends { related: () => infer R }
	? R extends { __table: infer T extends string }
		? T extends TableName<Schema>
			? T
			: never
		: never
	: never;

/** Primary-key value of the related model (using its own schema link). */
export type RelatedPkOf<D> = D extends { related: () => infer R }
	? R extends {
			readonly __schema?: infer S extends Schema;
			readonly __table: infer T extends string;
		}
		? T extends TableName<S>
			? PrimaryKeyValueOf<S, T>
			: unknown
		: unknown
	: unknown;

type ManagerQueryOf<D> = QueryBuilder<
	Schema,
	RelatedTableOf<D>,
	RelatedClassOf<D>,
	unknown,
	null,
	never
>;

type RelatedClassOf<D> = D extends { related: () => infer R } ? R : never;

/** Methods available on every relation manager. */
interface ManagerBase<D> {
	query(): ManagerQueryOf<D>;
	get(): Promise<Collection<InstanceOf<RelatedClassOf<D>>>>;
	first(): Promise<InstanceOf<RelatedClassOf<D>> | null>;
	count(): Promise<number>;
	find(id: RelatedPkOf<D>): Promise<InstanceOf<RelatedClassOf<D>> | null>;
	findOrFail(id: RelatedPkOf<D>): Promise<InstanceOf<RelatedClassOf<D>>>;
	has(id: RelatedPkOf<D>): Promise<boolean>;
}

type CreateValuesOf<D> =
	RelatedTableOf<D> extends TableName<Schema>
		? CreateValues<RelatedClassOf<D>, Schema, RelatedTableOf<D>>
		: Record<string, unknown>;

/** Conditional write surface, derived from the descriptor kind. */
export type RelationManagerOf<
	M,
	K extends string,
> = K extends keyof RelationsOf<M>
	? RelationsOf<M>[K] extends infer D extends AnyRelationDescriptor
		? ManagerBase<D> &
				(D extends { kind: "belongsTo" } | { kind: "morphTo" }
					? {
							associate(model: InstanceOf<RelatedClassOf<D>>): InstanceOf<M>;
							dissociate(): InstanceOf<M>;
							create(
								values: CreateValuesOf<D>,
							): Promise<InstanceOf<RelatedClassOf<D>>>;
						}
					: D extends {
								kind: "hasMany" | "hasOne" | "morphMany" | "morphOne";
							}
						? {
								create(
									values: CreateValuesOf<D>,
								): Promise<InstanceOf<RelatedClassOf<D>>>;
								createMany(
									rows: ReadonlyArray<CreateValuesOf<D>>,
								): Promise<Collection<InstanceOf<RelatedClassOf<D>>>>;
								save(
									model: InstanceOf<RelatedClassOf<D>>,
								): Promise<InstanceOf<RelatedClassOf<D>>>;
								saveMany(
									models: ReadonlyArray<InstanceOf<RelatedClassOf<D>>>,
								): Promise<Collection<InstanceOf<RelatedClassOf<D>>>>;
							}
						: D extends {
									kind: "belongsToMany" | "morphToMany";
								}
							? {
									create(
										values: CreateValuesOf<D>,
									): Promise<InstanceOf<RelatedClassOf<D>>>;
									createMany(
										rows: ReadonlyArray<CreateValuesOf<D>>,
									): Promise<Collection<InstanceOf<RelatedClassOf<D>>>>;
									save(
										model: InstanceOf<RelatedClassOf<D>>,
									): Promise<InstanceOf<RelatedClassOf<D>>>;
									saveMany(
										models: ReadonlyArray<InstanceOf<RelatedClassOf<D>>>,
									): Promise<Collection<InstanceOf<RelatedClassOf<D>>>>;
									attach(
										ids: RelatedPkOf<D> | ReadonlyArray<RelatedPkOf<D>>,
										attributes?: Record<string, unknown>,
									): Promise<number>;
									detach(
										ids?: RelatedPkOf<D> | ReadonlyArray<RelatedPkOf<D>>,
									): Promise<number>;
									sync(
										ids: ReadonlyArray<RelatedPkOf<D>>,
										detaching?: boolean,
									): Promise<{
										attached: RelatedPkOf<D>[];
										detached: RelatedPkOf<D>[];
										updated: RelatedPkOf<D>[];
									}>;
									syncWithoutDetaching(
										ids: ReadonlyArray<RelatedPkOf<D>>,
									): Promise<{
										attached: RelatedPkOf<D>[];
										detached: RelatedPkOf<D>[];
										updated: RelatedPkOf<D>[];
									}>;
									toggle(ids: ReadonlyArray<RelatedPkOf<D>>): Promise<{
										attached: RelatedPkOf<D>[];
										detached: RelatedPkOf<D>[];
									}>;
									updateExistingPivot(
										id: RelatedPkOf<D>,
										attributes: Record<string, unknown>,
									): Promise<number>;
									syncWithPivotValues(
										ids: ReadonlyArray<RelatedPkOf<D>>,
										values: Record<string, unknown>,
									): Promise<{
										attached: RelatedPkOf<D>[];
										detached: RelatedPkOf<D>[];
										updated: RelatedPkOf<D>[];
									}>;
									wherePivot(
										column: string,
										value: unknown,
									): RelationManagerOf<M, K>;
									wherePivot(
										column: string,
										operator: string,
										value: unknown,
									): RelationManagerOf<M, K>;
									wherePivotIn(
										column: string,
										values: readonly unknown[],
									): RelationManagerOf<M, K>;
									orderByPivot(
										column: string,
										direction?: "asc" | "desc",
									): RelationManagerOf<M, K>;
								}
							: Record<never, never>)
		: never
	: never;

/** Load-related helpers appended to every model instance. */
export interface RelationInstanceExtras<M> {
	relation<K extends RelationNamesOf<M>>(name: K): RelationManagerOf<M, K>;
	load<P extends AllRelationPathsSafe<RelationsOf<M>>>(
		...paths: P[]
	): Promise<this & LoadedUnion<M, P>>;
	loadMissing<P extends AllRelationPathsSafe<RelationsOf<M>>>(
		...paths: P[]
	): Promise<this & LoadedUnion<M, P>>;
	loadCount<
		P extends
			| AggregateRelationNamesOf<M>
			| `${AggregateRelationNamesOf<M>} as ${string}`,
	>(
		...references: P[]
	): Promise<this & { [K in P as AggregateKeyOf<K, "Count">]: number }>;
	loadSum<
		P extends
			| AggregateRelationNamesOf<M>
			| `${AggregateRelationNamesOf<M>} as ${string}`,
		C extends ColumnNameOf<
			Schema,
			RelatedTableOf<RelationsOf<M>[P & keyof RelationsOf<M>]>
		>,
	>(
		reference: P,
		column: C,
	): Promise<
		this & { [K in P as AggregateKeyOf<K, `Sum${Capitalize<C>}`>]: number }
	>;
	loadAvg<
		P extends
			| AggregateRelationNamesOf<M>
			| `${AggregateRelationNamesOf<M>} as ${string}`,
		C extends ColumnNameOf<
			Schema,
			RelatedTableOf<RelationsOf<M>[P & keyof RelationsOf<M>]>
		>,
	>(
		reference: P,
		column: C,
	): Promise<
		this & { [K in P as AggregateKeyOf<K, `Avg${Capitalize<C>}`>]: number }
	>;
	loadMin<
		P extends
			| AggregateRelationNamesOf<M>
			| `${AggregateRelationNamesOf<M>} as ${string}`,
		C extends ColumnNameOf<
			Schema,
			RelatedTableOf<RelationsOf<M>[P & keyof RelationsOf<M>]>
		>,
	>(
		reference: P,
		column: C,
	): Promise<
		this & { [K in P as AggregateKeyOf<K, `Min${Capitalize<C>}`>]: number }
	>;
	loadMax<
		P extends
			| AggregateRelationNamesOf<M>
			| `${AggregateRelationNamesOf<M>} as ${string}`,
		C extends ColumnNameOf<
			Schema,
			RelatedTableOf<RelationsOf<M>[P & keyof RelationsOf<M>]>
		>,
	>(
		reference: P,
		column: C,
	): Promise<
		this & { [K in P as AggregateKeyOf<K, `Max${Capitalize<C>}`>]: number }
	>;
}

/** Relation names and target exports used by `RelationInstanceExtras`. */
export type RelationManagerRelationNames<M> = RelationNamesOf<M>;

/** Runtime dependency bundle used by the model layer. */
export function createRelationManager(
	context: ManagerContext,
): RelationManager {
	return new RelationManager(context);
}
