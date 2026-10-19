// The ORM kernel: one instance per schema + dialect.
//
// Responsibilities:
//   - own the Kysely instance (the only runtime dependency),
//   - funnel every statement through `execute()` (error translation + query
//     events),
//   - resolve the *current executor* (root or ambient transaction) through
//     AsyncLocalStorage so queries started inside `orm.transaction()` always
//     run on the transaction-bound connection,
//   - expose the lightweight row path (`orm.table`), the model factory
//     (`orm.model`), raw execution, DDL and migrations.

import { AsyncLocalStorage } from "node:async_hooks";
import type { Dialect, QueryResult } from "kysely";
import { CompiledQuery } from "kysely";
import {
	createKysely,
	detectDialectKind,
	type OrmKysely,
} from "./adapters/kysely";
import { configureDialectBigInt } from "./drivers/bigint-mode";
import {
	type DialectKind,
	InvalidQueryError,
	isRetryableTransactionError,
	SchemaError,
	toQueryError,
} from "./errors";
import type { ModelClass } from "./model/model";
import { createModelBase, hydrateInstance } from "./model/model";
import { QueryBuilder } from "./query/builder";
import { buildRowPlan, type RowPlan } from "./query/hydrate";
import { type AnyRelations } from "./relations/descriptors";
import { type EagerPath, eagerLoad } from "./relations/eager";
import { createPivotBase, type PivotBase } from "./relations/pivot";
import { SchemaBuilder } from "./schema/builder";
import {
	type ColumnMap,
	normalizeColumn,
	type Schema,
	schemaUsesBigInt,
} from "./schema/columns";
import type { TableName } from "./schema/define";

/** Metadata the ORM caches per table. */
export interface TableMeta {
	readonly table: string;
	readonly columns: ColumnMap;
	readonly plan: RowPlan;
	readonly generated: ReadonlySet<string>;
	readonly defaults: ReadonlySet<string>;
	readonly primaryKey: string | null;
}

/** A statement the ORM executed. */
export interface QueryEvent {
	readonly sql: string;
	readonly parameters: readonly unknown[];
	readonly durationMs: number;
}

export type QueryListener = (event: QueryEvent) => void;

export type IsolationLevel =
	| "read uncommitted"
	| "read committed"
	| "repeatable read"
	| "serializable";

export interface TransactionOptions {
	/** Isolation level for this transaction (ignored by SQLite). */
	isolation?: IsolationLevel;
	/** Bounded retries for deadlocks / serialization failures. Default 0. */
	retries?: number;
}

/**
 * The transaction-scoped API handed to `orm.transaction()` callbacks.
 * Model statics called inside the callback automatically use the same
 * transaction (AsyncLocalStorage), so this scope object stays small.
 */
export interface TransactionScope<S extends Schema> {
	table<T extends TableName<S>>(
		name: T,
	): QueryBuilder<S, T, undefined, unknown, null, never>;
	raw(
		sql: string,
		parameters?: readonly unknown[],
	): Promise<QueryResult<Record<string, unknown>>>;
}

export interface OrmConfig<S extends Schema> {
	schema: S;
	dialect: Dialect;
	/** Receive every executed statement (debugging, tests, logging). */
	onQuery?: QueryListener;
	/**
	 * Secret used by the `encrypted` cast (AES-256-GCM). Any string length is
	 * accepted; the 32-byte key is derived with SHA-256. Keep it out of source
	 * control and stable across deploys, or previously encrypted values become
	 * unreadable.
	 */
	encryptionKey?: string;
	/**
	 * Extra named connections (third argument of `orm.connection(name)`).
	 * Each entry is a full dialect — same schema, separate driver.
	 */
	connections?: Readonly<Record<string, Dialect>>;
	/** @internal Shared registries between an ORM and its connections. */
	__shared?: OrmShared;
}

