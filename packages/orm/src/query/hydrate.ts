// Row shaping: converts raw driver values into the types the schema promises.
//
// SQLite returns booleans as 0/1, JSON as text and dates as ISO strings.
// MySQL and PostgreSQL return native values. Applying one small conversion
// plan per table keeps both execution paths (rows and models) consistent
// across dialects without a per-row type inspection.

import type { ColumnDefinition, ColumnMap } from "../schema/columns";
import { normalizeColumn } from "../schema/columns";

/** @internal */
export type RowConverter = (value: unknown) => unknown;

/** @internal */
export interface RowPlan {
	readonly readers: ReadonlyArray<{ column: string; convert: RowConverter }>;
}

function tryParseJson(value: string): unknown {
	try {
		return JSON.parse(value);
	} catch {
		return value;
	}
}

function toNumber(value: unknown): unknown {
	if (typeof value === "bigint") return Number(value);
	if (typeof value === "string" && value.trim() !== "") {
		const numeric = Number(value);
		if (!Number.isNaN(numeric)) return numeric;
	}
	return value;
}

function toBigInt(value: unknown): unknown {
	if (typeof value === "bigint") return value;
	if (typeof value === "number" && Number.isInteger(value)) {
		return BigInt(value);
	}
	if (typeof value === "string" && value.trim() !== "") {
		try {
			return BigInt(value);
		} catch {
			return value;
		}
	}
	return value;
}

function converterFor(definition: ColumnDefinition): RowConverter | null {
	switch (definition.type) {
		case "integer":
			// SQLite with safe integers enabled returns every integer as bigint;
			// MySQL/PostgreSQL can also hand back decimal strings for wide values.
			return toNumber;
		case "bigint":
			return definition.bigInt === true ? toBigInt : toNumber;
		case "boolean":
			return (value) => {
				if (value === null || value === undefined) return value;
				if (value === true || value === 1 || value === 1n || value === "1")
					return true;
				if (value === false || value === 0 || value === 0n || value === "0")
					return false;
				return value;
			};
		case "date":
		case "datetime":
			return (value) => {
				if (value === null || value === undefined) return value;
				if (value instanceof Date) return value;
				if (typeof value === "bigint") return new Date(Number(value));
				if (typeof value === "string" || typeof value === "number") {
					return new Date(value);
				}
				return value;
			};
		case "json":
			return (value) => {
				if (typeof value === "string") return tryParseJson(value);
				return value;
			};
		case "decimal":
			// DECIMAL is string-typed to avoid float rounding. SQLite stores it
			// numerically, so numbers/bigints are normalized to strings here.
			return (value) =>
				typeof value === "number" || typeof value === "bigint"
					? String(value)
					: value;
		default:
			return null;
	}
}

/**
 * Builds the conversion plan for one table.
 * @internal
 */
export function buildRowPlan(table: string, columns: ColumnMap): RowPlan {
	const readers: Array<{ column: string; convert: RowConverter }> = [];
	for (const [column, input] of Object.entries(columns)) {
		const definition = normalizeColumn(table, column, input);
		const convert = converterFor(definition);
		if (convert) readers.push({ column, convert });
	}
	return { readers };
}

/**
 * Applies a plan to one raw row. Rows without converted columns are returned
 * untouched (no copy) to keep the row path allocation-free.
 * @internal
 */
export function hydrateRow(
	plan: RowPlan,
	row: Record<string, unknown>,
): Record<string, unknown> {
	if (plan.readers.length === 0) return row;
	const output: Record<string, unknown> = { ...row };
	for (const { column, convert } of plan.readers) {
		if (column in output) output[column] = convert(output[column]);
	}
	return output;
}
