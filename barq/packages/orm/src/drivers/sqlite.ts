// SQLite driver for Bun (`bun:sqlite`) and Node.js (`node:sqlite`).
//
// Both built-in modules are loaded lazily, so importing this module never
// pulls in a runtime it does not target:
//
//   Bun  >= 1.1  -> bun:sqlite        (no extra dependency)
//   Node >= 22.5 -> node:sqlite       (no extra dependency)
//
// The driver uses a single connection per database (SQLite's own concurrency
// model) and serializes top-level transactions through an internal queue so
// two overlapping `orm.transaction()` calls cannot interleave `BEGIN`.

import type {
	DatabaseConnection,
	Dialect,
	Driver,
	QueryResult,
	TransactionSettings,
} from "kysely";
import {
	CompiledQuery,
	SqliteAdapter,
	SqliteIntrospector,
	SqliteQueryCompiler,
} from "kysely";
import type { DialectKind } from "../errors";
import { BIGINT_MODE, type BigIntModeDialect } from "./bigint-mode";

/** Minimal structural surface shared by bun:sqlite and node:sqlite. */
interface SqliteStatementLike {
	all(...params: unknown[]): unknown[];
	run(...params: unknown[]): {
		changes: number | bigint;
		lastInsertRowid: number | bigint;
	};
	iterate?(...params: unknown[]): IterableIterator<unknown>;
	/** Node's built-in SQLite exposes this per statement. */
	setReadBigInts?(enabled: boolean): void;
}

interface SqliteHandle {
	prepare(sql: string): SqliteStatementLike;
	exec(sql: string): void;
	close(): void;
}

export interface SqliteOptions {
	/** File path or `":memory:"`. */
	path: string;
	/** Reject writes at the SQLite level. */
	readonly?: boolean;
	/** `PRAGMA busy_timeout` for file databases. Defaults to 5000. */
	busyTimeoutMs?: number;
	/**
	 * Return every SQLite integer as a JavaScript `bigint` (Bun and Node).
	 * Enabled automatically when the schema opts into BigInt mode.
	 */
	safeIntegers?: boolean;
	/** Force a runtime instead of auto-detecting it. */
	runtime?: "bun" | "node";
}

/** Runtime of the current process. */
function detectRuntime(): "bun" | "node" {
	return typeof (globalThis as { Bun?: unknown }).Bun !== "undefined"
		? "bun"
		: "node";
}

/**
 * Normalizes values that SQLite cannot bind natively:
 * booleans -> 0/1, Date -> ISO-8601 string, undefined -> null.
 * @internal
 */
export function sanitizeSqliteParameters(
	parameters: readonly unknown[],
): unknown[] {
	return parameters.map((parameter) => {
		if (typeof parameter === "boolean") return parameter ? 1 : 0;
		if (parameter instanceof Date) return parameter.toISOString();
		if (parameter === undefined) return null;
		return parameter;
	});
}

/**
 * SQLite cannot tell us whether a prepared statement returns rows. The
 * compiled query node can: selects and statements with a RETURNING clause
 * are executed with `all()`, everything else with `run()` (which yields
 * `changes` and `lastInsertRowid`).
 * @internal
 */
export function statementReturnsRows(
	sql: string,
	node: { kind: string; returning?: unknown },
): boolean {
	if (node.kind === "SelectQueryNode") return true;
	if (
		"returning" in node &&
		node.returning !== undefined &&
		node.returning !== null
	) {
		return true;
	}
	if (node.kind === "RawNode") {
		return /^\s*(select|with|pragma|explain|values)/i.test(sql);
	}
	return false;
}

class BarqSqliteConnection implements DatabaseConnection {
	#handle: SqliteHandle;
	#readBigInts: boolean;

	constructor(handle: SqliteHandle, readBigInts: boolean) {
		this.#handle = handle;
		this.#readBigInts = readBigInts;
	}

	#prepare(sql: string): SqliteStatementLike {
		const statement = this.#handle.prepare(sql);
		if (this.#readBigInts) statement.setReadBigInts?.(true);
		return statement;
	}

	async executeQuery<R>(compiled: CompiledQuery): Promise<QueryResult<R>> {
		const statement = this.#prepare(compiled.sql);
		const parameters = sanitizeSqliteParameters(compiled.parameters);

		if (statementReturnsRows(compiled.sql, compiled.query)) {
			const rows = statement.all(...parameters) as R[];
			return { rows };
		}

		const result = statement.run(...parameters);
		return {
			rows: [],
			insertId:
				result.lastInsertRowid !== 0 && result.lastInsertRowid != null
					? BigInt(result.lastInsertRowid)
					: undefined,
			numAffectedRows:
				result.changes != null ? BigInt(result.changes) : undefined,
		};
	}

	async *streamQuery<R>(
		compiled: CompiledQuery,
	): AsyncIterableIterator<QueryResult<R>> {
		const statement = this.#prepare(compiled.sql);
		const parameters = sanitizeSqliteParameters(compiled.parameters);
		if (typeof statement.iterate === "function") {
			for (const row of statement.iterate(...parameters)) {
				yield { rows: [row as R] };
			}
			return;
		}
		// Older SQLite bindings expose no row iterator — fall back to one chunk.
		yield { rows: statement.all(...parameters) as R[] };
	}
}

