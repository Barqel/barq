// Schema builder — dialect-aware DDL used by migrations and one-off scripts.
//
// ```ts
// await orm.schemaBuilder().create("users", (t) => {
//   t.id();
//   t.string("email").unique();
//   t.string("name", 120);
//   t.datetime("createdAt").defaultNow();
// });
// ```
//
// Statements are compiled through Kysely and executed through `orm.execute`,
// so schema changes flow through the same error translation, transaction
// context and query listeners as everything else.

import type { CompiledQuery } from "kysely";
import { sql } from "kysely";
import type { DialectKind } from "../errors";
import { InvalidIdentifierError, SchemaError } from "../errors";
import type { Orm } from "../orm";
import type { ColumnType, Schema } from "./columns";
import {
	planSqliteRebuild,
	quoteSqlite,
	withTableName,
} from "./sqlite-rebuild";

/** Internal compile boundary — Kysely builder generics are erased here. */
type AnyStatement = any;

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function validateIdentifier(kind: string, name: string): void {
	if (!IDENTIFIER.test(name)) {
		throw new InvalidIdentifierError(
			`Invalid ${kind} name ${JSON.stringify(name)}. Use letters, digits and underscores, starting with a letter or underscore.`,
		);
	}
}

/** Referential actions accepted by `onDelete` / `onUpdate`. */
export type ReferentialAction =
	| "cascade"
	| "restrict"
	| "no action"
	| "set null"
	| "set default";

/** Fully-resolved column definition used while compiling DDL. */
export interface ColumnSpec {
	name: string;
	type: ColumnType;
	length?: number;
	precision?: number;
	scale?: number;
	nullable: boolean;
	primary: boolean;
	autoIncrement: boolean;
	unique: boolean;
	/** Emits `unsigned` on MySQL; ignored on dialects without it. */
	unsigned?: boolean;
	hasDefault: boolean;
	defaultValue?: unknown;
	defaultNow: boolean;
	references?: { table: string; column: string };
	onDelete?: ReferentialAction;
	onUpdate?: ReferentialAction;
	/** Allowed values for `enum`/`set` columns. */
	values?: readonly string[];
	/** MySQL column comment (`comment '…'`); omitted elsewhere. */
	comment?: string;
	/** MySQL column character set; omitted elsewhere. */
	charset?: string;
	/** MySQL column collation; omitted elsewhere. */
	collation?: string;
	/** MySQL `after` placement for `alter(…).addColumn`; ignored elsewhere. */
	after?: string;
	/** MySQL `first` placement for `alter(…).addColumn`; ignored elsewhere. */
	first?: boolean;
	/** MySQL `on update CURRENT_TIMESTAMP`; ignored elsewhere. */
	useCurrentOnUpdate?: boolean;
	/** MySQL invisible column; ignored elsewhere. */
	invisible?: boolean;
	/**
	 * Generated column expression. `stored: true` emits
	 * `generated always as (expr) stored`; `stored: false` emits a virtual
	 * column on MySQL/SQLite and throws on PostgreSQL (no virtual columns).
	 */
	generated?: { expression: string | ReturnType<typeof sql>; stored: boolean };
	/** Marks the column as an existing column to modify in `alter(…).change()`. */
	change?: boolean;
	/** Auto-increment/identity starting value (MySQL / PostgreSQL). */
	startingValue?: number;
}

/** Index / unique-constraint definition. */
export interface IndexSpec {
	kind: "index" | "unique" | "fulltext" | "spatial";
	columns: string[];
	name?: string;
}

/** Table-level foreign key declared through `TableBuilder.foreign()`. */
export interface ForeignKeySpec {
	columns: string[];
	table?: string;
	column?: string;
	onDelete?: ReferentialAction;
	onUpdate?: ReferentialAction;
	name?: string;
}

function toArray(value: string | readonly string[]): string[] {
	return typeof value === "string" ? [value] : [...value];
}

/** Escapes a string literal for interpolation into raw DDL. */
function quoteString(value: string): string {
	return `'${value.replaceAll("'", "''")}'`;
}

/** Validates and copies an ENUM / SET value list. */
function enumValues(name: string, values: readonly string[]): string[] {
	if (!Array.isArray(values) || values.length === 0) {
		throw new SchemaError(
			`enum("${name}"): a non-empty list of allowed values is required.`,
		);
	}
	for (const value of values) {
		if (typeof value !== "string" || value === "") {
			throw new SchemaError(
				`enum("${name}"): allowed values must be non-empty strings.`,
			);
		}
	}
	return [...values];
}

/** Renders a default value for the SQLite rebuild path. */
function renderSqliteDefault(value: unknown): string {
	if (value === null) return "null";
	if (typeof value === "string") return quoteString(value);
	if (typeof value === "boolean") return value ? "1" : "0";
	if (typeof value === "number" && Number.isFinite(value)) return String(value);
	if (typeof value === "bigint") return value.toString();
	return quoteString(String(value));
}

/** Validates a MySQL charset/collation name (letters, digits, underscores). */
function validateCharset(kind: string, name: string): string {
	if (!/^[A-Za-z0-9_]+$/.test(name)) {
		throw new SchemaError(
			`Invalid ${kind} name ${JSON.stringify(name)}. Use letters, digits and underscores.`,
		);
	}
	return name;
}

/**
 * Locates the `create table` clause that defines `column` (SQLite only),
 * returning its character range inside the statement. Used by the table
 * rebuild that backs `change()` and `dropPrimary()`.
 */
function sqliteColumnSegment(
	createSql: string,
	column: string,
): { start: number; end: number } | null {
	const open = createSql.indexOf("(");
	if (open === -1) return null;
	const quoted = quoteSqlite(column);
	const match = (start: number, end: number) => {
		const text = createSql.slice(start, end);
		const trimmed = text.replace(/^\s+/, "");
		if (!trimmed.startsWith(quoted)) return null;
		const rest = trimmed.slice(quoted.length);
		if (rest !== "" && !/^\s/.test(rest)) return null;
		return { start: start + (text.length - trimmed.length), end };
	};
	let depth = 0;
	let start = open + 1;
	for (let i = open + 1; i < createSql.length; i += 1) {
		const char = createSql[i]!;
		if (char === "(") depth += 1;
		else if (char === ")") {
			if (depth === 0) return match(start, i);
			depth -= 1;
		} else if (char === "," && depth === 0) {
			const hit = match(start, i);
			if (hit !== null) return hit;
			start = i + 1;
		}
	}
	return null;
}

/** Chainable column modifiers, returned by every `TableBuilder` column method. */
export class ColumnBuilder {
	readonly #spec: ColumnSpec;

	/** @internal */
	constructor(spec: ColumnSpec) {
		this.#spec = spec;
	}

	/** Allows NULL values. */
	nullable(): this {
		this.#spec.nullable = true;
		return this;
	}

	/** Static default value. */
	default(value: unknown): this {
		this.#spec.hasDefault = true;
		this.#spec.defaultValue = value;
		return this;
	}

	/** Database-provided current timestamp default. */
	defaultNow(): this {
		this.#spec.defaultNow = true;
		return this;
	}

	/** Alias of `defaultNow` (Eloquent's `useCurrent`). */
	useCurrent(): this {
		return this.defaultNow();
	}

	/** Emits `unsigned` on MySQL (ignored elsewhere). */
	unsigned(): this {
		this.#spec.unsigned = true;
		return this;
	}

