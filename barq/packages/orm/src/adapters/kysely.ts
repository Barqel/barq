// The single internal boundary between the ORM and Kysely.
//
// Everything else in the package talks to the ORM's own public interfaces.
// The mapping `schema -> Kysely DB type` is purely type-level; at runtime the
// adapter only creates the Kysely instance, detects the engine kind and
// provides a compile-only dialect for SQL generation tests.

import type { Dialect, Generated } from "kysely";
import {
	DummyDriver,
	Kysely,
	MysqlAdapter,
	MysqlIntrospector,
	MysqlQueryCompiler,
	PostgresAdapter,
	PostgresIntrospector,
	PostgresQueryCompiler,
	SqliteAdapter,
	SqliteIntrospector,
	SqliteQueryCompiler,
} from "kysely";
import type { DialectKind } from "../errors";
import type {
	ColumnInput,
	ColumnMap,
	HasDefault,
	IsGenerated,
	RowValue,
	Schema,
} from "../schema/columns";

/**
 * One Kysely-visible column. Generated (auto-increment) and defaulted columns
 * are wrapped in Kysely's `Generated<T>` so they are optional on insert while
 * keeping their real type on select.
 */
type KyselyColumnValue<C extends ColumnInput> =
	IsGenerated<C> extends true
		? Generated<RowValue<C>>
		: HasDefault<C> extends true
			? Generated<RowValue<C>>
			: RowValue<C>;

/** Kysely-visible shape of one table: plain row values, no ORM metadata. */
export type KyselyTable<C extends ColumnMap> = {
	[K in keyof C]: KyselyColumnValue<C[K]>;
};

/** Kysely-visible database shape derived from the ORM schema. */
export type KyselyDatabase<S extends Schema> = {
	[T in keyof S]: KyselyTable<S[T]>;
};

export type OrmKysely<S extends Schema> = Kysely<KyselyDatabase<S>>;

/**
 * Creates the internal Kysely instance for a schema.
 * @internal
 */
export function createKysely<S extends Schema>(dialect: Dialect): OrmKysely<S> {
	return new Kysely<KyselyDatabase<S>>({ dialect });
}

/**
 * Detects which engine a dialect targets by probing its adapter.
 * Calling `createAdapter()` twice is safe — every dialect returns a new,
 * cheap adapter instance.
 * @internal
 */
export function detectDialectKind(dialect: Dialect): DialectKind {
	const adapter = dialect.createAdapter();
	if (adapter instanceof MysqlAdapter) return "mysql";
	if (adapter instanceof PostgresAdapter) return "postgres";
	if (adapter instanceof SqliteAdapter) return "sqlite";
	throw new Error(
		"Unsupported dialect: expected an adapter built from MysqlAdapter, PostgresAdapter or SqliteAdapter.",
	);
}

/**
 * A dialect that compiles SQL but never executes it.
 *
 * Useful for asserting the exact SQL a dialect generates without running a
 * database. Exposed publicly through `@barqel/barq-orm/testing`.
 */
export function compileOnlyDialect(kind: DialectKind): Dialect {
	if (kind === "mysql") {
		return {
			createAdapter: () => new MysqlAdapter(),
			createDriver: () => new DummyDriver(),
			createQueryCompiler: () => new MysqlQueryCompiler(),
			createIntrospector: (db) => new MysqlIntrospector(db),
		};
	}
	if (kind === "postgres") {
		return {
			createAdapter: () => new PostgresAdapter(),
			createDriver: () => new DummyDriver(),
			createQueryCompiler: () => new PostgresQueryCompiler(),
			createIntrospector: (db) => new PostgresIntrospector(db),
		};
	}
	return {
		createAdapter: () => new SqliteAdapter(),
		createDriver: () => new DummyDriver(),
		createQueryCompiler: () => new SqliteQueryCompiler(),
		createIntrospector: (db) => new SqliteIntrospector(db),
	};
}
