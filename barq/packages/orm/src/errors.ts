// Error hierarchy for @barqel/barq-orm.
//
// Every error thrown by the ORM extends `OrmError` and carries a stable
// machine-readable `code`. Driver errors (mysql2 / pg / sqlite) are translated
// into these classes at the execution boundary so application code never has
// to match against driver-specific shapes.

/** Base class for every error thrown by the ORM. */
export class OrmError extends Error {
	readonly code: string;

	constructor(message: string, code: string, options?: { cause?: unknown }) {
		super(message, options);
		this.code = code;
		this.name = new.target.name;
	}
}

/** The schema definition itself is invalid (bad column type, duplicate keys…). */
export class SchemaError extends OrmError {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, "SCHEMA_ERROR", options);
	}
}

/** A query failed to build or execute against the database. */
export class QueryError extends OrmError {
	readonly sql: string;
	readonly parameters: readonly unknown[];

	constructor(
		message: string,
		context: { sql: string; parameters: readonly unknown[] },
		code = "QUERY_ERROR",
		options?: { cause?: unknown },
	) {
		super(message, code, options);
		this.sql = context.sql;
		this.parameters = context.parameters;
	}
}

/** Unique index / primary key violation. */
export class UniqueConstraintError extends QueryError {
	constructor(
		context: { sql: string; parameters: readonly unknown[] },
		options?: { cause?: unknown },
	) {
		super("Unique constraint violation", context, "UNIQUE_CONSTRAINT", options);
	}
}

/** Foreign key violation (insert/update of a missing reference, or a blocked delete). */
export class ForeignKeyConstraintError extends QueryError {
	constructor(
		context: { sql: string; parameters: readonly unknown[] },
		options?: { cause?: unknown },
	) {
		super(
			"Foreign key constraint violation",
			context,
			"FOREIGN_KEY_CONSTRAINT",
			options,
		);
	}
}

/** NOT NULL violation. */
export class NotNullConstraintError extends QueryError {
	constructor(
		context: { sql: string; parameters: readonly unknown[] },
		options?: { cause?: unknown },
	) {
		super(
			"NOT NULL constraint violation",
			context,
			"NOT_NULL_CONSTRAINT",
			options,
		);
	}
}

/** The database connection could not be established or was lost. */
export class ConnectionError extends OrmError {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, "CONNECTION_ERROR", options);
	}
}

/** `firstOrFail` / `findOrFail` found no row. */
export class ModelNotFoundError extends OrmError {
	readonly table: string;
	readonly id: unknown;

	constructor(table: string, id: unknown) {
		super(
			id === undefined
				? `No row found in "${table}"`
				: `No row found in "${table}" for primary key ${String(id)}`,
			"MODEL_NOT_FOUND",
		);
		this.table = table;
		this.id = id;
	}
}

/** A relationship was accessed on a model instance without being eager loaded. */
export class RelationNotLoadedError extends OrmError {
	readonly relation: string;

	constructor(relation: string) {
		super(
			`Relation "${relation}" is not loaded. Add it to an eager-load clause first: .with("${relation}")`,
			"RELATION_NOT_LOADED",
		);
		this.relation = relation;
	}
}

/** A model class was constructed directly instead of through the ORM. */
export class InvalidModelUsageError extends OrmError {
	constructor(message: string) {
		super(message, "INVALID_MODEL_USAGE");
	}
}

/** A transaction failed to commit or roll back. */
export class TransactionError extends OrmError {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, "TRANSACTION_ERROR", options);
	}
}

/** A query was built with invalid or contradictory input. */
export class InvalidQueryError extends OrmError {
	constructor(message: string) {
		super(message, "INVALID_QUERY");
	}
}

/** A migration failed. */
export class MigrationError extends OrmError {
	readonly migration?: string;

	constructor(
		message: string,
		options?: { migration?: string; cause?: unknown },
	) {
		super(message, "MIGRATION_ERROR", options);
		this.migration = options?.migration;
	}
}

/** An identifier (column, table, direction) failed runtime validation. */
export class InvalidIdentifierError extends OrmError {
	constructor(message: string) {
		super(message, "INVALID_IDENTIFIER");
	}
}

/** A value failed to cast (bad encrypted payload, invalid enum value, …). */
export class CastError extends OrmError {
	readonly table: string;
	readonly column: string;

	constructor(
		table: string,
		column: string,
		message: string,
		options?: { cause?: unknown },
	) {
		super(`${table}.${column}: ${message}`, "CAST_ERROR", options);
		this.table = table;
		this.column = column;
	}
}

// ---------------------------------------------------------------------------
// Driver error translation
// ---------------------------------------------------------------------------

export type DialectKind = "mysql" | "postgres" | "sqlite";

interface DriverErrorShape {
	code?: unknown;
	errno?: unknown;
	errcode?: unknown;
	sqlState?: unknown;
	message?: unknown;
}

function shapeOf(error: unknown): DriverErrorShape {
	return typeof error === "object" && error !== null
		? (error as DriverErrorShape)
		: {};
}