	/**
	 * Adds a foreign key to the table inferred from the column name
	 * (`user_id` → `users.id`, `userId` → `users.id`) or an explicit table.
	 */
	constrained(table?: string, column = "id"): this {
		const name = this.#spec.name;
		let target = table;
		if (target === undefined) {
			const base =
				name.endsWith("_id") || name.endsWith("Id")
					? name.slice(0, -3)
					: name.endsWith("id")
						? name.slice(0, -2)
						: "";
			if (base === "") {
				throw new SchemaError(
					`constrained(): column "${name}" does not look like a foreign key. Pass the table name explicitly.`,
				);
			}
			target = `${base.replace(/_+$/, "")}s`;
		}
		return this.references(`${target}.${column}` as `${string}.${string}`);
	}

	/** Marks the column as the primary key. */
	primary(): this {
		this.#spec.primary = true;
		return this;
	}

	/** Database-generated auto-increment. */
	autoIncrement(): this {
		this.#spec.autoIncrement = true;
		return this;
	}

	/** Adds a unique constraint. */
	unique(): this {
		this.#spec.unique = true;
		return this;
	}

	/** Adds a foreign key reference (`"users.id"`). */
	references(reference: `${string}.${string}`): this {
		const separator = reference.indexOf(".");
		const table = reference.slice(0, separator);
		const column = reference.slice(separator + 1);
		validateIdentifier("table", table);
		validateIdentifier("column", column);
		this.#spec.references = { table, column };
		return this;
	}

	/** Foreign key action on delete. */
	onDelete(action: ReferentialAction): this {
		this.#spec.onDelete = action;
		return this;
	}

	/** Foreign key action on update. */
	onUpdate(action: ReferentialAction): this {
		this.#spec.onUpdate = action;
		return this;
	}

	/** MySQL column comment (`comment '…'`); omitted on other dialects. */
	comment(text: string): this {
		this.#spec.comment = text;
		return this;
	}

	/** MySQL column character set; omitted on other dialects. */
	charset(name: string): this {
		this.#spec.charset = validateCharset("charset", name);
		return this;
	}

	/** MySQL column collation; omitted on other dialects. */
	collation(name: string): this {
		this.#spec.collation = validateCharset("collation", name);
		return this;
	}

	/** MySQL-only `after` placement for `alter(…).addColumn`. */
	after(column: string): this {
		validateIdentifier("column", column);
		this.#spec.after = column;
		return this;
	}

	/** MySQL-only `first` placement for `alter(…).addColumn`. */
	first(): this {
		this.#spec.first = true;
		return this;
	}

	/** MySQL-only `on update CURRENT_TIMESTAMP`. */
	useCurrentOnUpdate(): this {
		this.#spec.useCurrentOnUpdate = true;
		return this;
	}

	/** MySQL-only invisible column. */
	invisible(): this {
		this.#spec.invisible = true;
		return this;
	}

	/**
	 * Accepted for Eloquent parity. Generated columns always compile to the
	 * SQL-standard `generated always as (…)` form, so this is a no-op.
	 */
	always(): this {
		return this;
	}

	/** Seeds the auto-increment / identity sequence (MySQL / PostgreSQL). */
	startingValue(value: number): this {
		if (!Number.isInteger(value) || value < 0) {
			throw new SchemaError(
				`startingValue(${String(value)}): expected a non-negative integer.`,
			);
		}
		this.#spec.startingValue = value;
		return this;
	}

	/**
	 * Marks this column as an existing column to modify instead of a new one.
	 * Inside `alter()`: MySQL uses `modify column`, PostgreSQL issues
	 * `alter column` statements and SQLite rebuilds the table.
	 */
	change(): this {
		this.#spec.change = true;
		return this;
	}

	/** Stored generated column: `generated always as (expr) stored`. */
	storedAs(expression: string | ReturnType<typeof sql>): this {
		this.#spec.generated = { expression, stored: true };
		return this;
	}

	/**
	 * Virtual generated column (`generated always as (expr) virtual`) on
	 * MySQL and SQLite. PostgreSQL has no virtual columns, so this throws a
	 * `SchemaError` there.
	 */
	virtualAs(expression: string | ReturnType<typeof sql>): this {
		this.#spec.generated = { expression, stored: false };
		return this;
	}
}

/** Chainable foreign-key constraint helper, returned by `TableBuilder.foreign()`. */
export class ForeignKeyBuilder {
	readonly #spec: ForeignKeySpec;

	/** @internal */
	constructor(spec: ForeignKeySpec) {
		this.#spec = spec;
	}

	/** Sets the referenced table and column (`"users.id"`). */
	references(reference: `${string}.${string}`): this {
		const separator = reference.indexOf(".");
		const table = reference.slice(0, separator);
		const column = reference.slice(separator + 1);
		validateIdentifier("table", table);
		validateIdentifier("column", column);
		this.#spec.table = table;
		this.#spec.column = column;
		return this;
	}

	/** Alias of `references()` (`on("users", "id")`). */
	on(table: string, column = "id"): this {
		return this.references(`${table}.${column}` as `${string}.${string}`);
	}

	/** Foreign key action on delete. */
	onDelete(action: ReferentialAction): this {
		this.#spec.onDelete = action;
		return this;
	}

	/** Foreign key action on update. */
	onUpdate(action: ReferentialAction): this {
		this.#spec.onUpdate = action;
		return this;
	}
}

/** Column/index DSL for `create()`. */
export class TableBuilder {
	/** @internal */ readonly columns: ColumnSpec[] = [];
	/** @internal */ readonly indexes: IndexSpec[] = [];
	/** @internal */ readonly foreignKeys: ForeignKeySpec[] = [];
	/** @internal */ tableComment?: string;
	/** @internal */ tableCharset?: string;
	/** @internal */ tableCollation?: string;

