// Live PostgreSQL integration tests.
//
// Skipped unless `BARQ_ORM_PG_URL` points at a real server
// (e.g. `postgres://postgres:secret@127.0.0.1:5432/barq_test`). The suite
// destroys and recreates its tables, so point it at a scratch database.

import { describe, expect, test } from "bun:test";
import { postgres } from "../../src/postgres";
import { runDialectSuite } from "./dialect-suite";

const url = process.env.BARQ_ORM_PG_URL;

if (url !== undefined && url !== "") {
	runDialectSuite("PostgreSQL integration", () => postgres({ uri: url }), {
		placeholder: (position) => `$${position}`,
	});
} else {
	describe.skip("PostgreSQL integration (set BARQ_ORM_PG_URL to run)", () => {
		test("skipped: no live PostgreSQL server configured", () => {
			expect(true).toBe(true);
		});
	});
}