function sqlStateOf(error: unknown): string | undefined {
	const shape = shapeOf(error);
	if (typeof shape.sqlState === "string") return shape.sqlState;
	if (typeof shape.code === "string" && /^[0-9A-Z]{5}$/.test(shape.code)) {
		return shape.code;
	}
	return undefined;
}

function sqliteCodeOf(error: unknown): string | undefined {
	const shape = shapeOf(error);
	if (typeof shape.code === "string" && shape.code.startsWith("SQLITE_")) {
		return shape.code;
	}
	// node:sqlite exposes numeric extended result codes (e.g. 2067 = UNIQUE).
	if (typeof shape.errcode === "number") return String(shape.errcode);
	return undefined;
}

function messageOf(error: unknown): string {
	const shape = shapeOf(error);
	return typeof shape.message === "string" ? shape.message : String(error);
}

/**
 * Classifies a raw driver error into the ORM error hierarchy.
 * Returns `undefined` when the error is not recognized as a constraint
 * violation — callers fall back to wrapping it in a generic `QueryError`.
 */
export function classifyConstraintError(
	error: unknown,
	dialect: DialectKind,
):
	| UniqueConstraintError
	| ForeignKeyConstraintError
	| NotNullConstraintError
	| undefined {
	if (dialect === "mysql") {
		const errno = shapeOf(error).errno;
		if (errno === 1062)
			return new UniqueConstraintError({ sql: "", parameters: [] });
		if (errno === 1451 || errno === 1452) {
			return new ForeignKeyConstraintError({ sql: "", parameters: [] });
		}
		if (errno === 1048) {
			return new NotNullConstraintError({ sql: "", parameters: [] });
		}
		return undefined;
	}

	if (dialect === "postgres") {
		const state = sqlStateOf(error);
		if (state === "23505")
			return new UniqueConstraintError({ sql: "", parameters: [] });
		if (state === "23503")
			return new ForeignKeyConstraintError({ sql: "", parameters: [] });
		if (state === "23502")
			return new NotNullConstraintError({ sql: "", parameters: [] });
		return undefined;
	}

	// sqlite (bun:sqlite string codes / node:sqlite numeric extended codes)
	const code = sqliteCodeOf(error);
	if (
		code === "SQLITE_CONSTRAINT_UNIQUE" ||
		code === "SQLITE_CONSTRAINT_PRIMARYKEY" ||
		code === "2067" ||
		code === "1555"
	) {
		return new UniqueConstraintError({ sql: "", parameters: [] });
	}
	if (
		code === "SQLITE_CONSTRAINT_FOREIGNKEY" ||
		code === "787" ||
		code === "SQLITE_CONSTRAINT_TRIGGER"
	) {
		return new ForeignKeyConstraintError({ sql: "", parameters: [] });
	}
	if (code === "SQLITE_CONSTRAINT_NOTNULL" || code === "1299") {
		return new NotNullConstraintError({ sql: "", parameters: [] });
	}
	if (code === "SQLITE_CONSTRAINT" || code === "19") {
		// Generic constraint failure — classify by message as a last resort.
		const message = messageOf(error);
		if (/unique/i.test(message))
			return new UniqueConstraintError({ sql: "", parameters: [] });
		if (/foreign key/i.test(message)) {
			return new ForeignKeyConstraintError({ sql: "", parameters: [] });
		}
		if (/not null/i.test(message))
			return new NotNullConstraintError({ sql: "", parameters: [] });
		return undefined;
	}
	return undefined;
}

/**
 * Whether a failed transaction may be safely retried (deadlock or
 * serialization failure). Used by `orm.transaction({ retries })`.
 */
export function isRetryableTransactionError(
	error: unknown,
	dialect: DialectKind,
): boolean {
	if (dialect === "mysql") {
		const errno = shapeOf(error).errno;
		return errno === 1213 || errno === 1205;
	}
	if (dialect === "postgres") {
		const state = sqlStateOf(error);
		return state === "40P01" || state === "40001";
	}
	const code = sqliteCodeOf(error);
	return code === "SQLITE_BUSY" || code === "5" || code === "6";
}

/** Wraps an unknown driver failure into a `QueryError` preserving the DB context. */
export function toQueryError(
	error: unknown,
	dialect: DialectKind,
	context: { sql: string; parameters: readonly unknown[] },
): OrmError {
	if (error instanceof OrmError) return error;

	const constraint = classifyConstraintError(error, dialect);
	if (constraint) {
		// Re-attach the failing statement so callers can inspect the SQL while
		// still catching the precise constraint error subclass.
		if (constraint instanceof UniqueConstraintError) {
			return new UniqueConstraintError(context, { cause: error });
		}
		if (constraint instanceof ForeignKeyConstraintError) {
			return new ForeignKeyConstraintError(context, { cause: error });
		}
		return new NotNullConstraintError(context, { cause: error });
	}

	const message = messageOf(error);
	return new QueryError(`Query failed: ${message}`, context, "QUERY_ERROR", {
		cause: error,
	});
}