	#add(
		name: string,
		type: ColumnType,
		options: Partial<ColumnSpec> = {},
	): ColumnBuilder {
		validateIdentifier("column", name);
		if (this.columns.some((column) => column.name === name)) {
			throw new SchemaError(`Duplicate column "${name}".`);
		}
		const spec: ColumnSpec = {
			name,
			type,
			nullable: false,
			primary: false,
			autoIncrement: false,
			unique: false,
			hasDefault: false,
			defaultNow: false,
			...options,
		};
		this.columns.push(spec);
		return new ColumnBuilder(spec);
	}

	/** Auto-increment primary key. */
	id(name = "id"): ColumnBuilder {
		return this.#add(name, "bigint", { primary: true, autoIncrement: true });
	}

	/** VARCHAR (TEXT on SQLite). */
	string(name: string, length = 255): ColumnBuilder {
		return this.#add(name, "string", { length });
	}

	/** Unbounded text. */
	text(name: string): ColumnBuilder {
		return this.#add(name, "text");
	}

	/** MySQL `tinytext`; `text` elsewhere. */
	tinyText(name: string): ColumnBuilder {
		return this.#add(name, "tinytext");
	}

	/** MySQL `mediumtext`; `text` elsewhere. */
	mediumText(name: string): ColumnBuilder {
		return this.#add(name, "mediumtext");
	}

	/** MySQL `longtext`; `text` elsewhere. */
	longText(name: string): ColumnBuilder {
		return this.#add(name, "longtext");
	}

	/** Fixed-length CHAR. */
	char(name: string, length = 255): ColumnBuilder {
		return this.#add(name, "char", { length });
	}

	/** 32-bit integer. */
	integer(name: string): ColumnBuilder {
		return this.#add(name, "integer");
	}

	/** 1-byte integer (MySQL `tinyint`; smaller alias elsewhere). */
	tinyInteger(name: string): ColumnBuilder {
		return this.#add(name, "tinyint");
	}

	/** 2-byte integer (MySQL `smallint`). */
	smallInteger(name: string): ColumnBuilder {
		return this.#add(name, "smallint");
	}

	/** 3-byte integer (MySQL `mediumint`). */
	mediumInteger(name: string): ColumnBuilder {
		return this.#add(name, "mediumint");
	}

	/** 64-bit integer. */
	bigint(name: string): ColumnBuilder {
		return this.#add(name, "bigint");
	}

	/** MySQL `YEAR`; `integer` elsewhere. */
	year(name: string): ColumnBuilder {
		return this.#add(name, "year");
	}

	/** Unsigned 1-byte integer (MySQL `tinyint unsigned`; ignored elsewhere). */
	unsignedTinyInteger(name: string): ColumnBuilder {
		return this.#add(name, "tinyint", { unsigned: true });
	}

	/** Unsigned 2-byte integer (MySQL `smallint unsigned`; ignored elsewhere). */
	unsignedSmallInteger(name: string): ColumnBuilder {
		return this.#add(name, "smallint", { unsigned: true });
	}

	/** Unsigned 3-byte integer (MySQL `mediumint unsigned`; ignored elsewhere). */
	unsignedMediumInteger(name: string): ColumnBuilder {
		return this.#add(name, "mediumint", { unsigned: true });
	}

	/** Unsigned 32-bit integer (MySQL `integer unsigned`; ignored elsewhere). */
	unsignedInteger(name: string): ColumnBuilder {
		return this.#add(name, "integer", { unsigned: true });
	}

	/** Unsigned 64-bit integer (MySQL `bigint unsigned`; ignored elsewhere). */
	unsignedBigInteger(name: string): ColumnBuilder {
		return this.#add(name, "bigint", { unsigned: true });
	}

	/** Single-precision float. */
	float(name: string): ColumnBuilder {
		return this.#add(name, "float");
	}

	/** Double-precision float. */
	double(name: string): ColumnBuilder {
		return this.#add(name, "double");
	}

	/** Fixed-precision decimal. */
	decimal(name: string, precision = 10, scale = 2): ColumnBuilder {
		return this.#add(name, "decimal", { precision, scale });
	}

	/** Unsigned float (MySQL; ignored elsewhere). */
	unsignedFloat(name: string): ColumnBuilder {
		return this.#add(name, "float", { unsigned: true });
	}

	/** Unsigned double (MySQL; ignored elsewhere). */
	unsignedDouble(name: string): ColumnBuilder {
		return this.#add(name, "double", { unsigned: true });
	}

	/** Unsigned decimal (MySQL; ignored elsewhere). */
	unsignedDecimal(name: string, precision = 10, scale = 2): ColumnBuilder {
		return this.#add(name, "decimal", { precision, scale, unsigned: true });
	}

	/** Boolean. */
	boolean(name: string): ColumnBuilder {
		return this.#add(name, "boolean");
	}

	/** DATE. */
	date(name: string): ColumnBuilder {
		return this.#add(name, "date");
	}

	/** TIME. */
	time(name: string): ColumnBuilder {
		return this.#add(name, "time");
	}

	/** TIME with time zone (native on PostgreSQL, `time` elsewhere). */
	timeTz(name: string): ColumnBuilder {
		return this.#add(name, "timetz");
	}

	/** DATETIME / TIMESTAMP. */
	datetime(name: string): ColumnBuilder {
		return this.#add(name, "datetime");
	}

	/** Alias of `datetime`. */
	timestamp(name: string): ColumnBuilder {
		return this.#add(name, "datetime");
	}

	/** DATETIME with time zone / `timestamptz`. */
	dateTimeTz(name: string): ColumnBuilder {
		return this.#add(name, "datetimetz");
	}

	/** TIMESTAMP with time zone (`timestamptz`). */
	timestampTz(name: string): ColumnBuilder {
		return this.#add(name, "timestamptz");
	}

	/** JSON document. */
	json(name: string): ColumnBuilder {
		return this.#add(name, "json");
	}

	/** JSON document (`jsonb` on PostgreSQL, `json` on MySQL, text on SQLite). */
	jsonb(name: string): ColumnBuilder {
		return this.#add(name, "jsonb");
	}

	/** UUID (native on PostgreSQL, CHAR(36) elsewhere). */
	uuid(name: string): ColumnBuilder {
		return this.#add(name, "uuid");
	}

	/** ULID (CHAR(26) on MySQL/PostgreSQL, text on SQLite). */
	ulid(name: string): ColumnBuilder {
		return this.#add(name, "ulid");
	}

	/** MySQL native `ENUM`; `varchar` + `check` emulation elsewhere. */
	enum(name: string, values: readonly string[]): ColumnBuilder {
		return this.#add(name, "enum", { values: enumValues(name, values) });
	}

	/** MySQL native `SET` (throws a `SchemaError` on other dialects). */
	set(name: string, values: readonly string[]): ColumnBuilder {
		return this.#add(name, "set", { values: enumValues(name, values) });
	}

	/** PostgreSQL `inet`; `varchar(45)` on MySQL and `text` on SQLite. */
	inet(name: string): ColumnBuilder {
		return this.#add(name, "inet");
	}

	/** IPv4/IPv6 address (`varchar(45)`). */
	ipAddress(name: string): ColumnBuilder {
		return this.string(name, 45);
	}

	/** MAC address (`varchar(17)`). */
	macAddress(name: string): ColumnBuilder {
		return this.string(name, 17);
	}

	/** Binary blob. */
	binary(name: string): ColumnBuilder {
		return this.#add(name, "binary");
	}

	/** Foreign-key ULID column; chain `.constrained()`. */
	foreignUlid(name: string): ColumnBuilder {
		return this.#add(name, "ulid");
	}

	/** Foreign-key UUID column; chain `.constrained()`. */
	foreignUuid(name: string): ColumnBuilder {
		return this.#add(name, "uuid");
	}

	/** Foreign-key integer column; chain `.references("users.id")`. */
	foreignId(name: string): ColumnBuilder {
		return this.#add(name, "bigint");
	}

	/**
	 * Foreign-key column for another model class (`foreignIdFor(User)` →
	 * `userId` referencing `users.id`; override the column name with the
	 * second argument).
	 */
	foreignIdFor(
		modelOrTable: string | { readonly __table: string },
		name?: string,
		column = "id",
	): ColumnBuilder {
		const table =
			typeof modelOrTable === "string" ? modelOrTable : modelOrTable.__table;
		validateIdentifier("table", table);
		const columnName = name ?? `${table.replace(/s$/, "")}Id`;
		validateIdentifier("column", columnName);
		const builder = this.#add(columnName, "bigint");
		return builder.references(
			`${table}.${column}` as `${string}.${string}`,
		) as ColumnBuilder;
	}

	/** Adds nullable `createdAt` / `updatedAt` datetime columns. */
	timestamps(createdAt = "createdAt", updatedAt = "updatedAt"): this {
		this.#add(createdAt, "datetime", { nullable: true });
		this.#add(updatedAt, "datetime", { nullable: true });
		return this;
	}

	/** Alias of `timestamps` (Laravel's `nullableTimestamps`). */
	nullableTimestamps(createdAt = "createdAt", updatedAt = "updatedAt"): this {
		return this.timestamps(createdAt, updatedAt);
	}

	/** Adds nullable `createdAt` / `updatedAt` timestamp-with-time-zone columns. */
	timestampsTz(createdAt = "createdAt", updatedAt = "updatedAt"): this {
		this.#add(createdAt, "timestamptz", { nullable: true });
		this.#add(updatedAt, "timestamptz", { nullable: true });
		return this;
	}

	/** Adds a nullable `deletedAt` datetime column. */
	softDeletes(column = "deletedAt"): this {
		this.#add(column, "datetime", { nullable: true });
		return this;
	}

	/** Adds a nullable `deletedAt` timestamp-with-time-zone column. */
	softDeletesTz(column = "deletedAt"): this {
		this.#add(column, "timestamptz", { nullable: true });
		return this;
	}

	/** Adds a nullable `rememberToken` string column. */
	rememberToken(): this {
		this.#add("rememberToken", "string", { length: 100, nullable: true });
		return this;
	}

	/** Adds `${name}Id` + `${name}Type` columns and their index. */
	morphs(name: string, indexName?: string): this {
		this.#addMorph(name, false, false, indexName);
		return this;
	}

	/** Nullable `morphs`. */
	nullableMorphs(name: string, indexName?: string): this {
		this.#addMorph(name, true, false, indexName);
		return this;
	}

	/** `morphs` using UUID keys. */
	uuidMorphs(name: string, indexName?: string): this {
		this.#addMorph(name, false, true, indexName);
		return this;
	}

	/** Nullable `uuidMorphs`. */
	nullableUuidMorphs(name: string, indexName?: string): this {
		this.#addMorph(name, true, true, indexName);
		return this;
	}

	#addMorph(
		name: string,
		nullable: boolean,
		uuidKeys: boolean,
		indexName?: string,
	): void {
		const idColumn = `${name}Id`;
		const typeColumn = `${name}Type`;
		this.#add(
			idColumn,
			uuidKeys ? "uuid" : "bigint",
			uuidKeys ? { nullable } : { nullable, unsigned: true },
		);
		this.#add(typeColumn, "string", { nullable });
		this.index([idColumn, typeColumn], indexName);
	}

	/** MySQL table comment (`comment = '…'`); PostgreSQL uses `comment on`. */
	comment(text: string): this {
		this.tableComment = text;
		return this;
	}

	/** MySQL table character set; omitted on other dialects. */
	charset(name: string): this {
		this.tableCharset = validateCharset("charset", name);
		return this;
	}

	/** MySQL table collation; omitted on other dialects. */
	collation(name: string): this {
		this.tableCollation = validateCharset("collation", name);
		return this;
	}

	/** Declares a table-level foreign key constraint. */
	foreign(
		columns: string | readonly string[],
		name?: string,
	): ForeignKeyBuilder {
		const list = toArray(columns);
		for (const column of list) validateIdentifier("column", column);
		const spec: ForeignKeySpec = { columns: list, name };
		this.foreignKeys.push(spec);
		return new ForeignKeyBuilder(spec);
	}

	/** Adds a (non-unique) index on one or more columns. */
	index(columns: string | readonly string[], name?: string): this {
		this.indexes.push({ kind: "index", columns: toArray(columns), name });
		return this;
	}

	/** Adds a unique constraint on one or more columns. */
	unique(columns: string | readonly string[], name?: string): this {
		this.indexes.push({ kind: "unique", columns: toArray(columns), name });
		return this;
	}

	/**
	 * Adds a MySQL `FULLTEXT` index. PostgreSQL needs a GIN index over
	 * `to_tsvector` and SQLite needs FTS5 virtual tables, so this throws a
	 * `SchemaError` on those dialects instead of emitting invalid SQL.
	 */
	fullText(columns: string | readonly string[], name?: string): this {
		this.indexes.push({ kind: "fulltext", columns: toArray(columns), name });
		return this;
	}

	/**
	 * Adds a spatial index: MySQL `SPATIAL INDEX`, PostgreSQL GiST. SQLite
	 * has no spatial indexes, so this throws a `SchemaError` there.
	 */
	spatialIndex(columns: string | readonly string[], name?: string): this {
		this.indexes.push({ kind: "spatial", columns: toArray(columns), name });
		return this;
	}
}

