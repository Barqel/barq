// Rehearses the shared MySQL/PostgreSQL conformance suite against live SQLite.
//
// The server suites only run when `BARQ_ORM_MYSQL_URL` / `BARQ_ORM_PG_URL` are
// set, which means the shared body could silently rot between runs. This file
// executes the exact same `runDialectSuite` body on `bun:sqlite` so setup/DDL,
// assumptions and parity assertions are exercised on every `bun test`. It does
// not substitute for live MySQL/PostgreSQL verification — dialect-specific SQL
// is still covered by `tests/unit/compile-sql.test.ts`.

import { sqlite } from "../../src/sqlite";
import { runDialectSuite } from "./dialect-suite";

runDialectSuite(
	"SQLite rehearsal of the shared dialect suite",
	() => sqlite(":memory:"),
	{
		placeholder: () => "?",
	},
);
