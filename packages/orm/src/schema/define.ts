import { SchemaError } from "../errors";
import {
	type ColumnDefinition,
	type ColumnInput,
	type ColumnMap,
	type InsertRowFor,
	type NormalizedColumn,
	normalizeColumn,
	type PrimaryKeyColumn,
	type RowValue,
	type Schema,
	type TableRow,
	type UpdateRowFor,
} from "./columns";

// The schema vocabulary is re-exported from one place so callers never have to
// import from two modules.
export type {
	BaseType,
	ColumnDefinition,
	ColumnInput,
	ColumnMap,
	ColumnType,
	Schema,
} from "./columns";

/** Options accepted by `defineSchema`. */
export interface SchemaOptions {
	/**
	 * Expose every `bigint` column as a JavaScript `bigint` instead of
	 * `number`. This is equivalent to adding `bigInt: true` to each bigint
	 * column, but preserves full 64-bit precision in both directions.
	 */
	bigInt?: boolean;
}

/** A column definition transformed by global BigInt mode (type level). */
type BigIntModeColumn<C extends ColumnInput> =
	NormalizedColumn<C> extends infer N extends ColumnDefinition
		? N["type"] extends "bigint"
			? Omit<N, "bigInt"> & { bigInt: true }
			: C
		: C;

/** Schema type produced by `defineSchema(schema, { bigInt: true })`. */
export type BigIntSchema<
	S extends Schema,
	O extends SchemaOptions,
> = O extends { bigInt: true }
	? {
			[T in keyof S]: {
				[C in keyof S[T]]: BigIntModeColumn<S[T][C]>;
			};
		}
	: O extends { bigInt?: false | undefined }
		? S
		: // A non-literal `boolean` option can enable the mode at runtime; make
			// the caller handle both possible row shapes instead of lying.
				| {
						[T in keyof S]: {
							[C in keyof S[T]]: BigIntModeColumn<S[T][C]>;
						};
				  }
				| S;

/**
 * Defines the database schema and keeps its literal types.
 *
 * ```ts
 * export const schema = defineSchema({
 *   users: {
 *     id: { type: "integer", primaryKey: true, autoIncrement: true },
 *     name: "string",
 *     age: { type: "integer", nullable: true },
 *     active: { type: "boolean", default: true },
 *   },
 * });
 * ```
 *
 * The schema is validated eagerly: unknown column types, multiple primary
 * keys, nullable primary keys and invalid auto-increment columns throw a
 * `SchemaError` at definition time rather than at the first query.
 *
 * Pass `{ bigInt: true }` to expose every 64-bit integer as a JavaScript
 * `bigint`, or set `bigInt: true` on individual columns.
 */
export function defineSchema<const S extends Schema>(schema: S): S;
export function defineSchema<
	const S extends Schema,
	const O extends SchemaOptions,
>(schema: S, options: O): BigIntSchema<S, O>;
export function defineSchema(
	schema: Schema,
	options: SchemaOptions = {},
): Schema {
	if (
		options === null ||
		typeof options !== "object" ||
		Array.isArray(options)
	) {
		throw new SchemaError("defineSchema options must be an object.");
	}
	if (options.bigInt !== undefined && typeof options.bigInt !== "boolean") {
		throw new SchemaError('defineSchema option "bigInt" must be a boolean.');
	}
	const bigIntMode = options.bigInt === true;
	const tables = Object.keys(schema);
	if (tables.length === 0) {
		throw new SchemaError("Schema must define at least one table.");
	}
	const output: Schema = bigIntMode ? {} : schema;

	for (const table of tables) {
		const columns = schema[table] as ColumnMap;
		if (typeof columns !== "object" || columns === null) {
			throw new SchemaError(`Table "${table}" must be an object of columns.`);
		}
		const names = Object.keys(columns);
		if (names.length === 0) {
			throw new SchemaError(
				`Table "${table}" must define at least one column.`,
			);
		}
		if (bigIntMode) output[table] = {};

		let primaryKeys = 0;
		for (const name of names) {
			const input = columns[name] as ColumnInput;
			let normalized: ReturnType<typeof normalizeColumn>;
			try {
				normalized = normalizeColumn(table, name, input);
			} catch (cause) {
				throw new SchemaError((cause as Error).message, { cause });
			}
			if (normalized.primaryKey === true) primaryKeys++;

			if (
				normalized.default !== undefined &&
				(normalized.type === "json" || normalized.type === "binary")
			) {
				throw new SchemaError(
					`${table}.${name}: default values for "${normalized.type}" columns are not supported — pass them explicitly.`,
				);
			}
			if (bigIntMode) {
				output[table]![name] =
					normalized.type === "bigint"
						? { ...normalized, bigInt: true }
						: input;
			}
		}

		if (primaryKeys > 1) {
			throw new SchemaError(
				`Table "${table}" declares ${primaryKeys} primary key columns. Composite keys are not supported; declare exactly one.`,
			);
		}
	}

	return output;
}

// ---------------------------------------------------------------------------
// Public type helpers — derived straight from the schema
// ---------------------------------------------------------------------------

/** Table names of a schema. */
export type TableName<S extends Schema> = keyof S & string;

/** Column map of a table. */
export type ColumnsOf<S extends Schema, T extends TableName<S>> = S[T];

/** Column names of a table. */
export type ColumnNameOf<
	S extends Schema,
	T extends TableName<S>,
> = keyof S[T] & string;

/** Row shape (SELECT result) of a table. */
export type RowOf<S extends Schema, T extends TableName<S>> = TableRow<S[T]>;

/** Insert payload of a table. */
export type InsertOf<S extends Schema, T extends TableName<S>> = InsertRowFor<
	S[T]
>;

/** Update payload of a table. */
export type UpdateOf<S extends Schema, T extends TableName<S>> = UpdateRowFor<
	S[T]
>;

/** Primary key column name of a table. */
export type PrimaryKeyOf<
	S extends Schema,
	T extends TableName<S>,
> = PrimaryKeyColumn<S[T]> & keyof S[T];

/** TypeScript value type of one column. */
export type ColumnValueOf<
	S extends Schema,
	T extends TableName<S>,
	C extends ColumnNameOf<S, T>,
> =
	RowValue<S[T][C] extends ColumnInput ? S[T][C] : never> extends infer V
		? V
		: never;

/** Primary key value type of a table (the type `find()` accepts). */
export type PrimaryKeyValueOf<S extends Schema, T extends TableName<S>> = RowOf<
	S,
	T
>[PrimaryKeyOf<S, T> & keyof RowOf<S, T>];