/** Column/index DSL for `alter()`. */
export class AlterTableBuilder extends TableBuilder {
	/** @internal */ readonly drops: string[] = [];
	/** @internal */ readonly renames: Array<{ from: string; to: string }> = [];
	/** @internal */ readonly droppedIndexes: string[] = [];
	/** @internal */ readonly droppedConstraints: string[] = [];
	/** @internal */ readonly droppedMorphs: Array<{
		name: string;
		index?: string;
	}> = [];
	/** @internal */ droppedPrimary = false;

	/** Drops one or more columns. */
	dropColumn(name: string | readonly string[]): this {
		for (const column of toArray(name)) {
			validateIdentifier("column", column);
			this.drops.push(column);
		}
		return this;
	}

	/** Renames a column. */
	renameColumn(from: string, to: string): this {
		validateIdentifier("column", from);
		validateIdentifier("column", to);
		this.renames.push({ from, to });
		return this;
	}

	/** Drops an index by name. */
	dropIndex(name: string): this {
		validateIdentifier("index", name);
		this.droppedIndexes.push(name);
		return this;
	}

	/**
	 * Drops a unique constraint by name (PostgreSQL `drop constraint`,
	 * index drop elsewhere).
	 */
	dropUnique(name: string): this {
		validateIdentifier("index", name);
		this.droppedConstraints.push(name);
		return this;
	}

	/** Drops a foreign key by name (same mechanics as `dropUnique`). */
	dropForeign(name: string): this {
		validateIdentifier("index", name);
		this.droppedConstraints.push(name);
		return this;
	}

	/**
	 * Drops the primary key. MySQL uses `drop primary key`, PostgreSQL drops
	 * the implicit `"<table>_pkey"` constraint and SQLite rebuilds the table.
	 */
	dropPrimary(): this {
		this.droppedPrimary = true;
		return this;
	}

	/** Drops the `createdAt` / `updatedAt` columns created by `timestamps()`. */
	dropTimestamps(createdAt = "createdAt", updatedAt = "updatedAt"): this {
		return this.dropColumn([createdAt, updatedAt]);
	}

	/** Drops the soft-delete column. */
	dropSoftDeletes(column = "deletedAt"): this {
		return this.dropColumn(column);
	}

	/** Drops the time-zone soft-delete column. */
	dropSoftDeletesTz(column = "deletedAt"): this {
		return this.dropColumn(column);
	}

	/** Drops the `${name}Id` / `${name}Type` columns created by `morphs()`. */
	dropMorphs(name: string, indexName?: string): this {
		this.droppedMorphs.push({ name, index: indexName });
		return this.dropColumn([`${name}Id`, `${name}Type`]);
	}

	/** Drops the `rememberToken` column. */
	dropRememberToken(): this {
		return this.dropColumn("rememberToken");
	}

	/** Drops a fulltext index by name (same mechanics as `dropIndex`). */
	dropFullText(name: string): this {
		return this.dropIndex(name);
	}
}

/** DDL entry point — `orm.schemaBuilder()`. */
export class SchemaBuilder<S extends Schema> {
	readonly #orm: Orm<S>;

	/** @internal */
	constructor(orm: Orm<S>) {
		this.#orm = orm;
	}

	/** The dialect DDL is compiled for. */
	get dialect(): DialectKind {
		return this.#orm.dialectKind;
	}

	/** Creates a table. */
	async create(
		table: string,
		callback: (table: TableBuilder) => void,
	): Promise<void> {
		await this.#create(table, callback, false);
	}

	/** Creates a table unless it already exists. */
	async createIfNotExists(
		table: string,
		callback: (table: TableBuilder) => void,
	): Promise<void> {
		await this.#create(table, callback, true);
	}

