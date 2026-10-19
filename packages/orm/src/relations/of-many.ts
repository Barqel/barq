// One-of-many (`latestOfMany` / `oldestOfMany` / `ofMany`) SQL fragments.
//
// The predicate selects, per parent, the single related row holding the
// extreme value of one column:
//
//   related.column = (
//     select max(inner.column) from related as inner
//     where inner.foreignKey = <correlation> [and inner.deletedAt is null]
//   )
//
// Ties are left to the caller (the eager loader breaks them by primary key).
// Everything interpolated here is a schema-validated identifier or a bound
// value, never user text.

import type { DialectKind } from "../errors";
import {
	quoteIdentifier,
	quoteReference,
	type RawExpression,
	raw,
} from "../query/raw";
import type { OfManyClause } from "./descriptors";

/** Soft-delete filtering inside the extreme subquery. */
export type OfManySoftScope = {
	readonly column: string;
	readonly mode: "default" | "with" | "only";
};

/** Correlation target of the extreme subquery. */
export type OfManyCorrelation =
	| { readonly kind: "ref"; readonly table: string; readonly column: string }
	| {
			readonly kind: "value";
			readonly column: string;
			readonly value: unknown;
	  };

/** Options accepted by {@link ofManyPredicateSql}. @internal */
export interface OfManyPredicateOptions {
	/** Related table holding the candidate rows. */
	readonly table: string;
	/** Column the extreme value is computed on. */
	readonly column: string;
	readonly aggregate: "min" | "max";
	/** Foreign key on the related table pointing at the parent key. */
	readonly foreignKey: string;
	/** How the extreme subquery finds "this parent". */
	readonly correlate: OfManyCorrelation;
	readonly soft?: OfManySoftScope | undefined;
}

/** Alias used for the inner (extreme-computing) copy of the related table. */
const INNER_ALIAS = "__barq_of_many";

/**
 * Builds the raw predicate that keeps only the per-parent extreme row.
 * @internal
 */
export function ofManyPredicateSql(
	dialect: DialectKind,
	options: OfManyPredicateOptions,
): RawExpression {
	const inner = `${INNER_ALIAS}.${options.column}`;
	let correlation: string;
	const parameters: unknown[] = [];
	if (options.correlate.kind === "ref") {
		correlation = `${quoteReference(`${INNER_ALIAS}.${options.foreignKey}`, dialect)} = ${quoteReference(
			`${options.correlate.table}.${options.correlate.column}`,
			dialect,
		)}`;
	} else {
		correlation = `${quoteReference(`${INNER_ALIAS}.${options.foreignKey}`, dialect)} = ?`;
		parameters.push(options.correlate.value);
	}
	let soft = "";
	if (options.soft !== undefined && options.soft.mode !== "with") {
		soft = ` and ${quoteReference(`${INNER_ALIAS}.${options.soft.column}`, dialect)} is ${
			options.soft.mode === "only" ? "not " : ""
		}null`;
	}
	const sqlText = `${quoteReference(`${options.table}.${options.column}`, dialect)} = (select ${
		options.aggregate
	}(${quoteReference(inner, dialect)}) from ${quoteReference(options.table, dialect)} as ${quoteIdentifier(
		INNER_ALIAS,
		dialect,
	)} where ${correlation}${soft})`;
	return raw(sqlText, parameters);
}

/** Normalizes a value for extreme comparisons. @internal */
function sortableValue(value: unknown): number | bigint | string | null {
	if (value === null || value === undefined) return null;
	if (typeof value === "number" || typeof value === "bigint") return value;
	if (typeof value === "string") {
		if (value.trim() !== "" && Number.isFinite(Number(value))) {
			return Number(value);
		}
		return value;
	}
	if (value instanceof Date) return value.getTime();
	if (typeof value === "boolean") return value ? 1 : 0;
	return String(value);
}

/**
 * Orders two attribute values of the extreme column. Numeric values (numbers,
 * bigints, numeric strings, dates) compare numerically; everything else falls
 * back to string comparison. `null` sorts before every value.
 * @internal
 */
export function compareOfManyValues(a: unknown, b: unknown): number {
	if (a === b) return 0;
	const left = sortableValue(a);
	const right = sortableValue(b);
	if (left === null) return right === null ? 0 : -1;
	if (right === null) return 1;
	if (typeof left === "string" || typeof right === "string") {
		const ls = String(left);
		const rs = String(right);
		return ls < rs ? -1 : ls > rs ? 1 : 0;
	}
	if (typeof left === "bigint" || typeof right === "bigint") {
		const lb = BigInt(left);
		const rb = BigInt(right);
		return lb < rb ? -1 : lb > rb ? 1 : 0;
	}
	return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Picks the extreme row of a candidate bucket: the row whose `column` value is
 * the min/max; ties break deterministically on the primary key in the same
 * direction.
 * @internal
 */
export function pickOfMany(
	rows: readonly object[],
	clause: OfManyClause,
	primaryKey: string,
	attributesOf: (row: object) => Record<string, unknown>,
): object | null {
	let best: object | null = null;
	let bestValue: unknown;
	let bestKey: unknown;
	for (const row of rows) {
		const attributes = attributesOf(row);
		const value = attributes[clause.column];
		const key = attributes[primaryKey];
		if (best === null) {
			best = row;
			bestValue = value;
			bestKey = key;
			continue;
		}
		const byValue = compareOfManyValues(value, bestValue);
		const wins =
			clause.aggregate === "max"
				? byValue > 0 ||
					(byValue === 0 && compareOfManyValues(key, bestKey) > 0)
				: byValue < 0 ||
					(byValue === 0 && compareOfManyValues(key, bestKey) < 0);
		if (wins) {
			best = row;
			bestValue = value;
			bestKey = key;
		}
	}
	return best;
}
