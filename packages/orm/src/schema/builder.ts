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
import { planSqliteRebuild } from "./sqlite-rebuild";

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
}

/** Index / unique-constraint definition. */
export interface IndexSpec {
	kind: "index" | "unique";
	columns: string[];
	name?: string;
}

function toArray(value: string | readonly string[]): string[] {
	return typeof value === "string" ? [value] : [...value];
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
}

/** Column/index DSL for `create()`. */
export class TableBuilder {
	/** @internal */ readonly columns: ColumnSpec[] = [];
	/** @internal */ readonly indexes: IndexSpec[] = [];

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

	/** Boolean. */
	boolean(name: string): ColumnBuilder {
		return this.#add(name, "boolean");
	}

	/** DATE. */
	date(name: string): ColumnBuilder {
		return this.#add(name, "date");
	}

	/** DATETIME / TIMESTAMP. */
	datetime(name: string): ColumnBuilder {
		return this.#add(name, "datetime");
	}

	/** Alias of `datetime`. */
	timestamp(name: string): ColumnBuilder {
		return this.#add(name, "datetime");
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

	/** Binary blob. */
	binary(name: string): ColumnBuilder {
		return this.#add(name, "binary");
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
}

/** Column/index DSL for `alter()`. */
export class AlterTableBuilder extends TableBuilder {
	/** @internal */ readonly drops: string[] = [];
	/** @internal */ readonly renames: Array<{ from: string; to: string }> = [];
	/** @internal */ readonly droppedIndexes: string[] = [];
	/** @internal */ readonly droppedConstraints: string[] = [];

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
		validateIdentifier("table", table);
		const builder = new TableBuilder();
		callback(builder);
		if (builder.columns.length === 0) {
			throw new SchemaError(
				`create("${table}"): at least one column is required.`,
			);
		}
		for (const column of builder.columns) {
			if (column.primary && column.nullable) {
				throw new SchemaError(
					`create("${table}.${column.name}"): a primary key column cannot be nullable.`,
				);
			}
		}
		await this.#orm.execute(this.#compileCreate(table, builder));
		for (const index of builder.indexes) {
			await this.#createIndex(table, index);
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
		for (const column of builder.columns) {
			await this.#orm.execute(
				executor.schema
					.alterTable(table)
					.addColumn(
						column.name,
						this.#columnType(column),
						(col: AnyStatement) => this.#applyColumn(col, column),
					)
					.compile() as CompiledQuery,
			);
		}
		for (const column of builder.columns) {
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
		for (const index of builder.indexes) {
			await this.#createIndex(table, index);
		}
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

	#compileCreate(table: string, builder: TableBuilder): CompiledQuery {
		let query = (this.#orm.executor() as AnyStatement).schema.createTable(
			table,
		);
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
		return query.compile() as CompiledQuery;
	}

	#applyReferenceActions(
		foreignKey: AnyStatement,
		column: ColumnSpec,
	): AnyStatement {
		let output = foreignKey;
		if (column.onDelete !== undefined)
			output = output.onDelete(column.onDelete);
		if (column.onUpdate !== undefined)
			output = output.onUpdate(column.onUpdate);
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
		let query = (this.#orm.executor() as AnyStatement).schema
			.createIndex(name)
			.on(table)
			.columns([...index.columns]);
		if (index.kind === "unique") query = query.unique();
		await this.#orm.execute(query.compile() as CompiledQuery);
	}

	async #dropIndexByName(table: string, name: string): Promise<void> {
		const dialect = this.dialect;
		if (dialect === "mysql") {
			await this.#orm.raw(`alter table \`${table}\` drop index \`${name}\``);
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

	#applyColumn(col: AnyStatement, column: ColumnSpec): AnyStatement {
		let output = col;
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
		return output;
	}

	#columnType(column: ColumnSpec): ReturnType<typeof sql> | string {
		const dialect = this.dialect;
		switch (column.type) {
			case "string":
				return dialect === "sqlite"
					? "text"
					: `varchar(${column.length ?? 255})`;
			case "text":
				return "text";
			case "char":
				return dialect === "sqlite" ? "text" : `char(${column.length ?? 255})`;
			case "integer":
				if (dialect === "mysql" && column.unsigned === true) {
					return sql`integer unsigned`;
				}
				return "integer";
			case "bigint":
				// SQLite has no separate 64-bit type; `integer` is required for
				// `INTEGER PRIMARY KEY AUTOINCREMENT` to be legal.
				if (dialect === "sqlite") return "integer";
				if (dialect === "mysql" && column.unsigned === true) {
					return sql`bigint unsigned`;
				}
				return "bigint";
			case "tinyint":
				if (dialect === "mysql") {
					return column.unsigned === true
						? sql`tinyint unsigned`
						: sql`tinyint`;
				}
				return dialect === "postgres" ? "smallint" : "integer";
			case "smallint":
				if (dialect === "mysql") {
					return column.unsigned === true
						? sql`smallint unsigned`
						: sql`smallint`;
				}
				return dialect === "postgres" ? "smallint" : "integer";
			case "mediumint":
				if (dialect === "mysql") {
					return column.unsigned === true
						? sql`mediumint unsigned`
						: sql`mediumint`;
				}
				return "integer";
			case "float":
				return dialect === "postgres" ? "real" : sql`float`;
			case "double":
				return dialect === "postgres" ? "double precision" : sql`double`;
			case "decimal":
				return `decimal(${column.precision ?? 10}, ${column.scale ?? 2})`;
			case "boolean":
				return dialect === "mysql"
					? sql`tinyint(1)`
					: dialect === "sqlite"
						? "integer"
						: "boolean";
			case "date":
				return "date";
			case "datetime":
				return dialect === "mysql"
					? "datetime(3)"
					: dialect === "sqlite"
						? "text"
						: "timestamp";
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
			case "binary":
				return dialect === "postgres" ? "bytea" : "blob";
		}
	}
}
