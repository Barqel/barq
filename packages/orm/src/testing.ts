// Test utilities — SQL generation without a database.
//
// `compileOnlyOrm` builds an ORM whose dialect compiles SQL exactly like the
// real engine but never connects. Use it to assert generated SQL per dialect:
//
// ```ts
// const orm = compileOnlyOrm(schema, "mysql");
// expect(orm.table("users").where("age", ">", 21).toSQL().sql).toBe(
//   "select * from `users` where `age` > ?",
// );
// ```

import { compileOnlyDialect } from "./adapters/kysely";
import type { DialectKind } from "./errors";
import { Orm } from "./orm";
import type { Schema } from "./schema/columns";

export { compileOnlyDialect } from "./adapters/kysely";

/** Creates an ORM that compiles (but never executes) SQL for one dialect. */
export function compileOnlyOrm<S extends Schema>(
	schema: S,
	kind: DialectKind,
): Orm<S> {
	return new Orm<S>({ schema, dialect: compileOnlyDialect(kind) });
}
