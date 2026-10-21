// Internal capability used by dialects that need to change how wide integer
// values are read when the schema opts into BigInt mode.
//
// PostgreSQL and MySQL always return exact values for values that cannot be
// represented safely as a JS number; SQLite needs its `safeIntegers` mode
// enabled before the driver is created. The Orm discovers BigInt columns in
// the schema and toggles this symbol after the dialect is constructed but
// before Kysely creates the driver (which happens inside `createKysely`).

import type { Dialect } from "kysely";

/** @internal */
export const BIGINT_MODE = Symbol.for("@barq/orm/bigint-mode");

/** A dialect that can react to the schema's BigInt mode. @internal */
export interface BigIntModeDialect extends Dialect {
	[BIGINT_MODE]?: (enabled: boolean) => void;
}

/** Enables or disables BigInt reads on a dialect that supports the capability. @internal */
export function configureDialectBigInt(
	dialect: Dialect,
	enabled: boolean,
): void {
	(dialect as BigIntModeDialect)[BIGINT_MODE]?.(enabled);
}