/** Driver over one SQLite connection. Exported for tests. */
export class BarqSqliteDriver implements Driver {
	readonly kind: DialectKind = "sqlite";
	#options: SqliteOptions;
	#handle: SqliteHandle | null = null;
	#connection: BarqSqliteConnection | null = null;
	#txLocked = false;
	#txWaiters: Array<() => void> = [];

	constructor(options: SqliteOptions) {
		this.#options = options;
	}

	async init(): Promise<void> {
		const runtime = this.#options.runtime ?? detectRuntime();
		const path = this.#options.path;

		if (runtime === "bun") {
			const { Database } = await import("bun:sqlite");
			// Bun's Database constructor rejects explicit falsy open flags
			// (e.g. `{ readonly: false }`) and empty option objects, so flags
			// are only passed when they are actually requested.
			const openOptions: { readonly?: boolean; safeIntegers?: boolean } = {};
			if (this.#options.readonly) openOptions.readonly = true;
			if (this.#options.safeIntegers) openOptions.safeIntegers = true;
			const database =
				Object.keys(openOptions).length > 0
					? new Database(path, openOptions)
					: new Database(path);
			this.#handle = {
				prepare: (sql) => database.query(sql) as unknown as SqliteStatementLike,
				exec: (sql) => database.exec(sql),
				close: () => database.close(false),
			};
		} else {
			const { DatabaseSync } = await import("node:sqlite");
			const database = this.#options.readonly
				? new DatabaseSync(path, { readOnly: true })
				: new DatabaseSync(path);
			this.#handle = {
				prepare: (sql) =>
					database.prepare(sql) as unknown as SqliteStatementLike,
				exec: (sql) => database.exec(sql),
				close: () => database.close(),
			};
		}

		// Foreign keys are OFF by default in SQLite; the ORM always enables them.
		this.#handle.exec("PRAGMA foreign_keys = ON");
		if (path !== ":memory:") {
			this.#handle.exec("PRAGMA journal_mode = WAL");
			this.#handle.exec(
				`PRAGMA busy_timeout = ${this.#options.busyTimeoutMs ?? 5000}`,
			);
		}

		this.#connection = new BarqSqliteConnection(
			this.#handle,
			this.#options.safeIntegers === true,
		);
	}

	async acquireConnection(): Promise<DatabaseConnection> {
		if (!this.#connection) {
			throw new Error("SQLite driver is not initialized");
		}
		return this.#connection;
	}

	async beginTransaction(
		connection: DatabaseConnection,
		_settings: TransactionSettings,
	): Promise<void> {
		// SQLite has no isolation levels; serialization is handled by the
		// transaction queue below.
		await this.#acquireTransactionLock();
		await connection.executeQuery(CompiledQuery.raw("begin"));
	}

	async commitTransaction(connection: DatabaseConnection): Promise<void> {
		try {
			await connection.executeQuery(CompiledQuery.raw("commit"));
		} finally {
			this.#releaseTransactionLock();
		}
	}

	async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
		try {
			await connection.executeQuery(CompiledQuery.raw("rollback"));
		} finally {
			this.#releaseTransactionLock();
		}
	}

	async savepoint(
		connection: DatabaseConnection,
		savepointName: string,
	): Promise<void> {
		assertSavepointName(savepointName);
		await connection.executeQuery(
			CompiledQuery.raw(`savepoint ${savepointName}`),
		);
	}

	async rollbackToSavepoint(
		connection: DatabaseConnection,
		savepointName: string,
	): Promise<void> {
		assertSavepointName(savepointName);
		await connection.executeQuery(
			CompiledQuery.raw(`rollback to ${savepointName}`),
		);
	}

	async releaseSavepoint(
		connection: DatabaseConnection,
		savepointName: string,
	): Promise<void> {
		assertSavepointName(savepointName);
		await connection.executeQuery(
			CompiledQuery.raw(`release ${savepointName}`),
		);
	}

	async releaseConnection(): Promise<void> {
		// single-connection driver: nothing to release
	}

	async destroy(): Promise<void> {
		this.#handle?.close();
		this.#handle = null;
		this.#connection = null;
	}

	#acquireTransactionLock(): Promise<void> {
		if (!this.#txLocked) {
			this.#txLocked = true;
			return Promise.resolve();
		}
		return new Promise<void>((resolve) => {
			this.#txWaiters.push(resolve);
		});
	}

	#releaseTransactionLock(): void {
		const next = this.#txWaiters.shift();
		if (next) {
			next();
		} else {
			this.#txLocked = false;
		}
	}
}

function assertSavepointName(name: string): void {
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
		throw new Error(`Invalid savepoint name: ${JSON.stringify(name)}`);
	}
}

/**
 * Creates a SQLite dialect backed by the current runtime's built-in driver.
 *
 * ```ts
 * sqlite(":memory:")            // runtimes auto-detected
 * sqlite({ path: "app.db" })    // file with WAL + busy timeout
 * ```
 */
export function sqlite(options: SqliteOptions | string): Dialect {
	const resolved = typeof options === "string" ? { path: options } : options;
	let schemaBigInt = false;
	const dialect: BigIntModeDialect = {
		createAdapter: () => new SqliteAdapter(),
		createDriver: () =>
			new BarqSqliteDriver({
				...resolved,
				safeIntegers: resolved.safeIntegers === true || schemaBigInt,
			}),
		createIntrospector: (db) => new SqliteIntrospector(db),
		createQueryCompiler: () => new SqliteQueryCompiler(),
		[BIGINT_MODE]: (enabled) => {
			schemaBigInt = enabled;
		},
	};
	return dialect;
}