/** State shared between an ORM instance and its named connections. @internal */
export interface OrmShared {
	readonly listeners: Set<QueryListener>;
	readonly morphAliasToModel: Map<string, MorphMapModel>;
	readonly morphModelToAlias: Map<MorphMapModel, string>;
	readonly macros: Map<string, (builder: never, ...args: never[]) => unknown>;
}

interface TransactionStore<S extends Schema> {
	trx: OrmKysely<S>;
	savepoints: { count: number };
}

/** Minimal model-class shape accepted by `orm.morphMap()`. */
export interface MorphMapModel {
	readonly __table: string;
}

export class Orm<S extends Schema> {
	readonly schema: S;
	readonly dialectKind: DialectKind;
	/** Whether at least one schema column exposes values as JavaScript `bigint`. */
	readonly bigIntMode: boolean;
	/** Key for the `encrypted` cast (see `OrmConfig.encryptionKey`). */
	readonly encryptionKey: string | undefined;

	readonly #db: OrmKysely<S>;
	readonly #als = new AsyncLocalStorage<TransactionStore<S>>();
	/** Statement capture used by `Migrator.pretend()`. */
	readonly #capture = new AsyncLocalStorage<string[]>();
	readonly #shared: OrmShared;
	readonly #meta = new Map<string, TableMeta>();
	readonly #connectionDialects: Readonly<Record<string, Dialect>>;
	readonly #connections = new Map<string, Orm<S>>();

