// Batched eager loading.
//
// `with("posts.comments", "team")` is resolved into a tree, then each level is
// loaded with ONE query per relation (plus one extra for pivots / constrained
// through-relations) and attached to every parent instance. No lazy loading
// exists — accessing a relation that was not eager loaded throws
// `RelationNotLoadedError`.
//
// Supported kinds: hasMany, hasOne, belongsTo, belongsToMany, morphMany,
// morphOne, morphTo (one query per distinct type), morphToMany,
// hasManyThrough and hasOneThrough. Constraints declared through
// `with({ posts: (q) => q.where(...) })` are applied to the related query.

import { Collection } from "../collection";
import { InvalidQueryError } from "../errors";
import {
	emitRetrieved,
	MODEL_INTERNALS,
	type ModelInternals,
	type ModelMeta,
	type ModelStaticLike,
	resolveModelMeta,
} from "../model/model";
import type { Orm } from "../orm";
import { QueryBuilder } from "../query/builder";
import { hydrateRow } from "../query/hydrate";
import type { Schema } from "../schema/define";
import { type AnyRelationDescriptor, relationAt } from "./descriptors";
import { ofManyPredicateSql, pickOfMany } from "./of-many";
import { instantiatePivot } from "./pivot";

/** Internal compile boundary. */
type AnyStatement = any;

/** One eager-load entry passed to the loader. */
export interface EagerPath {
	readonly path: string;
	readonly constrain?: (query: unknown) => void;
}

interface EagerNode {
	readonly children: Map<string, EagerNode>;
	readonly constraints: Array<(query: unknown) => void>;
}

interface HasInternals {
	[MODEL_INTERNALS](): ModelInternals;
}

function internalsOf(model: object): ModelInternals {
	return (model as unknown as HasInternals)[MODEL_INTERNALS]();
}

function buildTree(paths: readonly EagerPath[]): EagerNode {
	const root: EagerNode = { children: new Map(), constraints: [] };
	for (const entry of paths) {
		let node = root;
		for (const segment of entry.path.split(".")) {
			if (segment === "") {
				throw new InvalidQueryError(
					`Invalid relation path ${JSON.stringify(entry.path)}.`,
				);
			}
			let child = node.children.get(segment);
			if (child === undefined) {
				child = { children: new Map(), constraints: [] };
				node.children.set(segment, child);
			}
			node = child;
		}
		if (entry.constrain !== undefined) node.constraints.push(entry.constrain);
	}
	return root;
}

/**
 * Eager-loads `paths` onto hydrated `parents`.
 * @internal
 */
export async function eagerLoad(
	orm: Orm<Schema>,
	parents: object[],
	paths: readonly EagerPath[],
): Promise<void> {
	if (parents.length === 0 || paths.length === 0) return;
	await loadBranch(orm, parents, buildTree(paths));
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

function distinctKeys(parents: object[], key: string): unknown[] {
	const keys: unknown[] = [];
	const seen = new Set<unknown>();
	for (const parent of parents) {
		const value = internalsOf(parent).attributes()[key];
		if (value === null || value === undefined || seen.has(value)) continue;
		seen.add(value);
		keys.push(value);
	}
	return keys;
}

function softDeleteColumnOf(
	orm: Orm<Schema>,
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
				`Soft-delete column "${column}" does not exist on "${table}".`,
			);
		}
	}
	return column;
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

async function queryRelated(
	orm: Orm<Schema>,
	relatedTable: string,
	relatedClass: ModelStaticLike,
	column: string,
	keys: readonly unknown[],
	constraints: ReadonlyArray<(query: unknown) => void>,
	extra?: (
		builder: QueryBuilder<
			Schema,
			string,
			ModelStaticLike,
			unknown,
			null,
			never
		>,
	) => void,
): Promise<object[]> {
	const builder = new QueryBuilder<
		Schema,
		string,
		ModelStaticLike,
		unknown,
		null,
		never
	>(orm, relatedTable, relatedClass);
	extra?.(builder);
	for (const constrain of constraints) constrain(builder);
	const rows = await builder.whereIn(column as never, keys as never).get();
	return rows as unknown as object[];
}

