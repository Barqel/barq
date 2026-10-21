// Schema/Blueprint parity — Eloquent-style DDL for SQLite, MySQL and PostgreSQL.
//
// The live suites use an in-memory SQLite database and verify the full
// create → introspect → read-back cycle. The compile-only suites use
// `compileOnlyOrm` to assert the DDL each engine receives without a database,
// including the MySQL/PostgreSQL-only attributes that SQLite cannot express.

import { describe, expect, test } from "bun:test";
import type { DialectKind, QueryEvent, Schema } from "../../src/index";
import {
	defineSchema,
	InvalidIdentifierError,
	Orm,
	SchemaError,
} from "../../src/index";
import { sqlite } from "../../src/sqlite";
import { compileOnlyOrm } from "../../src/testing";

function normalize(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

/** Compiles `run`, returning every statement the ORM emitted (normalized). */
async function captureMany<S extends Schema>(
	orm: Orm<S>,
	run: () => Promise<unknown>,
): Promise<string[]> {
	const statements: string[] = [];
	const off = orm.onQuery((event: QueryEvent) =>
		statements.push(normalize(event.sql)),
	);
	try {
		await run();
	} finally {
		off();
	}
	return statements;
}

/** A fresh in-memory SQLite database; the schema builder needs no schema. */
function liveOrm() {
	return new Orm({ schema: {}, dialect: sqlite(":memory:") });
}

// ---------------------------------------------------------------------------
// Live SQLite — every portable capability must actually run.
// ---------------------------------------------------------------------------

describe("SQLite schema parity (live)", () => {
	test("new column types create, introspect and read back", async () => {
		const orm = liveOrm();
		const builder = orm.schemaBuilder();
		await builder.create("all_types", (t) => {
			t.id();
			t.string("name", 40);
			t.char("code", 8);
			t.tinyText("tinyBody");
			t.mediumText("mediumBody");
			t.longText("longBody");
			t.tinyInteger("tiny");
			t.smallInteger("small");
			t.mediumInteger("medium");
			t.bigint("big");
			t.year("yr");
			t.unsignedInteger("unsignedInt");
			t.float("ratio");
			t.double("score");
			t.decimal("amount", 12, 4);
			t.boolean("active");
			t.date("onDate");
			t.time("atTime");
			t.timeTz("atTimeTz");
			t.datetime("createdAt");
			t.dateTimeTz("createdAtTz");
			t.timestampTz("seenAt");
			t.json("payload");
			t.jsonb("payloadB");
			t.uuid("token");
			t.ulid("ulid");
			t.inet("address");
			t.binary("bytes");
		});

		expect(await builder.hasTable("all_types")).toBe(true);
		expect(await builder.hasColumn("all_types", "amount")).toBe(true);
		expect(await builder.hasColumn("all_types", "missing")).toBe(false);
		expect(await builder.hasColumn("missing_table", "id")).toBe(false);

		// SQLite's type affinity is reported as written by the DDL, though the
		// introspection layer normalizes some names to upper case.
		expect(
			(await builder.getColumnType("all_types", "name"))?.toLowerCase(),
		).toBe("text");
		expect(
			(await builder.getColumnType("all_types", "amount"))?.toLowerCase(),
		).toBe("decimal(12, 4)");
		expect(await builder.getColumnType("all_types", "flag")).toBeNull();

		const values: Record<string, unknown> = {
			name: "widget",
			code: "abc",
			tinyBody: "t",
			mediumBody: "m",
			longBody: "l",
			tiny: 1,
			small: 2,
			medium: 3,
			big: 4,
			yr: 2026,
			unsignedInt: 5,
			ratio: 1.5,
			score: 2.5,
			amount: "12.3400",
			active: 1,
			onDate: "2026-10-19",
			atTime: "12:00:00",
			atTimeTz: "12:00:00",
			createdAt: "2026-10-19 12:00:00",
			createdAtTz: "2026-10-19 12:00:00",
			seenAt: "2026-10-19 12:00:00",
			payload: '{"a":1}',
			payloadB: '{"b":2}',
			token: "00000000-0000-0000-0000-000000000000",
			ulid: "01J00000000000000000000000",
			address: "127.0.0.1",
			bytes: new Uint8Array([1, 2, 3]),
		};
		const columns = Object.keys(values);
		await orm.raw(
			`insert into all_types (${columns.join(", ")}) values (${columns
				.map(() => "?")
				.join(", ")})`,
			columns.map((column) => values[column]),
		);

		const row = (await orm.raw("select * from all_types")).rows[0]!;
		expect(row.name).toBe("widget");
		expect(row.code).toBe("abc");
		expect(Number(row.amount)).toBe(12.34);
		expect(row.active).toBe(1);
		expect(row.ulid).toBe("01J00000000000000000000000");
		expect(row.address).toBe("127.0.0.1");
		expect(Array.from(row.bytes as Uint8Array)).toEqual([1, 2, 3]);
	});

	test("enum stores allowed values and rejects anything else", async () => {
		const orm = liveOrm();
		const builder = orm.schemaBuilder();
		await builder.create("jobs", (t) => {
			t.id();
			t.enum("status", ["draft", "published"]).default("draft");
		});

		await orm.raw("insert into jobs (status) values ('published')");
		await orm.raw("insert into jobs default values");
		const rows = (await orm.raw("select status from jobs order by id")).rows;
		expect(rows.map((row) => row.status)).toEqual(["published", "draft"]);

		await expect(
			orm.raw("insert into jobs (status) values ('bogus')"),
		).rejects.toThrow();

		expect(await builder.getColumnType("jobs", "status")).toBe("varchar(255)");
		const ddl = String(
			(await orm.raw("select sql from sqlite_master where name = 'jobs'"))
				.rows[0]!.sql,
		);
		expect(normalize(ddl)).toContain(
			"check (\"status\" in ('draft', 'published'))",
		);
	});

	test("timestamps, soft deletes, remember token and morphs", async () => {
		const orm = liveOrm();
		const builder = orm.schemaBuilder();
		await builder.create("posts", (t) => {
			t.id();
			t.string("title");
			t.timestamps();
			t.softDeletes();
			t.rememberToken();
			t.morphs("taggable");
		});

		const columns = (await orm.raw("pragma table_info('posts')")).rows.map(
			(row) => String(row.name),
		);
		expect(columns).toEqual([
			"id",
			"title",
			"createdAt",
			"updatedAt",
			"deletedAt",
			"rememberToken",
			"taggableId",
			"taggableType",
		]);
		const indexes = (await orm.raw("pragma index_list('posts')")).rows.map(
			(row) => String(row.name),
		);
		expect(indexes).toContain("posts_taggableId_taggableType_index");

		await orm.raw(
			"insert into posts (title, taggableId, taggableType) values ('hello', 3, 'article')",
		);
		const row = (await orm.raw("select * from posts")).rows[0]!;
		expect(row.title).toBe("hello");
		expect(row.taggableId).toBe(3);
		expect(row.taggableType).toBe("article");
		expect(row.createdAt).toBeNull();

		await builder.create("media", (t) => {
			t.id();
			t.nullableMorphs("attachable");
		});
		await orm.raw("insert into media (id) values (1)");
		const media = (await orm.raw("select * from media")).rows[0]!;
		expect(media.attachableId).toBeNull();
		expect(media.attachableType).toBeNull();
	});

	test("time-zone timestamps and uuid morphs", async () => {
		const orm = liveOrm();
		const builder = orm.schemaBuilder();
		await builder.create("events", (t) => {
			t.id();
			t.nullableTimestamps("createdOn", "updatedOn");
			t.timestampsTz("publishedAt", "checkedAt");
			t.softDeletesTz("removedAt");
			t.uuidMorphs("subject");
			t.nullableUuidMorphs("owner");
		});

		const columns = (await orm.raw("pragma table_info('events')")).rows.map(
			(row) => String(row.name),
		);
		expect(columns).toEqual([
			"id",
			"createdOn",
			"updatedOn",
			"publishedAt",
			"checkedAt",
			"removedAt",
			"subjectId",
			"subjectType",
			"ownerId",
			"ownerType",
		]);
		expect(
			(await builder.getColumnType("events", "subjectId"))?.toLowerCase(),
		).toBe("char(36)");

		await orm.raw(
			"insert into events (subjectId, subjectType) values ('uuid-1', 'post')",
		);
		const row = (await orm.raw("select * from events")).rows[0]!;
		expect(row.subjectType).toBe("post");
		expect(row.ownerId).toBeNull();
		expect(row.publishedAt).toBeNull();

		await builder.alter("events", (t) => t.dropSoftDeletesTz("removedAt"));
		expect(await builder.hasColumn("events", "removedAt")).toBe(false);
	});

	test("stored and virtual generated columns read back computed values", async () => {
		const orm = liveOrm();
		const builder = orm.schemaBuilder();
		await builder.create("line_items", (t) => {
			t.id();
			t.integer("quantity");
			t.integer("unitPrice");
			t.integer("storedTotal").storedAs("quantity * unitPrice");
			t.integer("virtualTotal").virtualAs("quantity * unitPrice + 1");
		});

		await orm.raw("insert into line_items (quantity, unitPrice) values (3, 4)");
		const row = (await orm.raw("select * from line_items")).rows[0]!;
		expect(row.storedTotal).toBe(12);
		expect(row.virtualTotal).toBe(13);
		await expect(
			orm.raw(
				"insert into line_items (quantity, unitPrice, storedTotal) values (1, 1, 9)",
			),
		).rejects.toThrow();
	});

	test("change() rewrites the column and preserves rows", async () => {
		const orm = liveOrm();
		const builder = orm.schemaBuilder();
		await builder.create("products", (t) => {
			t.id();
			t.string("name");
			t.decimal("price");
			t.enum("status", ["draft", "published"]);
			t.integer("stock");
		});
		await orm.raw(
			"insert into products (name, price, status, stock) values ('a', 1.5, 'draft', 4), ('b', 2.5, 'published', 7)",
		);

		await builder.alter("products", (t) => {
			t.enum("status", ["draft", "published", "archived"]).change();
			t.integer("stock").nullable().change();
		});

		const rows = (await orm.raw("select * from products order by id")).rows;
		expect(rows).toHaveLength(2);
		expect(rows[0]!.name).toBe("a");
		expect(rows[1]!.stock).toBe(7);

		await orm.raw(
			"insert into products (name, price, status, stock) values ('c', 3.5, 'archived', null)",
		);
		await expect(
			orm.raw(
				"insert into products (name, price, status) values ('d', 4.5, 'bogus')",
			),
		).rejects.toThrow();

		const info = (await orm.raw("pragma table_info('products')")).rows;
		expect(info.find((row) => row.name === "stock")?.notnull).toBe(0);
		// The rewritten enum column keeps its original declared type.
		expect(
			(await builder.getColumnType("products", "status"))?.toLowerCase(),
		).toBe("varchar(255)");
		// MySQL-only placement modifiers are ignored by SQLite.
		await builder.alter("products", (t) => {
			t.string("nickname").default("n/a").after("name").first();
		});
		expect(await builder.hasColumn("products", "nickname")).toBe(true);
	});

	test("dropPrimary() rebuilds the table and allows duplicate explicit ids", async () => {
		const orm = liveOrm();
		const builder = orm.schemaBuilder();
		await builder.create("tags", (t) => {
			t.id();
			t.string("name");
		});
		await orm.raw("insert into tags (name) values ('a'), ('b')");

		await builder.alter("tags", (t) => t.dropPrimary());

		const info = (await orm.raw("pragma table_info('tags')")).rows;
		expect(info.every((row) => Number(row.pk) === 0)).toBe(true);
		expect((await orm.raw("select * from tags")).rows).toHaveLength(2);

		await orm.raw("insert into tags (id, name) values (1, 'duplicate')");
		const rows = (await orm.raw("select * from tags order by name")).rows;
		expect(rows.map((row) => row.name)).toEqual(["a", "b", "duplicate"]);
	});

	test("table-level foreign keys enforce actions and cascade", async () => {
		const orm = liveOrm();
		const builder = orm.schemaBuilder();
		await builder.create("parents", (t) => {
			t.id();
			t.string("name");
		});
		await builder.create("children", (t) => {
			t.id();
			t.string("label");
			t.foreignId("parentId").constrained("parents").onDelete("cascade");
			t.bigint("otherId");
			t.foreign("otherId").references("parents.id").onUpdate("cascade");
		});

		const foreignKeys = (await orm.raw("pragma foreign_key_list('children')"))
			.rows;
		expect(foreignKeys).toHaveLength(2);
		expect(foreignKeys.find((row) => row.from === "parentId")?.on_delete).toBe(
			"CASCADE",
		);
		expect(foreignKeys.find((row) => row.from === "otherId")?.on_update).toBe(
			"CASCADE",
		);

		await orm.raw("insert into parents (name) values ('p')");
		await orm.raw(
			"insert into children (label, parentId, otherId) values ('c', 1, 1)",
		);
		await expect(
			orm.raw(
				"insert into children (label, parentId, otherId) values ('x', 99, 1)",
			),
		).rejects.toThrow();
		await orm.raw("delete from parents where id = 1");
		expect((await orm.raw("select * from children")).rows).toHaveLength(0);
	});

	test("introspection, createIfNotExists, rename, drop and dropIfExists", async () => {
		const orm = liveOrm();
		const builder = orm.schemaBuilder();
		await builder.createIfNotExists("things", (t) => {
			t.id();
			t.string("name");
		});
		await builder.createIfNotExists("things", (t) => {
			t.id();
			t.string("name");
		});
		expect(await builder.hasTable("things")).toBe(true);

		await builder.rename("things", "renamedThings");
		expect(await builder.hasTable("things")).toBe(false);
		expect(await builder.hasTable("renamedThings")).toBe(true);

		await builder.drop("renamedThings");
		expect(await builder.hasTable("renamedThings")).toBe(false);
		// Dropping twice is only safe through dropIfExists().
		await builder.dropIfExists("renamedThings");
		await expect(builder.drop("renamedThings")).rejects.toThrow();
	});

	test("dialect-incompatible features fail before emitting SQL", async () => {
		const orm = liveOrm();
		const builder = orm.schemaBuilder();
		await expect(
			builder.create("bad_set", (t) => {
				t.id();
				t.set("flags", ["a", "b"]);
			}),
		).rejects.toThrow(SchemaError);
		await expect(
			builder.create("bad_fulltext", (t) => {
				t.id();
				t.string("body");
				t.fullText("body");
			}),
		).rejects.toThrow(SchemaError);
		await expect(
			builder.create("bad_spatial", (t) => {
				t.id();
				t.string("geo");
				t.spatialIndex("geo");
			}),
		).rejects.toThrow(SchemaError);
		await expect(
			builder.create("bad_change", (t) => {
				t.id();
				t.string("name").change();
			}),
		).rejects.toThrow(SchemaError);
		await expect(
			builder.create("bad_pk", (t) => {
				t.id().nullable();
			}),
		).rejects.toThrow(SchemaError);
		await expect(
			builder.create("bad_start", (t) => {
				t.integer("position").startingValue(5);
			}),
		).rejects.toThrow(SchemaError);
		await expect(
			builder.create("bad-identifier", (t) => {
				t.id();
			}),
		).rejects.toThrow(InvalidIdentifierError);
	});

	test("drop helpers remove the columns and indexes they created", async () => {
		const orm = liveOrm();
		const builder = orm.schemaBuilder();
		await builder.create("sessions", (t) => {
			t.id();
			t.timestamps();
			t.softDeletes();
			t.rememberToken();
			t.morphs("subject");
		});
		await builder.alter("sessions", (t) => {
			t.dropMorphs("subject");
			t.dropTimestamps();
			t.dropSoftDeletes();
			t.dropRememberToken();
		});

		expect(await builder.hasColumn("sessions", "subjectId")).toBe(false);
		expect(await builder.hasColumn("sessions", "subjectType")).toBe(false);
		expect(await builder.hasColumn("sessions", "createdAt")).toBe(false);
		expect(await builder.hasColumn("sessions", "deletedAt")).toBe(false);
		expect(await builder.hasColumn("sessions", "rememberToken")).toBe(false);
		const indexes = (await orm.raw("pragma index_list('sessions')")).rows;
		expect(indexes).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Compile-only — every abstract type maps to valid DDL on all three engines.
// ---------------------------------------------------------------------------

const typeExpectations: Record<DialectKind, string[]> = {
	mysql: [
		"`tiny` tinytext",
		"`medium` mediumtext",
		"`long` longtext",
		"`code` char(8)",
		"`ti` tinyint",
		"`si` smallint",
		"`mi` mediumint",
		"`bi` bigint",
		"`ub` bigint unsigned",
		"`yr` year",
		"`f` float",
		"`d` double",
		"`dec` decimal(8, 2)",
		"`flag` tinyint(1)",
		"`day` date",
		"`at` time",
		"`attz` time",
		"`dt` datetime(3)",
		"`dttz` datetime(3)",
		"`tstz` timestamp",
		"`payload` json",
		"`payloadB` json",
		"`token` char(36)",
		"`ulid` char(26)",
		"`addr` varchar(45)",
		"`bin` blob",
		"`ip` varchar(45)",
		"`mac` varchar(17)",
		"`status` enum('a', 'b')",
	],
	postgres: [
		'"tiny" text',
		'"medium" text',
		'"long" text',
		'"code" char(8)',
		'"ti" smallint',
		'"si" smallint',
		'"mi" integer',
		'"bi" bigint',
		'"ub" bigint',
		'"yr" integer',
		'"f" real',
		'"d" double precision',
		'"dec" decimal(8, 2)',
		'"flag" boolean',
		'"day" date',
		'"at" time',
		'"attz" timetz',
		'"dt" timestamp',
		'"dttz" timestamptz',
		'"tstz" timestamptz',
		'"payload" jsonb',
		'"payloadB" jsonb',
		'"token" uuid',
		'"ulid" char(26)',
		'"addr" inet',
		'"bin" bytea',
		'"ip" varchar(45)',
		'"mac" varchar(17)',
		'"status" varchar(255)',
	],
	sqlite: [
		'"tiny" text',
		'"medium" text',
		'"long" text',
		'"code" text',
		'"ti" integer',
		'"si" integer',
		'"mi" integer',
		'"bi" integer',
		'"ub" integer',
		'"yr" integer',
		'"f" float',
		'"d" double',
		'"dec" decimal(8, 2)',
		'"flag" integer',
		'"day" date',
		'"at" time',
		'"attz" time',
		'"dt" text',
		'"dttz" text',
		'"tstz" text',
		'"payload" text',
		'"payloadB" text',
		'"token" char(36)',
		'"ulid" text',
		'"addr" text',
		'"bin" blob',
		'"ip" text',
		'"mac" text',
		'"status" varchar(255)',
	],
};

describe("column type mapping (compile-only)", () => {
	for (const kind of ["mysql", "postgres", "sqlite"] as const) {
		test(`${kind} maps every abstract type`, async () => {
			const orm = compileOnlyOrm({}, kind);
			const statements = await captureMany(orm, () =>
				orm.schemaBuilder().create("types", (t) => {
					t.id();
					t.tinyText("tiny");
					t.mediumText("medium");
					t.longText("long");
					t.char("code", 8);
					t.tinyInteger("ti");
					t.smallInteger("si");
					t.mediumInteger("mi");
					t.bigint("bi");
					t.unsignedBigInteger("ub");
					t.year("yr");
					t.float("f");
					t.double("d");
					t.decimal("dec", 8, 2);
					t.boolean("flag");
					t.date("day");
					t.time("at");
					t.timeTz("attz");
					t.datetime("dt");
					t.dateTimeTz("dttz");
					t.timestampTz("tstz");
					t.json("payload");
					t.jsonb("payloadB");
					t.uuid("token");
					t.ulid("ulid");
					t.inet("addr");
					t.binary("bin");
					t.ipAddress("ip");
					t.macAddress("mac");
					t.enum("status", ["a", "b"]);
				}),
			);
			expect(statements).toHaveLength(1);
			const ddl = statements[0]!;
			for (const part of typeExpectations[kind]) {
				expect(ddl).toContain(part);
			}
			expect(ddl).not.toContain("undefined");
		});
	}
});

// ---------------------------------------------------------------------------
// MySQL-only DDL.
// ---------------------------------------------------------------------------

describe("MySQL schema parity (compile-only)", () => {
	test("native enum/set, unsigned, comments, charset, invisible and generated columns", async () => {
		const orm = compileOnlyOrm({}, "mysql");
		const statements = await captureMany(orm, () =>
			orm.schemaBuilder().create("widgets", (t) => {
				t.id().startingValue(100);
				t.enum("status", ["draft", "published"]).default("draft");
				t.set("flags", ["a", "b"]);
				t.unsignedInteger("count")
					.comment("count me")
					.charset("utf8mb4")
					.collation("utf8mb4_bin");
				t.datetime("touchedAt").useCurrentOnUpdate().invisible();
				t.integer("price");
				t.integer("stored").storedAs("price * 2");
				t.integer("virtual").virtualAs("price * 3");
			}),
		);
		expect(statements).toHaveLength(1);
		const ddl = statements[0]!;
		expect(ddl).toContain(
			"`status` enum('draft', 'published') default 'draft' not null",
		);
		expect(ddl).toContain("`flags` set('a', 'b') not null");
		expect(ddl).toContain(
			"`count` integer unsigned character set utf8mb4 collate utf8mb4_bin not null comment 'count me'",
		);
		expect(ddl).toContain(
			"`touchedAt` datetime(3) not null on update CURRENT_TIMESTAMP invisible",
		);
		expect(ddl).toContain(
			"`stored` integer generated always as (price * 2) stored",
		);
		expect(ddl).toContain(
			"`virtual` integer generated always as (price * 3) virtual",
		);
		expect(ddl).toContain("auto_increment = 100");
	});

	test("table options and createIfNotExists", async () => {
		const orm = compileOnlyOrm({}, "mysql");
		const statements = await captureMany(orm, () =>
			orm.schemaBuilder().createIfNotExists("settings", (t) => {
				t.id();
				t.charset("utf8mb4")
					.collation("utf8mb4_general_ci")
					.comment("hello 'world'");
			}),
		);
		expect(statements).toHaveLength(1);
		const ddl = statements[0]!;
		expect(ddl).toContain("create table if not exists `settings`");
		expect(ddl).toContain(
			"character set utf8mb4 collate utf8mb4_general_ci comment = 'hello ''world'''",
		);
	});

	test("alter: placement, change, drops, primary key and indexes", async () => {
		const orm = compileOnlyOrm({}, "mysql");
		const statements = await captureMany(orm, () =>
			orm.schemaBuilder().alter("widgets", (t) => {
				t.string("note").after("status");
				t.string("firstNote").first();
				t.integer("price").change().after("status");
				t.dropColumn("legacy");
				t.renameColumn("old", "new");
				t.dropIndex("widgets_status_index");
				t.dropForeign("widgets_status_foreign");
				t.dropPrimary();
				t.index("note", "widgets_note_index");
				t.unique("note", "widgets_note_unique");
				t.fullText("note", "widgets_note_fulltext");
				t.spatialIndex("note", "widgets_note_spatial");
			}),
		);
		const sql = statements.join("\n");
		expect(sql).toContain(
			"alter table `widgets` add column `note` varchar(255) not null after `status`",
		);
		expect(sql).toContain(
			"alter table `widgets` add column `firstNote` varchar(255) not null first",
		);
		expect(sql).toContain(
			"alter table `widgets` modify column `price` integer not null after `status`",
		);
		expect(sql).toContain("alter table `widgets` drop column `legacy`");
		expect(sql).toContain("rename column `old` to `new`");
		expect(sql).toContain(
			"alter table `widgets` drop index `widgets_status_index`",
		);
		expect(sql).toContain(
			"alter table `widgets` drop foreign key `widgets_status_foreign`",
		);
		expect(sql).toContain("alter table `widgets` drop primary key");
		expect(sql).toContain(
			"create index `widgets_note_index` on `widgets` (`note`)",
		);
		expect(sql).toContain(
			"create unique index `widgets_note_unique` on `widgets` (`note`)",
		);
		expect(sql).toContain(
			"create fulltext index `widgets_note_fulltext` on `widgets` (`note`)",
		);
		expect(sql).toContain(
			"create spatial index `widgets_note_spatial` on `widgets` (`note`)",
		);
	});

	test("dropMorphs drops the composite index before the columns", async () => {
		const orm = compileOnlyOrm({}, "mysql");
		const statements = await captureMany(orm, () =>
			orm.schemaBuilder().alter("posts", (t) => t.dropMorphs("taggable")),
		);
		expect(statements).toEqual([
			"alter table `posts` drop index `posts_taggableId_taggableType_index`",
			"alter table `posts` drop column `taggableId`",
			"alter table `posts` drop column `taggableType`",
		]);
	});

	test("table-level foreign keys compile with actions", async () => {
		const orm = compileOnlyOrm({}, "mysql");
		const statements = await captureMany(orm, () =>
			orm.schemaBuilder().create("children", (t) => {
				t.id();
				t.foreignId("parentId").constrained("parents").onDelete("cascade");
				t.foreign("ownerId", "children_owner_foreign")
					.references("users.id")
					.onUpdate("restrict");
			}),
		);
		expect(statements).toHaveLength(1);
		const ddl = statements[0]!;
		expect(ddl).toContain(
			"constraint `children_parentId_foreign` foreign key (`parentId`) references `parents` (`id`) on delete cascade",
		);
		expect(ddl).toContain(
			"constraint `children_owner_foreign` foreign key (`ownerId`) references `users` (`id`) on update restrict",
		);
	});
});

// ---------------------------------------------------------------------------
// PostgreSQL-only DDL.
// ---------------------------------------------------------------------------

describe("PostgreSQL schema parity (compile-only)", () => {
	test("native types, comments and identity sequence starting value", async () => {
		const orm = compileOnlyOrm({}, "postgres");
		const statements = await captureMany(orm, () =>
			orm.schemaBuilder().create("widgets", (t) => {
				t.id().startingValue(50);
				t.enum("status", ["draft", "published"]).comment("state");
				t.jsonb("payload").nullable();
				t.uuid("token");
				t.inet("addr");
				t.timestampTz("seenAt");
				t.timeTz("at");
				t.binary("blob");
				t.comment("table comment 'quoted'");
			}),
		);
		expect(statements).toHaveLength(4);
		const ddl = statements[0]!;
		expect(ddl).toContain(
			"\"status\" varchar(255) not null check (\"status\" in ('draft', 'published'))",
		);
		expect(ddl).toContain('"payload" jsonb');
		expect(ddl).toContain('"token" uuid not null');
		expect(ddl).toContain('"addr" inet not null');
		expect(ddl).toContain('"seenAt" timestamptz not null');
		expect(ddl).toContain('"at" timetz not null');
		expect(ddl).toContain('"blob" bytea not null');
		expect(statements[1]).toBe(
			`comment on column "widgets"."status" is 'state'`,
		);
		expect(statements[2]).toBe(
			`comment on table "widgets" is 'table comment ''quoted'''`,
		);
		expect(statements[3]).toBe(
			`alter sequence "widgets_id_seq" restart with 50`,
		);
	});

	test("alter: change, drops, primary key and GiST spatial index", async () => {
		const orm = compileOnlyOrm({}, "postgres");
		const statements = await captureMany(orm, () =>
			orm.schemaBuilder().alter("widgets", (t) => {
				t.string("name", 120).change().default("x");
				t.dropPrimary();
				t.dropUnique("widgets_token_unique");
				t.dropForeign("widgets_owner_foreign");
				t.spatialIndex("addr", "widgets_addr_spatial");
				t.string("added").after("name");
			}),
		);
		const sql = statements.join("\n");
		expect(sql).toContain(
			'alter table "widgets" add column "added" varchar(255) not null',
		);
		expect(sql).not.toContain("after");
		expect(sql).toContain(
			'alter table "widgets" alter column "name" type varchar(120)',
		);
		expect(sql).toContain(
			'alter table "widgets" alter column "name" set not null',
		);
		expect(sql).toContain(
			`alter table "widgets" alter column "name" set default 'x'`,
		);
		expect(sql).toContain(
			'alter table "widgets" drop constraint "widgets_token_unique"',
		);
		expect(sql).toContain(
			'alter table "widgets" drop constraint "widgets_owner_foreign"',
		);
		expect(sql).toContain(
			'alter table "widgets" drop constraint "widgets_pkey"',
		);
		expect(sql).toContain(
			'create index "widgets_addr_spatial" on "widgets" using gist ("addr")',
		);
	});

	test("table-level foreign keys compile with actions", async () => {
		const orm = compileOnlyOrm({}, "postgres");
		const statements = await captureMany(orm, () =>
			orm.schemaBuilder().create("children", (t) => {
				t.id();
				t.foreignId("parentId").constrained("parents").onDelete("set null");
				t.foreign("ownerId").references("users.id").onUpdate("cascade");
			}),
		);
		expect(statements).toHaveLength(1);
		const ddl = statements[0]!;
		expect(ddl).toContain(
			'constraint "children_parentId_foreign" foreign key ("parentId") references "parents" ("id") on delete set null',
		);
		expect(ddl).toContain(
			'constraint "children_ownerId_foreign" foreign key ("ownerId") references "users" ("id") on update cascade',
		);
	});

	test("unsupported features throw instead of emitting invalid SQL", async () => {
		const orm = compileOnlyOrm({}, "postgres");
		await expect(
			orm.schemaBuilder().create("bad_set", (t) => {
				t.id();
				t.set("flags", ["a", "b"]);
			}),
		).rejects.toThrow(SchemaError);
		await expect(
			orm.schemaBuilder().create("bad_virtual", (t) => {
				t.id();
				t.integer("price");
				t.integer("virtual").virtualAs("price * 2");
			}),
		).rejects.toThrow(SchemaError);
		await expect(
			orm.schemaBuilder().create("bad_fulltext", (t) => {
				t.id();
				t.string("body");
				t.fullText("body");
			}),
		).rejects.toThrow(SchemaError);
	});
});

// ---------------------------------------------------------------------------
// SQLite compile-only mapping / guards.
// ---------------------------------------------------------------------------

describe("SQLite schema parity (compile-only)", () => {
	test("enum checks, generated columns and createIfNotExists", async () => {
		const orm = compileOnlyOrm({}, "sqlite");
		const statements = await captureMany(orm, () =>
			orm.schemaBuilder().createIfNotExists("widgets", (t) => {
				t.id();
				t.enum("status", ["draft", "published"]);
				t.integer("price");
				t.integer("stored").storedAs("price * 2");
				t.integer("virtual").virtualAs("price * 3");
			}),
		);
		expect(statements).toHaveLength(1);
		const ddl = statements[0]!;
		expect(ddl).toContain("create table if not exists");
		expect(ddl).toContain(
			"\"status\" varchar(255) not null check (\"status\" in ('draft', 'published'))",
		);
		expect(ddl).toContain(
			'"stored" integer generated always as (price * 2) stored',
		);
		expect(ddl).toContain(
			'"virtual" integer generated always as (price * 3) virtual',
		);
	});

	test("unsupported features throw instead of emitting invalid SQL", async () => {
		const orm = compileOnlyOrm({}, "sqlite");
		await expect(
			orm.schemaBuilder().create("bad_set", (t) => {
				t.id();
				t.set("flags", ["a", "b"]);
			}),
		).rejects.toThrow(SchemaError);
		await expect(
			orm.schemaBuilder().create("bad_fulltext", (t) => {
				t.id();
				t.string("body");
				t.fullText("body");
			}),
		).rejects.toThrow(SchemaError);
		await expect(
			orm.schemaBuilder().create("bad_spatial", (t) => {
				t.id();
				t.string("geo");
				t.spatialIndex("geo");
			}),
		).rejects.toThrow(SchemaError);
	});
});

// ---------------------------------------------------------------------------
// Define-schema validation for the new enum/set types.
// ---------------------------------------------------------------------------

describe("enum/set column definitions", () => {
	test("defineSchema accepts enum and set values", () => {
		const schema = defineSchema({
			flags: {
				id: { type: "integer", primaryKey: true, autoIncrement: true },
				status: { type: "enum", values: ["draft", "published"] },
				labels: { type: "set", values: ["a", "b"] },
			},
		});
		expect(schema.flags.status).toEqual({
			type: "enum",
			values: ["draft", "published"],
		});
	});

	test("values are required and only valid on enum/set columns", () => {
		expect(() =>
			defineSchema({
				flags: { status: { type: "enum" } },
			}),
		).toThrow();
		expect(() =>
			defineSchema({
				flags: { status: { type: "enum", values: [] } },
			}),
		).toThrow();
		expect(() =>
			defineSchema({
				flags: { status: { type: "string", values: ["a"] } },
			}),
		).toThrow();
	});
});