	async #create(
		table: string,
		callback: (table: TableBuilder) => void,
		ifNotExists: boolean,
	): Promise<void> {
		validateIdentifier("table", table);
		const builder = new TableBuilder();
		callback(builder);
		if (builder.columns.length === 0) {
			throw new SchemaError(
				`create("${table}"): at least one column is required.`,
			);
		}
		for (const column of builder.columns) {
			if (column.change === true) {
				throw new SchemaError(
					`create("${table}.${column.name}"): change() is only valid inside alter().`,
				);
			}
			if (column.primary && column.nullable) {
				throw new SchemaError(
					`create("${table}.${column.name}"): a primary key column cannot be nullable.`,
				);
			}
			if (column.startingValue !== undefined && !column.autoIncrement) {
				throw new SchemaError(
					`create("${table}.${column.name}"): startingValue() requires an auto-increment column.`,
				);
			}
		}
		await this.#orm.execute(this.#compileCreate(table, builder, ifNotExists));
		await this.#applyCreatePrologues(table, builder);
		for (const index of builder.indexes) {
			await this.#createIndex(table, index);
		}
	}

	/**
	 * PostgreSQL has no inline `comment` and no table-level auto-increment
	 * option, so those run as follow-up statements after `create table`.
	 */
	async #applyCreatePrologues(
		table: string,
		builder: TableBuilder,
	): Promise<void> {
		if (this.dialect !== "postgres") return;
		for (const column of builder.columns) {
			if (column.comment !== undefined) {
				await this.#orm.raw(
					`comment on column "${table}"."${column.name}" is ${quoteString(column.comment)}`,
				);
			}
		}
		if (builder.tableComment !== undefined) {
			await this.#orm.raw(
				`comment on table "${table}" is ${quoteString(builder.tableComment)}`,
			);
		}
		const starting = builder.columns.find(
			(column) => column.startingValue !== undefined,
		);
		if (starting?.startingValue !== undefined) {
			await this.#orm.raw(
				`alter sequence "${table}_${starting.name}_seq" restart with ${starting.startingValue}`,
			);
		}
	}

	/** Alters an existing table. Each operation becomes its own statement —
	 *  the only form SQLite accepts, and safe on every other dialect. */
	async alter(
		table: string,
		callback: (table: AlterTableBuilder) => void,
	): Promise<void> {
		validateIdentifier("table", table);
		const builder = new AlterTableBuilder();
		callback(builder);
		const executor = this.#orm.executor() as AnyStatement;
		const additions = builder.columns.filter(
			(column) => column.change !== true,
		);
		const modifications = builder.columns.filter(
			(column) => column.change === true,
		);

		for (const column of additions) {
			await this.#orm.execute(
				executor.schema
					.alterTable(table)
					.addColumn(
						column.name,
						this.#columnType(column),
						(col: AnyStatement) => this.#applyColumn(col, column, true),
					)
					.compile() as CompiledQuery,
			);
			if (this.dialect === "postgres" && column.comment !== undefined) {
				await this.#orm.raw(
					`comment on column "${table}"."${column.name}" is ${quoteString(column.comment)}`,
				);
			}
		}
		for (const column of modifications) {
			await this.#changeColumn(table, column);
		}
		for (const column of additions) {
			if (column.references === undefined) continue;
			if (this.dialect === "sqlite") {
				throw new SchemaError(
					`alter("${table}"): SQLite cannot add the foreign key for "${column.name}" to an existing table. Recreate the table instead.`,
				);
			}
			await this.#orm.execute(
				executor.schema
					.alterTable(table)
					.addForeignKeyConstraint(
						`${table}_${column.name}_foreign`,
						[column.name],
						column.references.table,
						[column.references.column],
						(fk: AnyStatement) => this.#applyReferenceActions(fk, column),
					)
					.compile() as CompiledQuery,
			);
		}
		for (const foreignKey of builder.foreignKeys) {
			if (foreignKey.table === undefined || foreignKey.column === undefined) {
				throw new SchemaError(
					`foreign(${foreignKey.columns.join(", ")}): references() / on() is required.`,
				);
			}
			if (this.dialect === "sqlite") {
				throw new SchemaError(
					`alter("${table}"): SQLite cannot add the foreign key "${foreignKey.columns.join(", ")}" to an existing table. Recreate the table instead.`,
				);
			}
			await this.#orm.execute(
				executor.schema
					.alterTable(table)
					.addForeignKeyConstraint(
						foreignKey.name ??
							`${table}_${foreignKey.columns.join("_")}_foreign`,
						[...foreignKey.columns],
						foreignKey.table,
						[foreignKey.column],
						(fk: AnyStatement) => this.#applyReferenceActions(fk, foreignKey),
					)
					.compile() as CompiledQuery,
			);
		}
		for (const morph of builder.droppedMorphs) {
			const indexName =
				morph.index ?? `${table}_${morph.name}Id_${morph.name}Type_index`;
			await this.#dropIndexByName(table, indexName, true);
		}
		for (const name of builder.drops) {
			await this.#orm.execute(
				executor.schema
					.alterTable(table)
					.dropColumn(name)
					.compile() as CompiledQuery,
			);
		}
		for (const rename of builder.renames) {
			await this.#orm.execute(
				executor.schema
					.alterTable(table)
					.renameColumn(rename.from, rename.to)
					.compile() as CompiledQuery,
			);
		}
		for (const name of builder.droppedIndexes) {
			await this.#dropIndexByName(table, name);
		}
		for (const name of builder.droppedConstraints) {
			await this.#dropConstraint(table, name);
		}
		if (builder.droppedPrimary) {
			await this.#dropPrimary(table);
		}
		for (const index of builder.indexes) {
			await this.#createIndex(table, index);
		}
	}

	/** Modifies an existing column. */
	async #changeColumn(table: string, column: ColumnSpec): Promise<void> {
		const dialect = this.dialect;
		if (dialect === "sqlite") {
			await this.#changeColumnSqlite(table, column);
			return;
		}
		const executor = this.#orm.executor() as AnyStatement;
		if (dialect === "mysql") {
			await this.#orm.execute(
				executor.schema
					.alterTable(table)
					.modifyColumn(
						column.name,
						this.#columnType(column),
						(col: AnyStatement) => this.#applyColumn(col, column, true),
					)
					.compile() as CompiledQuery,
			);
			return;
		}
		// PostgreSQL: one `alter column` action per statement.
		await this.#orm.execute(
			executor.schema
				.alterTable(table)
				.alterColumn(column.name, (alter: AnyStatement) =>
					alter.setDataType(this.#columnType(column)),
				)
				.compile() as CompiledQuery,
		);
		await this.#orm.execute(
			executor.schema
				.alterTable(table)
				.alterColumn(column.name, (alter: AnyStatement) =>
					column.nullable ? alter.dropNotNull() : alter.setNotNull(),
				)
				.compile() as CompiledQuery,
		);
		if (column.defaultNow) {
			await this.#orm.execute(
				executor.schema
					.alterTable(table)
					.alterColumn(column.name, (alter: AnyStatement) =>
						alter.setDefault(sql`now()`),
					)
					.compile() as CompiledQuery,
			);
		} else if (column.hasDefault) {
			await this.#orm.execute(
				executor.schema
					.alterTable(table)
					.alterColumn(column.name, (alter: AnyStatement) =>
						alter.setDefault(column.defaultValue),
					)
					.compile() as CompiledQuery,
			);
		}
	}

	/** SQLite `change()`: rewrite the column definition and rebuild the table. */
	async #changeColumnSqlite(table: string, column: ColumnSpec): Promise<void> {
		if (column.generated !== undefined) {
			throw new SchemaError(
				`change("${table}.${column.name}"): SQLite cannot modify a generated column in place. Recreate the table instead.`,
			);
		}
		const createSql = await this.#readCreateSql(table);
		const segment = sqliteColumnSegment(createSql, column.name);
		if (segment === null) {
			throw new SchemaError(
				`change("${table}.${column.name}"): SQLite could not find the column definition.`,
			);
		}
		const definition = this.#renderSqliteColumn(column);
		const rewritten =
			createSql.slice(0, segment.start) +
			definition +
			createSql.slice(segment.end);
		await this.#rebuildSqlite(table, rewritten);
	}

	/** Drops the primary key. */
	async #dropPrimary(table: string): Promise<void> {
		const dialect = this.dialect;
		if (dialect === "mysql") {
			await this.#orm.raw(`alter table \`${table}\` drop primary key`);
			return;
		}
		if (dialect === "postgres") {
			await this.#orm.raw(
				`alter table "${table}" drop constraint "${table}_pkey"`,
			);
			return;
		}
		const createSql = await this.#readCreateSql(table);
		const info = await this.#orm.raw(`pragma table_info('${table}')`);
		const pk = info.rows.find((row) => Number(row.pk) > 0);
		if (pk === undefined) return;
		const segment = sqliteColumnSegment(createSql, String(pk.name));
		if (segment === null) return;
		const clause = createSql
			.slice(segment.start, segment.end)
			.replace(/\bprimary\s+key\b/gi, "")
			.replace(/\bautoincrement\b/gi, "")
			.replace(/\s+/g, " ")
			.trim();
		const rewritten =
			createSql.slice(0, segment.start) + clause + createSql.slice(segment.end);
		await this.#rebuildSqlite(table, rewritten);
	}

	async #readCreateSql(table: string): Promise<string> {
		const master = await this.#orm.raw(
			`select sql from sqlite_master where type = 'table' and name = '${table}'`,
		);
		const sqlText =
			master.rows.length > 0 ? String(master.rows[0]!.sql ?? "") : "";
		if (sqlText === "") {
			throw new SchemaError(`SQLite rebuild: table "${table}" not found.`);
		}
		return sqlText;
	}

	/** SQLite table rebuild: create a scratch table, copy rows, swap names. */
	async #rebuildSqlite(table: string, createSql: string): Promise<void> {
		const orm = this.#orm;
		const info = await orm.raw(`pragma table_info('${table}')`);
		const columns = info.rows.map((row) => String(row.name));
		const indexRows = await orm.raw(
			`select name, sql from sqlite_master where type = 'index' and tbl_name = '${table}' and sql is not null`,
		);
		const tempTable = `${table}__barq_rebuild`;
		const quotedColumns = columns.map(quoteSqlite).join(", ");
		const statements: string[] = [
			withTableName(createSql, tempTable),
			`insert into ${quoteSqlite(tempTable)} (${quotedColumns}) select ${quotedColumns} from ${quoteSqlite(table)}`,
			`drop table ${quoteSqlite(table)}`,
			`alter table ${quoteSqlite(tempTable)} rename to ${quoteSqlite(table)}`,
		];
		for (const row of indexRows.rows) {
			statements.push(String(row.sql));
		}
		await orm.raw("pragma foreign_keys = off");
		try {
			for (const statement of statements) {
				await orm.raw(statement);
			}
		} finally {
			await orm.raw("pragma foreign_keys = on");
		}
	}

	/** Renders one SQLite column definition for the rebuild path. */
	#renderSqliteColumn(column: ColumnSpec): string {
		let output = `${quoteSqlite(column.name)} ${this.#sqliteTypeName(column)}`;
		if (column.primary) output += " primary key";
		if (column.primary && column.autoIncrement) output += " autoincrement";
		if (!column.nullable && !column.primary) output += " not null";
		if (column.hasDefault) {
			output += ` default ${renderSqliteDefault(column.defaultValue)}`;
		}
		if (column.defaultNow) output += " default CURRENT_TIMESTAMP";
		if (column.unique) output += " unique";
		if (column.values !== undefined) {
			output += ` check (${quoteSqlite(column.name)} in (${column.values
				.map((value) => quoteString(value))
				.join(", ")}))`;
		}
		if (column.references !== undefined) {
			output += ` references ${quoteSqlite(column.references.table)} (${quoteSqlite(column.references.column)})`;
			if (column.onDelete !== undefined)
				output += ` on delete ${column.onDelete}`;
			if (column.onUpdate !== undefined)
				output += ` on update ${column.onUpdate}`;
		}
		return output;
	}

	/** SQLite type name for a column; matches `create()` exactly. */
	#sqliteTypeName(column: ColumnSpec): string {
		const type = this.#columnType(column);
		// SQLite always receives a plain type name, never a raw expression.
		return typeof type === "string" ? type : "text";
	}

	/** Drops a table. */
	async drop(table: string): Promise<void> {
		validateIdentifier("table", table);
		const compiled = (this.#orm.executor() as AnyStatement).schema
			.dropTable(table)
			.compile() as CompiledQuery;
		await this.#orm.execute(compiled);
	}

	/** Drops a table when it exists. */
	async dropIfExists(table: string): Promise<void> {
		validateIdentifier("table", table);
		const compiled = (this.#orm.executor() as AnyStatement).schema
			.dropTable(table)
			.ifExists()
			.compile() as CompiledQuery;
		await this.#orm.execute(compiled);
	}

	/** Renames a table. */
	async rename(from: string, to: string): Promise<void> {
		validateIdentifier("table", from);
		validateIdentifier("table", to);
		const compiled = (this.#orm.executor() as AnyStatement).schema
			.alterTable(from)
			.renameTo(to)
			.compile() as CompiledQuery;
		await this.#orm.execute(compiled);
	}

	/** Whether a table exists (introspection, works on every dialect). */
	async hasTable(table: string): Promise<boolean> {
		const tables = await this.#orm.executor().introspection.getTables();
		return tables.some((candidate) => candidate.name === table);
	}

	/** Whether a table has a column (introspection, works on every dialect). */
	async hasColumn(table: string, column: string): Promise<boolean> {
		validateIdentifier("table", table);
		validateIdentifier("column", column);
		const tables = await this.#orm.executor().introspection.getTables();
		const found = tables.find((candidate) => candidate.name === table);
		return found?.columns.some((entry) => entry.name === column) ?? false;
	}

	/**
	 * The database's reported type for a column, or `null` when the table or
	 * column does not exist. The exact string is engine-specific.
	 */
	async getColumnType(table: string, column: string): Promise<string | null> {
		validateIdentifier("table", table);
		validateIdentifier("column", column);
		const tables = await this.#orm.executor().introspection.getTables();
		const found = tables.find((candidate) => candidate.name === table);
		const entry = found?.columns.find((candidate) => candidate.name === column);
		return entry?.dataType ?? null;
	}

	#compileCreate(
		table: string,
		builder: TableBuilder,
		ifNotExists = false,
	): CompiledQuery {
		if (this.dialect === "sqlite") {
			for (const index of builder.indexes) {
				if (index.kind === "fulltext" || index.kind === "spatial") {
					throw new SchemaError(
						`${index.kind === "fulltext" ? "fullText" : "spatialIndex"} on "${table}": SQLite does not support ${index.kind} indexes.`,
					);
				}
			}
		}
		if (this.dialect === "postgres") {
			for (const index of builder.indexes) {
				if (index.kind === "fulltext") {
					throw new SchemaError(
						`fullText on "${table}": PostgreSQL needs a GIN index over to_tsvector; use a raw index instead.`,
					);
				}
			}
		}
		let query = (this.#orm.executor() as AnyStatement).schema.createTable(
			table,
		);
		if (ifNotExists) query = query.ifNotExists();
		for (const column of builder.columns) {
			query = query.addColumn(
				column.name,
				this.#columnType(column) as never,
				(col: AnyStatement) => this.#applyColumn(col, column),
			);
		}
		// Foreign keys are table-level constraints: MySQL parses but ignores
		// inline `references`, so they must be declared here to be enforced.
		for (const column of builder.columns) {
			const reference = column.references;
			if (reference === undefined) continue;
			query = query.addForeignKeyConstraint(
				`${table}_${column.name}_foreign`,
				[column.name],
				reference.table,
				[reference.column],
				(fk: AnyStatement) => this.#applyReferenceActions(fk, column),
			);
		}
		for (const foreignKey of builder.foreignKeys) {
			if (foreignKey.table === undefined || foreignKey.column === undefined) {
				throw new SchemaError(
					`foreign(${foreignKey.columns.join(", ")}): references() / on() is required.`,
				);
			}
			query = query.addForeignKeyConstraint(
				foreignKey.name ?? `${table}_${foreignKey.columns.join("_")}_foreign`,
				[...foreignKey.columns],
				foreignKey.table,
				[foreignKey.column],
				(fk: AnyStatement) => this.#applyReferenceActions(fk, foreignKey),
			);
		}
		const options = this.#tableOptions(builder);
		if (options !== null) query = query.modifyEnd(sql.raw(options));
		return query.compile() as CompiledQuery;
	}

	/** MySQL-only table options (`charset`, `collate`, `comment`, `auto_increment`). */
	#tableOptions(builder: TableBuilder): string | null {
		if (this.dialect !== "mysql") return null;
		const parts: string[] = [];
		if (builder.tableCharset !== undefined) {
			parts.push(`character set ${builder.tableCharset}`);
		}
		if (builder.tableCollation !== undefined) {
			parts.push(`collate ${builder.tableCollation}`);
		}
		if (builder.tableComment !== undefined) {
			parts.push(`comment = ${quoteString(builder.tableComment)}`);
		}
		const starting = builder.columns.find(
			(column) => column.startingValue !== undefined,
		);
		if (starting?.startingValue !== undefined) {
			parts.push(`auto_increment = ${starting.startingValue}`);
		}
		return parts.length > 0 ? parts.join(" ") : null;
	}

	#applyReferenceActions(
		foreignKey: AnyStatement,
		reference: { onDelete?: ReferentialAction; onUpdate?: ReferentialAction },
	): AnyStatement {
		let output = foreignKey;
		if (reference.onDelete !== undefined)
			output = output.onDelete(reference.onDelete);
		if (reference.onUpdate !== undefined)
			output = output.onUpdate(reference.onUpdate);
		return output;
	}

	async #createIndex(table: string, index: IndexSpec): Promise<void> {
		if (index.columns.length === 0) {
			throw new SchemaError(
				`index on "${table}": at least one column is required.`,
			);
		}
		const name =
			index.name ?? `${table}_${index.columns.join("_")}_${index.kind}`;
		validateIdentifier("index", name);
		if (index.kind === "fulltext") {
			if (this.dialect !== "mysql") {
				throw new SchemaError(
					`fullText("${name}"): only MySQL supports FULLTEXT indexes. PostgreSQL needs a GIN index over to_tsvector and SQLite needs an FTS5 virtual table.`,
				);
			}
			const columns = index.columns.map((c) => `\`${c}\``).join(", ");
			await this.#orm.raw(
				`create fulltext index \`${name}\` on \`${table}\` (${columns})`,
			);
			return;
		}
		if (index.kind === "spatial") {
			if (this.dialect === "mysql") {
				const columns = index.columns.map((c) => `\`${c}\``).join(", ");
				await this.#orm.raw(
					`create spatial index \`${name}\` on \`${table}\` (${columns})`,
				);
				return;
			}
			if (this.dialect === "postgres") {
				await this.#orm.execute(
					(this.#orm.executor() as AnyStatement).schema
						.createIndex(name)
						.on(table)
						.columns([...index.columns])
						.using("gist")
						.compile() as CompiledQuery,
				);
				return;
			}
			throw new SchemaError(
				`spatialIndex("${name}"): SQLite has no spatial indexes. Use MySQL or PostgreSQL.`,
			);
		}
		let query = (this.#orm.executor() as AnyStatement).schema
			.createIndex(name)
			.on(table)
			.columns([...index.columns]);
		if (index.kind === "unique") query = query.unique();
		await this.#orm.execute(query.compile() as CompiledQuery);
	}

	async #dropIndexByName(
		table: string,
		name: string,
		tolerant = false,
	): Promise<void> {
		const dialect = this.dialect;
		if (dialect === "mysql") {
			try {
				await this.#orm.raw(`alter table \`${table}\` drop index \`${name}\``);
			} catch (error) {
				if (!tolerant) throw error;
			}
			return;
		}
		await this.#orm.raw(`drop index if exists "${name}"`);
	}

	async #dropConstraint(table: string, name: string): Promise<void> {
		const dialect = this.dialect;
		if (dialect === "postgres") {
			// `dropUnique` may target either a real constraint (inline
			// `unique`) or a plain unique index (`create unique index`), so
			// fall back to `drop index` when the constraint does not exist.
			try {
				await this.#orm.raw(`alter table "${table}" drop constraint "${name}"`);
			} catch {
				await this.#orm.raw(`drop index "${name}"`);
			}
			return;
		}
		if (dialect === "mysql") {
			// `dropForeign` needs `drop foreign key`; `dropUnique` targets an
			// index, so try the constraint form first and fall back.
			try {
				await this.#orm.raw(
					`alter table \`${table}\` drop foreign key \`${name}\``,
				);
			} catch {
				await this.#orm.raw(`alter table \`${table}\` drop index \`${name}\``);
			}
			return;
		}
		await this.#dropConstraintSqlite(table, name);
	}

	/**
	 * SQLite: a named unique index is dropped directly; an inline/table-level
	 * constraint (including every foreign key) needs the documented table
	 * rebuild — new table, copy, drop, rename, recreate indexes.
	 */
	async #dropConstraintSqlite(table: string, name: string): Promise<void> {
		const orm = this.#orm;
		const indexes = await orm.raw(`pragma index_list('${table}')`);
		const isIndex = indexes.rows.some((row) => String(row.name) === name);
		if (isIndex) {
			await orm.raw(`drop index if exists "${name}"`);
			return;
		}
		const master = await orm.raw(
			`select sql from sqlite_master where type = 'table' and name = '${table}'`,
		);
		const createSql =
			master.rows.length > 0 ? String(master.rows[0]!.sql ?? "") : "";
		if (createSql === "") {
			throw new SchemaError(
				`dropUnique("${name}") / dropForeign("${name}") on SQLite: table "${table}" not found.`,
			);
		}
		const info = await orm.raw(`pragma table_info('${table}')`);
		const columns = info.rows.map((row) => String(row.name));
		const indexRows = await orm.raw(
			`select name, sql from sqlite_master where type = 'index' and tbl_name = '${table}' and sql is not null`,
		);
		const plan = planSqliteRebuild({
			table,
			createSql,
			constraint: name,
			columns,
			indexes: indexRows.rows.map((row) => ({
				name: String(row.name),
				sql: String(row.sql),
			})),
		});
		// `pragma foreign_keys` is a no-op inside a transaction: disable it
		// first so dropping the old table cannot trip another table's FK.
		await orm.raw("pragma foreign_keys = off");
		try {
			for (const statement of plan.statements) {
				await orm.raw(statement);
			}
		} finally {
			await orm.raw("pragma foreign_keys = on");
		}
	}

	#applyColumn(
		col: AnyStatement,
		column: ColumnSpec,
		forAlter = false,
	): AnyStatement {
		let output = col;
		if (column.generated !== undefined) {
			output = output.generatedAlwaysAs(
				this.#generatedExpression(column.generated.expression),
			);
			if (column.generated.stored) {
				output = output.stored();
			} else if (this.dialect === "postgres") {
				throw new SchemaError(
					`virtualAs() on "${column.name}": PostgreSQL has no virtual generated columns. Use storedAs() instead.`,
				);
			} else {
				output = output.modifyEnd(sql`virtual`);
			}
			if (column.unique) output = output.unique();
			return this.#applyDialectColumnOptions(output, column, forAlter);
		}
		if (column.primary) output = output.primaryKey();
		if (column.autoIncrement) {
			output =
				this.dialect === "postgres"
					? output.generatedByDefaultAsIdentity()
					: output.autoIncrement();
		}
		if (!column.nullable || column.primary) output = output.notNull();
		if (column.hasDefault) output = output.defaultTo(column.defaultValue);
		if (column.defaultNow) {
			output = output.defaultTo(
				this.dialect === "postgres" ? sql`now()` : sql`CURRENT_TIMESTAMP`,
			);
		}
		if (column.unique) output = output.unique();
		// ENUM/SET are emulated with a CHECK constraint outside MySQL.
		if (column.values !== undefined && this.dialect !== "mysql") {
			output = output.check(
				sql`${sql.ref(column.name)} in (${sql.join(
					column.values.map((value) => sql.lit(value)),
					sql`, `,
				)})`,
			);
		}
		return this.#applyDialectColumnOptions(output, column, forAlter);
	}

	/** MySQL-only column attributes; omitted on dialects without them. */
	#applyDialectColumnOptions(
		col: AnyStatement,
		column: ColumnSpec,
		forAlter: boolean,
	): AnyStatement {
		if (this.dialect !== "mysql") return col;
		let output = col;
		if (column.charset !== undefined || column.collation !== undefined) {
			const parts: string[] = [];
			if (column.charset !== undefined)
				parts.push(`character set ${column.charset}`);
			if (column.collation !== undefined)
				parts.push(`collate ${column.collation}`);
			output = output.modifyFront(sql.raw(parts.join(" ")));
		}
		if (column.useCurrentOnUpdate === true) {
			output = output.modifyEnd(sql`on update CURRENT_TIMESTAMP`);
		}
		if (column.invisible === true) {
			output = output.modifyEnd(sql`invisible`);
		}
		if (column.comment !== undefined) {
			output = output.modifyEnd(sql`comment ${sql.lit(column.comment)}`);
		}
		if (forAlter) {
			if (column.first === true) {
				output = output.modifyEnd(sql`first`);
			} else if (column.after !== undefined) {
				output = output.modifyEnd(sql.raw(`after \`${column.after}\``));
			}
		}
		return output;
	}

	#generatedExpression(
		expression: string | ReturnType<typeof sql>,
	): ReturnType<typeof sql> {
		return typeof expression === "string" ? sql.raw(expression) : expression;
	}

	#columnType(column: ColumnSpec): ReturnType<typeof sql> | string {
		const dialect = this.dialect;
		const unsigned = column.unsigned === true;
		switch (column.type) {
			case "string":
				return dialect === "sqlite"
					? "text"
					: `varchar(${column.length ?? 255})`;
			case "text":
				return "text";
			case "tinytext":
				return dialect === "mysql" ? sql`tinytext` : "text";
			case "mediumtext":
				return dialect === "mysql" ? sql`mediumtext` : "text";
			case "longtext":
				return dialect === "mysql" ? sql`longtext` : "text";
			case "char":
				return dialect === "sqlite" ? "text" : `char(${column.length ?? 255})`;
			case "integer":
				if (dialect === "mysql" && unsigned) {
					return sql`integer unsigned`;
				}
				return "integer";
			case "bigint":
				// SQLite has no separate 64-bit type; `integer` is required for
				// `INTEGER PRIMARY KEY AUTOINCREMENT` to be legal.
				if (dialect === "sqlite") return "integer";
				if (dialect === "mysql" && unsigned) {
					return sql`bigint unsigned`;
				}
				return "bigint";
			case "tinyint":
				if (dialect === "mysql") {
					return unsigned ? sql`tinyint unsigned` : sql`tinyint`;
				}
				return dialect === "postgres" ? "smallint" : "integer";
			case "smallint":
				if (dialect === "mysql") {
					return unsigned ? sql`smallint unsigned` : sql`smallint`;
				}
				return dialect === "postgres" ? "smallint" : "integer";
			case "mediumint":
				if (dialect === "mysql") {
					return unsigned ? sql`mediumint unsigned` : sql`mediumint`;
				}
				return "integer";
			case "year":
				return dialect === "mysql" ? sql`year` : "integer";
			case "float":
				if (dialect === "mysql" && unsigned) return sql`float unsigned`;
				return dialect === "postgres" ? "real" : sql`float`;
			case "double":
				if (dialect === "mysql" && unsigned) return sql`double unsigned`;
				return dialect === "postgres" ? "double precision" : sql`double`;
			case "decimal": {
				const precision = column.precision ?? 10;
				const scale = column.scale ?? 2;
				if (dialect === "mysql" && unsigned) {
					return sql.raw(`decimal(${precision}, ${scale}) unsigned`);
				}
				return `decimal(${precision}, ${scale})`;
			}
			case "boolean":
				return dialect === "mysql"
					? sql`tinyint(1)`
					: dialect === "sqlite"
						? "integer"
						: "boolean";
			case "date":
				return "date";
			case "time":
				return "time";
			case "timetz":
				return dialect === "postgres" ? "timetz" : "time";
			case "datetime":
				return dialect === "mysql"
					? "datetime(3)"
					: dialect === "sqlite"
						? "text"
						: "timestamp";
			case "datetimetz":
				return dialect === "postgres"
					? "timestamptz"
					: dialect === "mysql"
						? sql`datetime(3)`
						: "text";
			case "timestamptz":
				return dialect === "postgres"
					? "timestamptz"
					: dialect === "mysql"
						? sql`timestamp`
						: "text";
			case "json":
				return dialect === "postgres"
					? "jsonb"
					: dialect === "mysql"
						? "json"
						: "text";
			case "jsonb":
				return dialect === "postgres"
					? "jsonb"
					: dialect === "mysql"
						? "json"
						: "text";
			case "uuid":
				return dialect === "postgres" ? "uuid" : "char(36)";
			case "ulid":
				return dialect === "sqlite" ? "text" : "char(26)";
			case "enum": {
				const values = column.values ?? [];
				if (dialect === "mysql") {
					return sql`enum(${sql.join(
						values.map((value) => sql.lit(value)),
						sql`, `,
					)})`;
				}
				return "varchar(255)";
			}
			case "set": {
				if (dialect !== "mysql") {
					throw new SchemaError(
						`set("${column.name}"): SET columns are MySQL-only.`,
					);
				}
				const values = column.values ?? [];
				return sql`set(${sql.join(
					values.map((value) => sql.lit(value)),
					sql`, `,
				)})`;
			}
			case "inet":
				// `inet` is not in Kysely's known data-type set, so it must be
				// echoed as a raw expression rather than a string.
				return dialect === "postgres"
					? sql`inet`
					: dialect === "mysql"
						? sql`varchar(45)`
						: "text";
			case "binary":
				return dialect === "postgres" ? "bytea" : "blob";
		}
	}
}
