// Live MySQL integration tests.
//
// Skipped unless `BARQ_ORM_MYSQL_URL` points at a real server
// (e.g. `mysql://root:secret@127.0.0.1:3306/barq_test`). The suite destroys
// and recreates its tables, so point it at a scratch database.

import { describe, expect, test } from "bun:test";
import { mysql } from "../../src/mysql";
import { runDialectSuite } from "./dialect-suite";

const url = process.env.BARQ_ORM_MYSQL_URL;

if (url !== undefined && url !== "") {
	runDialectSuite("MySQL integration", () => mysql({ uri: url }), {
		placeholder: () => "?",
	});
} else {
	describe.skip("MySQL integration (set BARQ_ORM_MYSQL_URL to run)", () => {
		test("skipped: no live MySQL server configured", () => {
			expect(true).toBe(true);
		});
	});
}
