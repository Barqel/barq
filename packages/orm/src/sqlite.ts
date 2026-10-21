// SQLite entry point — zero additional dependencies on both runtimes:
// `bun:sqlite` under Bun, `node:sqlite` under Node 24+.

export type { SqliteOptions } from "./drivers/sqlite";
export { BarqSqliteDriver, sqlite } from "./drivers/sqlite";