	constructor(config: OrmConfig<S>) {
		if (!config || typeof config !== "object" || !config.schema) {
			throw new SchemaError(
				"Orm requires a schema — pass `defineSchema({...})`.",
			);
		}
		this.schema = config.schema;
		this.bigIntMode = schemaUsesBigInt(config.schema);
		// Must happen before createKysely(): that call creates the driver.
		configureDialectBigInt(config.dialect, this.bigIntMode);
		this.#db = createKysely<S>(config.dialect);
		this.dialectKind = detectDialectKind(config.dialect);
		this.encryptionKey = config.encryptionKey;
		this.#shared = config.__shared ?? {
			listeners: new Set(),
			morphAliasToModel: new Map(),
			morphModelToAlias: new Map(),
			macros: new Map(),
		};
		this.#connectionDialects = config.connections ?? {};
		if (config.onQuery) this.#shared.listeners.add(config.onQuery);
	}

	// -----------------------------------------------------------------------
	// surface
	// -----------------------------------------------------------------------

	/** Registers a query listener — returns an unsubscribe function. */
	onQuery(listener: QueryListener): () => void {
		this.#shared.listeners.add(listener);
		return () => {
			this.#shared.listeners.delete(listener);
		};
	}

	/**
	 * A named connection: same schema, different dialect/database. The
	 * instance is cached, shares query listeners, morph map and macros with
	 * this ORM, and supports the full surface (`table`, `model`, transactions,
	 * schema builder, migrator).
	 *
	 * ```ts
	 * const orm = new Orm({
	 *   schema,
	 *   dialect: sqlite("main.db"),
	 *   connections: { audit: sqlite("audit.db") },
	 * });
	 * await orm.connection("audit").table("events").insert(values).run();
	 * ```
	 */
	connection(name: string): Orm<S> {
		if (name === "default") return this;
		const dialect = this.#connectionDialects[name];
		if (dialect === undefined) {
			const known = ["default", ...Object.keys(this.#connectionDialects)];
			throw new SchemaError(
				`Unknown connection ${JSON.stringify(name)}. Configured connections: ${known.join(", ")}.`,
			);
		}
		let child = this.#connections.get(name);
		if (child === undefined) {
			child = new Orm<S>({
				schema: this.schema,
				dialect,
				encryptionKey: this.encryptionKey,
				__shared: this.#shared,
			});
			this.#connections.set(name, child);
		}
		return child;
	}

	/** Names of every configured connection (`"default"` first). */
	connectionNames(): string[] {
		return ["default", ...Object.keys(this.#connectionDialects)];
	}

	/**
	 * Registers a macro on the query builder (Eloquent's `Builder::macro`).
	 * The implementation runs with `this` bound to the builder and receives
	 * the builder as its first argument.
	 *
	 * ```ts
	 * orm.macro("whereActive", (query) => query.where("active", "=", true));
	 * const rows = await orm.table("users").whereActive().get();
	 * ```
	 */
	macro(
		name: string,
		implementation: (builder: never, ...args: never[]) => unknown,
	): this {
		if (typeof name !== "string" || name.length === 0) {
			throw new SchemaError("macro(): the name must be a non-empty string.");
		}
		if (typeof implementation !== "function") {
			throw new SchemaError(
				`macro(${JSON.stringify(name)}): the implementation must be a function.`,
			);
		}
		this.#shared.macros.set(name, implementation);
		return this;
	}

	/** Registered macro names. */
	macroNames(): string[] {
		return [...this.#shared.macros.keys()];
	}

	/** Implementation of a registered macro. @internal */
	macroImplementation(
		name: string,
	): ((builder: never, ...args: never[]) => unknown) | undefined {
		return this.#shared.macros.get(name);
	}

	/**
	 * Registers a global morph map (Eloquent's `Relation::morphMap`): aliases
	 * stored in polymorphic type columns instead of class/table names.
	 *
	 * ```ts
	 * orm.morphMap({ posts: Post, videos: Video });
	 * ```
	 *
	 * Calls merge (a class registered twice keeps its latest alias). A model
	 * class may still pin its own `static morphAlias`, which wins over the map.
	 */
	morphMap(map: Readonly<Record<string, MorphMapModel>>): this {
		for (const [alias, modelClass] of Object.entries(map)) {
			if (alias.length === 0) {
				throw new SchemaError("morphMap(): aliases must be non-empty strings.");
			}
			if (typeof modelClass?.__table !== "string") {
				throw new SchemaError(
					`morphMap(${JSON.stringify(alias)}): expected a model class with a __table.`,
				);
			}
			const previousAlias = this.#shared.morphModelToAlias.get(modelClass);
			if (previousAlias !== undefined)
				this.#shared.morphAliasToModel.delete(previousAlias);
			this.#shared.morphAliasToModel.set(alias, modelClass);
			this.#shared.morphModelToAlias.set(modelClass, alias);
		}
		return this;
	}

	/**
	 * Alias a model class uses in polymorphic columns:
	 * `static morphAlias` → global morph map → table name.
	 */
	morphAlias(modelClass: unknown): string {
		const cls = modelClass as { morphAlias?: unknown; __table?: unknown };
		if (typeof cls.morphAlias === "string") return cls.morphAlias;
		const registered = this.#shared.morphModelToAlias.get(
			modelClass as MorphMapModel,
		);
		if (registered !== undefined) return registered;
		return typeof cls.__table === "string" ? cls.__table : "";
	}

	/** Model class registered for a morph alias through `morphMap()`. */
	morphClass(alias: string): MorphMapModel | undefined {
		return this.#shared.morphAliasToModel.get(alias);
	}

	/** Every `morphMap()` entry, in registration order. */
	morphMapEntries(): ReadonlyArray<readonly [string, MorphMapModel]> {
		return [...this.#shared.morphAliasToModel.entries()];
	}

	/** Lightweight row path: typed records, no model instantiation. */
	table<T extends TableName<S>>(
		name: T,
	): QueryBuilder<S, T, undefined, unknown, null, never> {
		return new QueryBuilder<S, T, undefined, unknown, null, never>(this, name);
	}

	/** Creates a model base class bound to this ORM and table. */
	model<T extends TableName<S>>(table: T): ModelClass<S, T> {
		return createModelBase<S, T>(this, table);
	}

	/**
	 * Creates a base class for a custom pivot model (Eloquent's `Pivot` +
	 * `->using()`).
	 *
	 * ```ts
	 * class Membership extends orm.pivot("role_user") {
	 *   static casts = { note: "string" } as const;
	 * }
	 * const roles = belongsToMany(Role, { ..., using: Membership });
	 * ```
	 */
	pivot(table: string): PivotBase {
		return createPivotBase(table);
	}

	/** DDL access (create/alter/drop) for migrations. */
	schemaBuilder(): SchemaBuilder<S> {
		return new SchemaBuilder<S>(this);
	}

	/** Whether the current async context runs inside a transaction. */
	inTransaction(): boolean {
		return this.#als.getStore() !== undefined;
	}

	// -----------------------------------------------------------------------
	// execution
	// -----------------------------------------------------------------------

	/** The executor for the current async context (transaction-aware). @internal */
	executor(): OrmKysely<S> {
		return this.#als.getStore()?.trx ?? this.#db;
	}

	/**
	 * Executes one compiled statement through the current executor.
	 * All ORM statements go through here.
	 */
	async execute(
		compiled: CompiledQuery,
	): Promise<QueryResult<Record<string, unknown>>> {
		const capture = this.#capture.getStore();
		if (capture !== undefined) {
			capture.push(compiled.sql);
			return { rows: [] } as unknown as QueryResult<Record<string, unknown>>;
		}
		const startedAt = performance.now();
		try {
			return await this.executor().executeQuery<Record<string, unknown>>(
				compiled,
			);
		} catch (error) {
			throw toQueryError(error, this.dialectKind, {
				sql: compiled.sql,
				parameters: compiled.parameters,
			});
		} finally {
			if (this.#shared.listeners.size > 0) {
				const event: QueryEvent = {
					sql: compiled.sql,
					parameters: compiled.parameters,
					durationMs: performance.now() - startedAt,
				};
				for (const listener of this.#shared.listeners) {
					try {
						listener(event);
					} catch {
						// Listener failures must never break queries.
					}
				}
			}
		}
	}

	/**
	 * Runs `callback` with statement execution disabled: every statement is
	 * recorded (SQL text with placeholders) and skipped. Used by
	 * `Migrator.pretend()`. @internal
	 */
	async captureStatements<T>(
		callback: () => Promise<T> | T,
	): Promise<{ result: T; statements: string[] }> {
		const statements: string[] = [];
		const result = await this.#capture.run(statements, async () => callback());
		return { result, statements };
	}

	/** Executes a raw parameterized statement. */
	raw(
		sql: string,
		parameters: readonly unknown[] = [],
	): Promise<QueryResult<Record<string, unknown>>> {
		return this.execute(CompiledQuery.raw(sql, [...parameters]));
	}

	// -----------------------------------------------------------------------
	// transactions
	// -----------------------------------------------------------------------

	/**
	 * Runs `callback` inside a transaction.
	 *
	 * Nested calls create SAVEPOINTs instead of new transactions, so calling
	 * `orm.transaction()` inside another one is safe and composes.
	 */
	async transaction<T>(
		callback: (tx: TransactionScope<S>) => Promise<T> | T,
		options: TransactionOptions = {},
	): Promise<T> {
		const store = this.#als.getStore();
		if (store) {
			return this.#runNestedTransaction(store, callback);
		}
		const retries = Math.max(0, Math.trunc(options.retries ?? 0));
		for (let attempt = 0; ; attempt += 1) {
			try {
				return await this.#runTopLevelTransaction(callback, options);
			} catch (error) {
				if (
					attempt < retries &&
					isRetryableTransactionError(error, this.dialectKind)
				) {
					continue;
				}
				throw error;
			}
		}
	}

	async #runTopLevelTransaction<T>(
		callback: (tx: TransactionScope<S>) => Promise<T> | T,
		options: TransactionOptions,
	): Promise<T> {
		let builder = this.#db.transaction();
		if (options.isolation !== undefined) {
			builder = builder.setIsolationLevel(options.isolation);
		}
		return builder.execute((trx) =>
			this.#als.run(
				{ trx: trx as OrmKysely<S>, savepoints: { count: 0 } },
				async () => callback(this.#scope()),
			),
		);
	}

	async #runNestedTransaction<T>(
		store: TransactionStore<S>,
		callback: (tx: TransactionScope<S>) => Promise<T> | T,
	): Promise<T> {
		const name = `barq_sp_${store.savepoints.count}`;
		store.savepoints.count += 1;
		await this.#executeOn(store.trx, `savepoint ${name}`);
		try {
			const result = await callback(this.#scope());
			await this.#executeOn(store.trx, `release savepoint ${name}`);
			return result;
		} catch (error) {
			try {
				await this.#executeOn(store.trx, `rollback to savepoint ${name}`);
			} catch {
				// The original failure is the one worth surfacing.
			}
			throw error;
		}
	}

	#executeOn(
		db: OrmKysely<S>,
		sqlText: string,
	): Promise<QueryResult<Record<string, unknown>>> {
		const startedAt = performance.now();
		return (async () => {
			try {
				return await db.executeQuery<Record<string, unknown>>(
					CompiledQuery.raw(sqlText),
				);
			} catch (error) {
				throw toQueryError(error, this.dialectKind, {
					sql: sqlText,
					parameters: [],
				});
			} finally {
				if (this.#shared.listeners.size > 0) {
					const event: QueryEvent = {
						sql: sqlText,
						parameters: [],
						durationMs: performance.now() - startedAt,
					};
					for (const listener of this.#shared.listeners) {
						try {
							listener(event);
						} catch {
							// ignore
						}
					}
				}
			}
		})();
	}

	#scope(): TransactionScope<S> {
		return {
			table: <T extends TableName<S>>(name: T) => this.table(name),
			raw: (sql: string, parameters: readonly unknown[] = []) =>
				this.raw(sql, parameters),
		};
	}

	// -----------------------------------------------------------------------
	// internals shared with the builder / model / eager loader
	// -----------------------------------------------------------------------

	/** Cached per-table metadata (columns, conversion plan, keys). @internal */
	internalMeta<T extends TableName<S>>(table: T): TableMeta {
		const cached = this.#meta.get(table);
		if (cached) return cached;
		const columns = this.schema[table] as ColumnMap | undefined;
		if (!columns) {
			throw new InvalidQueryError(
				`Unknown table "${String(table)}". Known tables: ${Object.keys(this.schema).join(", ")}.`,
			);
		}
		const plan = buildRowPlan(table, columns);
		const generated = new Set<string>();
		const defaults = new Set<string>();
		let primaryKey: string | null = null;
		for (const [name, input] of Object.entries(columns)) {
			const definition = normalizeColumn(table, name, input);
			if (definition.autoIncrement === true || definition.generated === true) {
				generated.add(name);
			}
			if (definition.default !== undefined || definition.defaultNow === true) {
				defaults.add(name);
			}
			if (definition.primaryKey === true) primaryKey = name;
		}
		const meta: TableMeta = {
			table,
			columns,
			plan,
			generated,
			defaults,
			primaryKey,
		};
		this.#meta.set(table, meta);
		return meta;
	}

	/** Hydrates one raw row into a model instance. @internal */
	hydrateModelRow(
		modelClass: unknown,
		row: Record<string, unknown>,
		persisted: boolean,
	): unknown {
		return hydrateInstance(modelClass as never, row, persisted);
	}

	/** Eager-loads relations on already hydrated models. @internal */
	async eagerLoadModels(
		parents: unknown[],
		paths: readonly EagerPath[],
	): Promise<void> {
		await eagerLoad(this as unknown as Orm<Schema>, parents as object[], paths);
	}

	/** Relation map of a model class, for the eager loader. @internal */
	relationsOf(modelClass: unknown): AnyRelations | undefined {
		return (modelClass as { relations?: AnyRelations }).relations;
	}

	/** Closes the connection pool. */
	async destroy(): Promise<void> {
		await this.#db.destroy();
	}
}