function collect(value: unknown, target: object[]): void {
	if (Array.isArray(value)) {
		for (const item of value) {
			if (item !== null && typeof item === "object") target.push(item);
		}
		return;
	}
	if (value !== null && typeof value === "object") target.push(value);
}

/**
 * Placeholder owner for a `belongsTo` relation declared with `withDefault` /
 * `withDefaultFor`. The placeholder is a hydrated (unsaved) instance so the
 * callback can read/write model behavior.
 */
function defaultOwner(
	orm: Orm<Schema>,
	relatedClass: ModelStaticLike,
	descriptor: AnyRelationDescriptor,
	parent: object,
): object | null {
	const hasAttributes = descriptor.defaultAttributes !== undefined;
	const hasFactory = descriptor.defaultFor !== undefined;
	if (!hasAttributes && !hasFactory) return null;
	const placeholder = orm.hydrateModelRow(
		relatedClass,
		{ ...(descriptor.defaultAttributes ?? {}) },
		false,
	) as object;
	if (!hasFactory) return placeholder;
	const replacement = descriptor.defaultFor?.(parent, placeholder);
	return replacement ?? placeholder;
}

async function loadBranch(
	orm: Orm<Schema>,
	parents: object[],
	node: EagerNode,
): Promise<void> {
	if (parents.length === 0) return;
	const first = parents[0];
	if (first === undefined) return;
	const meta = resolveModelMeta(first.constructor);
	for (const [name, childNode] of node.children) {
		const descriptor = relationAt(meta.relations, name);
		if (descriptor === undefined) {
			throw new InvalidQueryError(
				`with(${JSON.stringify(name)}): relation is not defined on model "${meta.table}".`,
			);
		}
		const values = await loadRelation(
			orm,
			meta,
			parents,
			name,
			descriptor,
			childNode,
		);
		const nested: object[] = [];
		for (const parent of parents) {
			const value = values.get(parent);
			internalsOf(parent).setRelation(name, value);
			collect(value, nested);
		}
		if (childNode.children.size > 0 && nested.length > 0) {
			await loadBranch(orm, nested, childNode);
		}
	}
}

