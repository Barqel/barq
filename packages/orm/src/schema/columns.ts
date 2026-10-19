// Column definitions and the type-level derivations that turn them into
// row / insert / update TypeScript types.
//
// The derivation rules follow what the database actually enforces:
//
//   autoIncrement / generated: true -> produced by the database, never writable
//   nullable: true                  -> value type gains `| null`, optional on insert
//   default / defaultNow: true      -> optional on insert, still writable
//   primaryKey: true                -> excluded from update types
//
// `defineSchema` uses a `const` type parameter so literal flags (`true`)
// survive inference. Schemas declared by hand must use `as const` for the
// nullable/generated/default flags to be typed correctly.

/** Supported abstract column types (mapped per dialect by the schema builder). */
export type ColumnType =
	| "string"
	| "text"
	| "integer"
	| "bigint"
	| "float"
	| "double"
	| "decimal"
	| "boolean"
	| "date"
	| "datetime"
	| "json"
	| "uuid"
	| "binary";

/** Full column definition. */
export interface ColumnDefinition {
	type: ColumnType;
	/** Marks the primary key. At most one column per table may set this. */
	primaryKey?: boolean;
	/** Database-generated auto-increment integer. Implies `generated`. */
	autoIncrement?: boolean;
	/** Column value is produced by the database (identity/sequence/generated). */
	generated?: boolean;
	nullable?: boolean;
	/** Static default. Makes the column optional on insert, still writable. */
	default?: unknown;
	/** Time-based default (`now()`); handled by the ORM on insert. */
	defaultNow?: boolean;
	/** varchar length (string only). */
	length?: number;
	/** decimal(precision, scale). */
	precision?: number;
	scale?: number;
	/**
	 * Expose this 64-bit integer as a JavaScript `bigint` instead of `number`.
	 * Valid only on `bigint` columns. Use `defineSchema(schema, { bigInt: true })`
	 * to enable it for every bigint column in the schema.
	 */
	bigInt?: boolean;
}

/** Column input — either a type shorthand or a full definition. */
export type ColumnInput = ColumnType | ColumnDefinition;

/** A table's columns. */
export type ColumnMap = Record<string, ColumnInput>;

/** The complete schema: table name → columns. */
export type Schema = Record<string, ColumnMap>;

/** TypeScript type produced by each abstract column type. */
export interface ColumnTypeMap {
	string: string;
	text: string;
	integer: number;
	bigint: number;
	float: number;
	double: number;
	decimal: string;
	boolean: boolean;
	date: Date;
	datetime: Date;
	json: unknown;
	uuid: string;
	binary: Uint8Array;
}

/** Expands the shorthand form into a full definition (type level). */
export type NormalizedColumn<C extends ColumnInput> = C extends ColumnType
	? { type: C }
	: C;

export type BaseType<C extends ColumnInput> =
	NormalizedColumn<C> extends { type: "bigint"; bigInt: true }
		? bigint
		: ColumnTypeMap[NormalizedColumn<C>["type"]];

export type IsNullable<C extends ColumnInput> =
	NormalizedColumn<C> extends { nullable: true } ? true : false;

export type IsGenerated<C extends ColumnInput> =
	NormalizedColumn<C> extends { autoIncrement: true }
		? true
		: NormalizedColumn<C> extends { generated: true }
			? true
			: false;

export type HasDefault<C extends ColumnInput> =
	NormalizedColumn<C> extends { default: unknown }
		? true
		: NormalizedColumn<C> extends { defaultNow: true }
			? true
			: false;

export type IsPrimaryKeyColumn<C extends ColumnInput> =
	NormalizedColumn<C> extends { primaryKey: true } ? true : false;

/** The value type stored for a column (nullability included). */
export type RowValue<C extends ColumnInput> =
	IsNullable<C> extends true ? BaseType<C> | null : BaseType<C>;

/** Keys the database fills in (never accepted on insert). */
export type GeneratedKeys<C extends ColumnMap> = {
	[K in keyof C]: IsGenerated<C[K]> extends true ? K : never;
}[keyof C];

/** Keys that must be provided on insert. */
export type RequiredInsertKeys<C extends ColumnMap> = {
	[K in keyof C]: IsGenerated<C[K]> extends true
		? never
		: IsNullable<C[K]> extends true
			? never
			: HasDefault<C[K]> extends true
				? never
				: K;
}[keyof C];

type OptionalInsertKeys<C extends ColumnMap> = Exclude<
	keyof C,
	RequiredInsertKeys<C> | GeneratedKeys<C>
>;

/** Full row shape as read from the database. */
export type TableRow<C extends ColumnMap> = {
	[K in keyof C]: RowValue<C[K]>;
};

/** Insert payload: generated columns removed, defaulted/nullable ones optional. */
export type InsertRowFor<C extends ColumnMap> = {
	[K in RequiredInsertKeys<C>]: RowValue<C[K]>;
} & {
	[K in OptionalInsertKeys<C>]?: RowValue<C[K]>;
};

/** Primary key column name (never if the table declares none). */
export type PrimaryKeyColumn<C extends ColumnMap> = {
	[K in keyof C]: IsPrimaryKeyColumn<C[K]> extends true ? K : never;
}[keyof C];

type UpdatableKeys<C extends ColumnMap> = {
	[K in keyof C]: IsPrimaryKeyColumn<C[K]> extends true
		? never
		: IsGenerated<C[K]> extends true
			? never
			: K;
}[keyof C];

/** Update payload: mutable columns only, all optional. */
export type UpdateRowFor<C extends ColumnMap> = {
	[K in UpdatableKeys<C>]?: RowValue<C[K]>;
};

const KNOWN_COLUMN_TYPES = new Set<string>([
	"string",
	"text",
	"integer",
	"bigint",
	"float",
	"double",
	"decimal",
	"boolean",
	"date",
	"datetime",
	"json",
	"uuid",
	"binary",
]);

const INTEGER_TYPES = new Set<string>(["integer", "bigint"]);

/**
 * Expands a column shorthand into a full, validated definition.
 * @internal
 */
export function normalizeColumn(
	table: string,
	name: string,
	input: ColumnInput,
): ColumnDefinition {
	if (typeof input === "string") {
		if (!KNOWN_COLUMN_TYPES.has(input)) {
			throw new Error(
				`Unknown column type "${input}" for ${table}.${name}. Known types: ${[...KNOWN_COLUMN_TYPES].join(", ")}`,
			);
		}
		return { type: input };
	}

	const column = input as ColumnDefinition;
	if (!KNOWN_COLUMN_TYPES.has(column.type)) {
		throw new Error(
			`Unknown column type "${String(column.type)}" for ${table}.${name}.`,
		);
	}
	if (column.autoIncrement === true && !INTEGER_TYPES.has(column.type)) {
		throw new Error(
			`${table}.${name}: autoIncrement requires an "integer" or "bigint" column, got "${column.type}".`,
		);
	}
	if (column.primaryKey === true && column.nullable === true) {
		throw new Error(
			`${table}.${name}: a primary key column cannot be nullable. Drop one of the two flags.`,
		);
	}
	if (column.default !== undefined && column.defaultNow === true) {
		throw new Error(
			`${table}.${name}: "default" and "defaultNow" are mutually exclusive.`,
		);
	}
	if (column.bigInt !== undefined && typeof column.bigInt !== "boolean") {
		throw new Error(
			`${table}.${name}: "bigInt" must be a boolean, got ${typeof column.bigInt}.`,
		);
	}
	if (column.bigInt === true && column.type !== "bigint") {
		throw new Error(
			`${table}.${name}: "bigInt" is only valid on "bigint" columns, got "${column.type}".`,
		);
	}
	return column;
}

/** Whether a schema exposes at least one column as a JavaScript `bigint`. @internal */
export function schemaUsesBigInt(schema: Schema): boolean {
	for (const [table, columns] of Object.entries(schema)) {
		for (const [name, input] of Object.entries(columns)) {
			if (normalizeColumn(table, name, input).bigInt === true) return true;
		}
	}
	return false;
}