async function loadRelation(
	orm: Orm<Schema>,
	meta: ModelMeta,
	parents: object[],
	name: string,
	descriptor: AnyRelationDescriptor,
	node: EagerNode,
): Promise<Map<object, unknown>> {
	const values = new Map<object, unknown>();
	const relatedClass = descriptor.related?.() as ModelStaticLike | undefined;
	const localKey = descriptor.localKey ?? meta.primaryKey ?? "id";

	if (descriptor.kind === "morphTo") {
		const { idColumn, typeColumn } = morphColumnsOf(descriptor, name);
		const types = descriptor.types?.();
		if (types === undefined) {
			throw new InvalidQueryError(
				`with(${JSON.stringify(name)}): morphTo needs a types map.`,
			);
		}
		const byType = new Map<string, object[]>();
		for (const parent of parents) {
			const type = internalsOf(parent).attributes()[typeColumn];
			if (typeof type !== "string") {
				values.set(parent, null);
				continue;
			}
			const bucket = byType.get(type);
			if (bucket === undefined) byType.set(type, [parent]);
			else bucket.push(parent);
		}
		for (const [type, bucket] of byType) {
			const modelClass = (types[type] ?? orm.morphClass(type)) as
				| ModelStaticLike
				| undefined;
			if (modelClass === undefined) {
				for (const parent of bucket) values.set(parent, null);
				continue;
			}
			const relatedTable = modelClass.__table;
			const relatedMeta = orm.internalMeta(relatedTable as never);
			const ownerKey = descriptor.ownerKey ?? relatedMeta.primaryKey ?? "id";
			const keys = distinctKeys(bucket, idColumn);
			const rows =
				keys.length === 0
					? []
					: await queryRelated(
							orm,
							relatedTable,
							modelClass,
							ownerKey,
							keys,
							node.constraints,
						);
			const byKey = new Map<unknown, object>();
			for (const row of rows) {
				byKey.set(internalsOf(row).attributes()[ownerKey], row);
			}
			for (const parent of bucket) {
				values.set(
					parent,
					byKey.get(internalsOf(parent).attributes()[idColumn]) ?? null,
				);
			}
		}
		return values;
	}

	if (relatedClass === undefined) {
		throw new InvalidQueryError(
			`Relation "${name}": descriptor has no target model.`,
		);
	}
	const relatedTable = relatedClass.__table;
	const relatedMeta = orm.internalMeta(relatedTable as never);

	if (descriptor.kind === "hasMany" || descriptor.kind === "hasOne") {
		const foreignKey = requireKey(descriptor.foreignKey, descriptor.kind, name);
		const ofMany = descriptor.kind === "hasOne" ? descriptor.ofMany : undefined;
		if (
			ofMany !== undefined &&
			!Object.hasOwn(relatedMeta.columns, ofMany.column)
		) {
			throw new InvalidQueryError(
				`Relation "${name}": ofMany column "${ofMany.column}" does not exist on "${relatedTable}".`,
			);
		}
		const keys = distinctKeys(parents, localKey);
		const softColumn = softDeleteColumnOf(orm, relatedClass);
		const children =
			keys.length === 0
				? []
				: await queryRelated(
						orm,
						relatedTable,
						relatedClass,
						foreignKey,
						keys,
						node.constraints,
						ofMany === undefined
							? undefined
							: (builder) => {
									// The extreme is computed over every related row
									// (soft scope aside); constraint callbacks filter
									// the selected row, matching Eloquent's `has()`
									// semantics for one-of-many relations.
									builder.whereRaw(
										ofManyPredicateSql(orm.dialectKind, {
											table: relatedTable,
											column: ofMany.column,
											aggregate: ofMany.aggregate,
											foreignKey,
											correlate: {
												kind: "ref",
												table: relatedTable,
												column: foreignKey,
											},
											soft:
												softColumn === null
													? undefined
													: { column: softColumn, mode: "default" },
										}),
									);
								},
					);
		const grouped = new Map<unknown, object[]>();
		for (const child of children) {
			const key = internalsOf(child).attributes()[foreignKey];
			const bucket = grouped.get(key);
			if (bucket === undefined) grouped.set(key, [child]);
			else bucket.push(child);
		}
		const primaryKey = relatedMeta.primaryKey ?? "id";
		for (const parent of parents) {
			const key = internalsOf(parent).attributes()[localKey];
			const bucket = grouped.get(key) ?? [];
			if (descriptor.kind === "hasMany") {
				values.set(parent, Collection.make(bucket));
			} else if (ofMany === undefined) {
				values.set(parent, bucket[0] ?? null);
			} else {
				values.set(
					parent,
					pickOfMany(bucket, ofMany, primaryKey, (row) =>
						internalsOf(row).attributes(),
					),
				);
			}
		}
		return values;
	}

	if (descriptor.kind === "morphMany" || descriptor.kind === "morphOne") {
		const { idColumn, typeColumn } = morphColumnsOf(descriptor, name);
		const alias = orm.morphAlias(meta.cls);
		const keys = distinctKeys(parents, localKey);
		const children =
			keys.length === 0
				? []
				: await queryRelated(
						orm,
						relatedTable,
						relatedClass,
						idColumn,
						keys,
						node.constraints,
						(builder) => {
							builder.where(typeColumn as never, alias as never);
						},
					);
		const grouped = new Map<unknown, object[]>();
		for (const child of children) {
			const key = internalsOf(child).attributes()[idColumn];
			const bucket = grouped.get(key);
			if (bucket === undefined) grouped.set(key, [child]);
			else bucket.push(child);
		}
		for (const parent of parents) {
			const key = internalsOf(parent).attributes()[localKey];
			const bucket = grouped.get(key) ?? [];
			values.set(
				parent,
				descriptor.kind === "morphMany"
					? Collection.make(bucket)
					: (bucket[0] ?? null),
			);
		}
		return values;
	}

	if (descriptor.kind === "belongsTo") {
		const foreignKey = requireKey(descriptor.foreignKey, descriptor.kind, name);
		const ownerKey = descriptor.ownerKey ?? relatedMeta.primaryKey ?? "id";
		const keys = distinctKeys(parents, foreignKey);
		const owners =
			keys.length === 0
				? []
				: await queryRelated(
						orm,
						relatedTable,
						relatedClass,
						ownerKey,
						keys,
						node.constraints,
					);
		const byOwner = new Map<unknown, object>();
		for (const owner of owners) {
			byOwner.set(internalsOf(owner).attributes()[ownerKey], owner);
		}
		const wantsDefault =
			descriptor.defaultFor !== undefined ||
			descriptor.defaultAttributes !== undefined;
		for (const parent of parents) {
			const key = internalsOf(parent).attributes()[foreignKey];
			const found = byOwner.get(key) ?? null;
			if (found !== null || !wantsDefault) {
				values.set(parent, found);
				continue;
			}
			values.set(parent, defaultOwner(orm, relatedClass, descriptor, parent));
		}
		return values;
	}

	if (
		descriptor.kind === "hasManyThrough" ||
		descriptor.kind === "hasOneThrough"
	) {
		const throughThunk = descriptor.through;
		if (typeof throughThunk !== "function") {
			throw new InvalidQueryError(
				`Relation "${name}": ${descriptor.kind} needs a through model.`,
			);
		}
		const throughClass = throughThunk() as ModelStaticLike;
		const throughTable = throughClass.__table;
		const throughMeta = orm.internalMeta(throughTable as never);
		const secondLocalKey =
			descriptor.secondLocalKey ?? throughMeta.primaryKey ?? "id";
		const firstKey = requireKey(descriptor.firstKey, descriptor.kind, name);
		const secondKey = requireKey(descriptor.secondKey, descriptor.kind, name);
		const keys = distinctKeys(parents, localKey);
		if (keys.length === 0) {
			for (const parent of parents) {
				values.set(
					parent,
					descriptor.kind === "hasManyThrough"
						? Collection.make<object>([])
						: null,
				);
			}
			return values;
		}
		const relatedPk = relatedMeta.primaryKey;
		if (relatedPk === null) {
			throw new InvalidQueryError(
				`Relation "${name}": "${relatedTable}" needs a primary key.`,
			);
		}
		const baseColumns = Object.keys(relatedMeta.columns);
		const selectBase = baseColumns.map((column) => `${relatedTable}.${column}`);
		const executor = orm.executor() as AnyStatement;
		const mappingQuery = executor
			.selectFrom(relatedTable)
			.innerJoin(throughTable, (builder: AnyStatement) =>
				builder.onRef(
					`${throughTable}.${secondLocalKey}`,
					"=",
					`${relatedTable}.${secondKey}`,
				),
			)
			.select([
				...selectBase,
				`${throughTable}.${firstKey} as __barqThroughKey`,
			])
			.where(`${throughTable}.${firstKey}`, "in", [...keys]);
		let mapping = mappingQuery;
		const relatedSoft = softDeleteColumnOf(orm, relatedClass);
		const throughSoft = softDeleteColumnOf(orm, throughClass);
		if (throughSoft !== null) {
			mapping = mapping.where(`${throughTable}.${throughSoft}`, "is", null);
		}
		let rows: Array<Record<string, unknown>>;
		if (node.constraints.length === 0) {
			// Single joined query: the related soft-delete filter can be
			// applied in the mapping query itself.
			if (relatedSoft !== null) {
				mapping = mapping.where(`${relatedTable}.${relatedSoft}`, "is", null);
			}
			rows = (await orm.execute(mapping.compile())).rows.map((row) => {
				const shaped = hydrateRow(relatedMeta.plan, row);
				shaped.__barqThroughKey = hydrateRow(throughMeta.plan, {
					[firstKey]: row.__barqThroughKey,
				})[firstKey];
				return shaped;
			});
		} else {
			// Constrained through-relations take one extra query: the related
			// query applies its own (respecting `withTrashed()`), so the
			// mapping query only resolves keys.
			const mappingRows = (await orm.execute(mapping.compile())).rows as Array<
				Record<string, unknown>
			>;
			// Constrained through-relations take one extra query: load the
			// mapping keys first, then the constrained related rows.
			const parentKeys = new Map<unknown, unknown[]>();
			const relatedIds: unknown[] = [];
			const seenIds = new Set<unknown>();
			for (const mappingRow of mappingRows) {
				const relatedId = hydrateRow(relatedMeta.plan, {
					[relatedPk]: mappingRow[relatedPk],
				})[relatedPk];
				const parentKey = hydrateRow(throughMeta.plan, {
					[firstKey]: mappingRow.__barqThroughKey,
				})[firstKey];
				const bucket = parentKeys.get(relatedId);
				if (bucket === undefined) parentKeys.set(relatedId, [parentKey]);
				else bucket.push(parentKey);
				if (!seenIds.has(relatedId)) {
					seenIds.add(relatedId);
					relatedIds.push(relatedId);
				}
			}
			const relatedRows =
				relatedIds.length === 0
					? []
					: await queryRelated(
							orm,
							relatedTable,
							relatedClass,
							relatedPk,
							relatedIds,
							node.constraints,
						);
			rows = [];
			for (const relatedRow of relatedRows) {
				const attributes = internalsOf(relatedRow).attributes();
				const relatedId = attributes[relatedPk];
				for (const parentKey of parentKeys.get(relatedId) ?? []) {
					rows.push({ ...attributes, __barqThroughKey: parentKey });
				}
			}
		}
		const grouped = new Map<unknown, object[]>();
		const hydrated: object[] = [];
		for (const row of rows) {
			const child = orm.hydrateModelRow(relatedClass, row, true) as object;
			hydrated.push(child);
			const key = row.__barqThroughKey;
			const bucket = grouped.get(key);
			if (bucket === undefined) grouped.set(key, [child]);
			else bucket.push(child);
		}
		await emitRetrieved(relatedClass, hydrated);
		for (const parent of parents) {
			const key = internalsOf(parent).attributes()[localKey];
			const bucket = grouped.get(key) ?? [];
			values.set(
				parent,
				descriptor.kind === "hasManyThrough"
					? Collection.make(bucket)
					: (bucket[0] ?? null),
			);
		}
		return values;
	}

	// Pivot-based relations: belongsToMany / morphToMany.
	const through = descriptor.through;
	if (typeof through !== "string" || relatedMeta.primaryKey === null) {
		throw new InvalidQueryError(
			`Relation "${name}" (${descriptor.kind}): requires a pivot table and a primary key on "${relatedTable}".`,
		);
	}
	const foreignPivotKey = requireKey(
		descriptor.foreignPivotKey,
		descriptor.kind,
		name,
	);
	const relatedPivotKey = requireKey(
		descriptor.relatedPivotKey,
		descriptor.kind,
		name,
	);
	const relatedPk = relatedMeta.primaryKey;
	const keys = distinctKeys(parents, localKey);
	const byParent = new Map<unknown, object[]>();
	if (keys.length === 0) {
		for (const parent of parents)
			values.set(parent, Collection.make<object>([]));
		return values;
	}
	// Pivot hydration (`withPivot` / `timestamps` / `as`): select the pivot
	// keys plus every requested column so each parent can receive its own
	// pivot object.
	const pivotColumns = descriptor.pivotColumns ?? [];
	const pivotTimestamps = descriptor.pivotTimestamps;
	const pivotAccessor = descriptor.pivotAccessor ?? "pivot";
	// Morph pivots also expose their `${name}Type` column, like Eloquent.
	const morphTypeColumn =
		descriptor.kind === "morphToMany" && descriptor.morphName !== undefined
			? `${descriptor.morphName}Type`
			: null;
	const pivotSelection: string[] = [foreignPivotKey, relatedPivotKey];
	for (const column of [
		...pivotColumns,
		...(pivotTimestamps ?? []),
		...(morphTypeColumn === null ? [] : [morphTypeColumn]),
	]) {
		if (!pivotSelection.includes(column)) pivotSelection.push(column);
	}
	const executor = orm.executor() as AnyStatement;
	let pivotQuery = executor
		.selectFrom(through)
		.select(pivotSelection.map((column) => `${through}.${column}`))
		.where(`${through}.${foreignPivotKey}`, "in", [...keys]);
	if (descriptor.kind === "morphToMany") {
		const morphName = descriptor.morphName;
		if (morphName === undefined) {
			throw new InvalidQueryError(
				`Relation "${name}": morphToMany needs a morph name.`,
			);
		}
		// `morphedByMany` filters by the related class's alias; `morphToMany`
		// by the owner's.
		pivotQuery = pivotQuery.where(
			`${through}.${morphName}Type`,
			"=",
			orm.morphAlias(descriptor.inverse === true ? relatedClass : meta.cls),
		);
	}
	const pivotRows = (await orm.execute(pivotQuery.compile())).rows.map(
		(row) => {
			// The pivot table is intentionally not required in the schema. Its two
			// key columns carry the owner's and related model's key types, so shape
			// them with those plans; otherwise safe-integer drivers return bigint
			// keys that cannot match number-typed model attributes.
			return {
				...row,
				[foreignPivotKey]: hydrateRow(meta.plan, {
					[localKey]: row[foreignPivotKey],
				})[localKey],
				[relatedPivotKey]: hydrateRow(relatedMeta.plan, {
					[relatedPk]: row[relatedPivotKey],
				})[relatedPk],
			};
		},
	);
	const relatedIds: unknown[] = [];
	const seenIds = new Set<unknown>();
	for (const row of pivotRows) {
		const id = row[relatedPivotKey];
		if (id === null || id === undefined || seenIds.has(id)) continue;
		seenIds.add(id);
		relatedIds.push(id);
	}
	const relatedRows =
		relatedIds.length === 0
			? []
			: await queryRelated(
					orm,
					relatedTable,
					relatedClass,
					relatedPk,
					relatedIds,
					node.constraints,
				);
	const byRelatedId = new Map<unknown, object>();
	for (const child of relatedRows) {
		byRelatedId.set(internalsOf(child).attributes()[relatedPk], child);
	}
	// Each (parent, related) pair gets its own instance carrying that pair's
	// pivot object — Eloquent semantics, and the only way two parents can see
	// different pivot values for the same related row.
	const attached: object[] = [];
	for (const row of pivotRows) {
		const child = byRelatedId.get(row[relatedPivotKey]);
		if (child === undefined) continue;
		const pivot: Record<string, unknown> = {
			[foreignPivotKey]: row[foreignPivotKey],
			[relatedPivotKey]: row[relatedPivotKey],
		};
		for (const column of pivotColumns) pivot[column] = row[column];
		for (const column of pivotTimestamps ?? []) pivot[column] = row[column];
		if (morphTypeColumn !== null) pivot[morphTypeColumn] = row[morphTypeColumn];
		const pivotValue: unknown =
			descriptor.pivotClass === undefined
				? pivot
				: instantiatePivot(descriptor.pivotClass, pivot, orm.encryptionKey);
		const instance = internalsOf(child).clone();
		internalsOf(instance).setExtra(pivotAccessor, pivotValue);
		attached.push(instance);
		const key = row[foreignPivotKey];
		const bucket = byParent.get(key);
		if (bucket === undefined) byParent.set(key, [instance]);
		else bucket.push(instance);
	}
	await emitRetrieved(relatedClass, attached);
	for (const parent of parents) {
		const key = internalsOf(parent).attributes()[localKey];
		values.set(parent, Collection.make(byParent.get(key) ?? []));
	}
	return values;
}
