// SQL generation tests for every dialect — no database required.
//
// `compileOnlyOrm` swaps in Kysely's real query compilers with a driver that
// executes nothing, so these tests assert the exact SQL and bindings each
// engine receives. Writes are captured through the query-event listener:
// the statement text is emitted even when execution is a no-op.

import { describe, expect, test } from "bun:test";
import type { DialectKind, Orm, QueryEvent, Schema } from "../../src/index";
import {
	belongsTo,
	belongsToMany,
	defineSchema,
	hasMany,
	InvalidQueryError,
	latestOfMany,
	morphedByMany,
	morphTo,
	morphToMany,
	SchemaError,
} from "../../src/index";
import { compileOnlyOrm } from "../../src/testing";

const schema = defineSchema({
	users: {
		id: { type: "integer", primaryKey: true, autoIncrement: true },
		name: "string",
		email: { type: "string", nullable: true },
		age: { type: "integer", nullable: true },
		active: { type: "boolean", default: true },
	},
	posts: {
		id: { type: "integer", primaryKey: true, autoIncrement: true },
		userId: "integer",
		title: "string",
		views: { type: "integer", default: 0 },
		published: { type: "boolean", default: false },
		deletedAt: { type: "datetime", nullable: true },
	},
	comments: {
		id: { type: "integer", primaryKey: true, autoIncrement: true },
		postId: "integer",
		body: "string",
		commentableId: { type: "integer", nullable: true },
		commentableType: { type: "string", nullable: true },
	},
	roles: {
		id: { type: "integer", primaryKey: true, autoIncrement: true },
		name: "string",
	},
	role_user: {
		userId: "integer",
		roleId: "integer",
		note: { type: "string", nullable: true },
	},
	tags: {
		id: { type: "integer", primaryKey: true, autoIncrement: true },
		name: "string",
	},
	taggables: {
		tagId: "integer",
		taggableId: "integer",
		taggableType: "string",
	},
});

function normalize(sql: string): string {
	return sql.replace(/\s+/g, " ").trim();
}

/** A compile-only ORM plus models wired with the parity relations. */
function setup(kind: DialectKind) {
	const orm = compileOnlyOrm(schema, kind);
	class CommentModel extends orm.model("comments") {}
	class RoleModel extends orm.model("roles") {}
	class TagModel extends orm.model("tags") {
		static relations = {
			posts: morphedByMany(() => PostModel, "taggable", {
				through: "taggables",
				foreignPivotKey: "tagId",
				relatedPivotKey: "taggableId",
			}),
		};
	}
	class UserModel extends orm.model("users") {
		static relations = {
			posts: hasMany(() => PostModel, "userId"),
			latestPost: latestOfMany(() => PostModel, "userId", "views"),
			roles: belongsToMany(() => RoleModel, {
				through: "role_user",
				foreignPivotKey: "userId",
				relatedPivotKey: "roleId",
				withPivot: ["note"],
			}),
		};
	}
	class PostModel extends orm.model("posts") {
		static morphAlias = "article";
		static relations = {
			author: belongsTo(() => UserModel, "userId"),
			comments: hasMany(() => CommentModel, "postId"),
			tags: morphToMany(() => TagModel, "taggable", {
				through: "taggables",
				foreignPivotKey: "taggableId",
				relatedPivotKey: "tagId",
			}),
		};
	}
	class SoftPostModel extends orm.model("posts") {
		static softDeletes = true;
	}
	return { orm, UserModel, PostModel, SoftPostModel, RoleModel, TagModel };
}

async function capture<S extends Schema>(
	orm: Orm<S>,
	run: () => Promise<unknown>,
): Promise<QueryEvent> {
	const events: QueryEvent[] = [];
	const off = orm.onQuery((event) => events.push(event));
	try {
		await run();
	} finally {
		off();
	}
	expect(events).toHaveLength(1);
	return events[0]!;
}

describe("SQLite SQL generation", () => {
	const orm = compileOnlyOrm(schema, "sqlite");

	test("select with filters and bindings", () => {
		const compiled = orm
			.table("users")
			.where("age", ">", 21)
			.where("active", true)
			.toSQL();
		expect(normalize(compiled.sql)).toBe(
			'select * from "users" where ("age" > ? and "active" = ?)',
		);
		expect(compiled.parameters).toEqual([21, true]);
	});

	test("insert omits generated columns and returns the key", async () => {
		const event = await capture(orm, () =>
			orm.table("users").insert({ name: "Ada" }),
		);
		expect(normalize(event.sql)).toBe(
			'insert into "users" ("name") values (?) returning "id"',
		);
		expect(event.parameters).toEqual(["Ada"]);
	});

	test("upsert compiles to ON CONFLICT DO UPDATE", async () => {
		const event = await capture(orm, () =>
			orm
				.table("users")
				.upsert(
					{ email: "a@b.c", name: "A" },
					{ conflictOn: "email", update: ["name"] },
				),
		);
		expect(normalize(event.sql)).toBe(
			'insert into "users" ("email", "name") values (?, ?) on conflict ("email") do update set "name" = "excluded"."name"',
		);
	});

	test("update and delete bind every value", async () => {
		const update = await capture(orm, () =>
			orm.table("users").where("age", ">=", 18).update({ name: "Adult" }),
		);
		expect(normalize(update.sql)).toBe(
			'update "users" set "name" = ? where "age" >= ?',
		);
		expect(update.parameters).toEqual(["Adult", 18]);
		const remove = await capture(orm, () =>
			orm.table("users").where("id", 7).delete(),
		);
		expect(normalize(remove.sql)).toBe('delete from "users" where "id" = ?');
		expect(remove.parameters).toEqual([7]);
	});

	test("joins select base columns explicitly", () => {
		const compiled = orm
			.table("posts")
			.join("users", "posts.userId", "=", "users.id")
			.where("users.active", true)
			.toSQL();
		expect(normalize(compiled.sql)).toBe(
			'select "posts"."id", "posts"."userId", "posts"."title", "posts"."views", "posts"."published", "posts"."deletedAt" from "posts" inner join "users" on "posts"."userId" = "users"."id" where "users"."active" = ?',
		);
	});

	test("whereHas compiles to a correlated EXISTS", () => {
		const { UserModel } = setup("sqlite");
		const compiled = UserModel.query()
			.whereIn("id", [1, 2])
			.whereHas("posts", (group) => group.where("title", "Hello"))
			.toSQL();
		expect(normalize(compiled.sql)).toBe(
			'select * from "users" where ("id" in (?, ?) and exists (select 1 as "one" from "posts" where "posts"."userId" = "users"."id" and "posts"."title" = ?))',
		);
		expect(compiled.parameters).toEqual([1, 2, "Hello"]);
	});

	test("whereDoesntHave compiles to NOT EXISTS", () => {
		const { UserModel } = setup("sqlite");
		const compiled = UserModel.query().whereDoesntHave("posts").toSQL();
		expect(normalize(compiled.sql)).toBe(
			'select * from "users" where not exists (select 1 as "one" from "posts" where "posts"."userId" = "users"."id")',
		);
	});

	test("orWhereHas keeps the OR boolean", () => {
		const { UserModel } = setup("sqlite");
		const compiled = UserModel.query()
			.where("age", ">", 18)
			.orWhereHas("posts")
			.toSQL();
		expect(normalize(compiled.sql)).toBe(
			'select * from "users" where ("age" > ? or exists (select 1 as "one" from "posts" where "posts"."userId" = "users"."id"))',
		);
		expect(compiled.parameters).toEqual([18]);
	});

	test("nested whereHas chains correlated EXISTS subqueries", () => {
		const { UserModel } = setup("sqlite");
		const compiled = UserModel.query()
			.whereHas("posts.comments", (group) => group.where("body", "Hi"))
			.toSQL();
		expect(normalize(compiled.sql)).toBe(
			'select * from "users" where exists (select 1 as "one" from "posts" where "posts"."userId" = "users"."id" and exists (select 1 as "one" from "comments" where "comments"."postId" = "posts"."id" and "comments"."body" = ?))',
		);
		expect(compiled.parameters).toEqual(["Hi"]);
	});

	test("withCount and withSum compile correlated aggregate subqueries", () => {
		const { UserModel } = setup("sqlite");
		const counts = UserModel.query().withCount("posts").toSQL();
		expect(normalize(counts.sql)).toBe(
			'select *, (select count(*) as "count" from "posts" where "posts"."userId" = "users"."id") as "postsCount" from "users"',
		);
		const sums = UserModel.query().withSum("posts", "views").toSQL();
		expect(normalize(sums.sql)).toBe(
			'select *, (select sum("posts"."views") as "value" from "posts" where "posts"."userId" = "users"."id") as "postsSumViews" from "users"',
		);
	});

	test("soft-delete scopes compile to IS NULL predicates", () => {
		const { SoftPostModel } = setup("sqlite");
		const scoped = SoftPostModel.query().where("title", "x").toSQL();
		expect(normalize(scoped.sql)).toBe(
			'select * from "posts" where ("deletedAt" is null and "title" = ?)',
		);
		expect(normalize(SoftPostModel.onlyTrashed().toSQL().sql)).toBe(
			'select * from "posts" where "deletedAt" is not null',
		);
		expect(normalize(SoftPostModel.withTrashed().toSQL().sql)).toBe(
			'select * from "posts"',
		);
	});

	test("soft delete, restore and forceDelete compile to DML", async () => {
		const { orm, SoftPostModel } = setup("sqlite");
		const events: QueryEvent[] = [];
		const off = orm.onQuery((event) => events.push(event));
		try {
			await SoftPostModel.query().where("title", "x").delete();
			await SoftPostModel.onlyTrashed().where("title", "x").restore();
			await SoftPostModel.query().where("title", "x").forceDelete();
		} finally {
			off();
		}
		expect(events.map((event) => normalize(event.sql))).toEqual([
			'update "posts" set "deletedAt" = ? where ("deletedAt" is null and "title" = ?)',
			'update "posts" set "deletedAt" = ? where ("deletedAt" is not null and "title" = ?)',
			'delete from "posts" where ("deletedAt" is null and "title" = ?)',
		]);
		expect(events[1]!.parameters[0]).toBeNull();
	});

	test("increment and decrement compile to atomic arithmetic", async () => {
		const { orm } = setup("sqlite");
		const increment = await capture(orm, () =>
			orm.table("users").where("id", 1).increment("age", 2, { name: "n" }),
		);
		expect(normalize(increment.sql)).toBe(
			'update "users" set "name" = ?, "age" = "age" + ? where "id" = ?',
		);
		expect(increment.parameters).toEqual(["n", 2, 1]);
		const decrement = await capture(orm, () =>
			orm.table("users").where("id", 1).decrement("age", 3),
		);
		expect(normalize(decrement.sql)).toBe(
			'update "users" set "age" = "age" + ? where "id" = ?',
		);
		expect(decrement.parameters).toEqual([-3, 1]);
	});

	test("fromRaw replaces the FROM source and keeps its bindings", () => {
		const compiled = orm
			.table("users")
			.select("id", "name")
			.fromRaw("(select id, name from users where age > ?)", "older", [21])
			.toSQL();
		expect(normalize(compiled.sql)).toBe(
			'select "id", "name" from (select id, name from users where age > ?) as "older"',
		);
		expect(compiled.parameters).toEqual([21]);

		// The alias may also be written inside the expression.
		const embedded = orm
			.table("users")
			.select("id")
			.fromRaw("(select id from users) as fresh")
			.toSQL();
		expect(normalize(embedded.sql)).toBe(
			'select "id" from (select id from users) as "fresh"',
		);

		expect(() => orm.table("users").fromRaw("(select id from users)")).toThrow(
			InvalidQueryError,
		);
	});

	test("distinctOn is PostgreSQL-only", () => {
		expect(() => orm.table("users").distinctOn("name")).toThrow(
			InvalidQueryError,
		);
	});
});

describe("MySQL SQL generation", () => {
	const orm = compileOnlyOrm(schema, "mysql");

	test("select uses backticks and question-mark placeholders", () => {
		const compiled = orm.table("users").where("age", ">", 21).toSQL();
		expect(normalize(compiled.sql)).toBe(
			"select * from `users` where `age` > ?",
		);
		expect(compiled.parameters).toEqual([21]);
	});

	test("insert has no RETURNING clause (driver reports insertId)", async () => {
		const event = await capture(orm, () =>
			orm.table("users").insert({ name: "Ada" }),
		);
		expect(normalize(event.sql)).toBe(
			"insert into `users` (`name`) values (?)",
		);
	});

	test("upsert compiles to ON DUPLICATE KEY UPDATE", async () => {
		const event = await capture(orm, () =>
			orm
				.table("users")
				.upsert(
					{ email: "a@b.c", name: "A" },
					{ conflictOn: "email", update: ["name"] },
				),
		);
		expect(normalize(event.sql)).toBe(
			"insert into `users` (`email`, `name`) values (?, ?) on duplicate key update `name` = values(`name`)",
		);
	});

	test("whereHas uses EXISTS with backticks", () => {
		const { UserModel } = setup("mysql");
		const compiled = UserModel.query()
			.whereHas("posts", (group) => group.where("title", "Hello"))
			.toSQL();
		expect(normalize(compiled.sql)).toBe(
			"select * from `users` where exists (select 1 as `one` from `posts` where `posts`.`userId` = `users`.`id` and `posts`.`title` = ?)",
		);
	});

	test("whereDoesntHave and withCount use backticks", () => {
		const { UserModel } = setup("mysql");
		expect(
			normalize(UserModel.query().whereDoesntHave("posts").toSQL().sql),
		).toBe(
			"select * from `users` where not exists (select 1 as `one` from `posts` where `posts`.`userId` = `users`.`id`)",
		);
		expect(normalize(UserModel.query().withCount("posts").toSQL().sql)).toBe(
			"select *, (select count(*) as `count` from `posts` where `posts`.`userId` = `users`.`id`) as `postsCount` from `users`",
		);
	});

	test("soft-delete rows compile with backticks and placeholders", async () => {
		const { orm, SoftPostModel } = setup("mysql");
		expect(
			normalize(SoftPostModel.query().where("title", "x").toSQL().sql),
		).toBe("select * from `posts` where (`deletedAt` is null and `title` = ?)");
		const event = await capture(orm, () =>
			SoftPostModel.query().where("title", "x").delete(),
		);
		expect(normalize(event.sql)).toBe(
			"update `posts` set `deletedAt` = ? where (`deletedAt` is null and `title` = ?)",
		);
	});
});

describe("PostgreSQL SQL generation", () => {
	const orm = compileOnlyOrm(schema, "postgres");

	test("select uses numbered placeholders", () => {
		const compiled = orm
			.table("users")
			.where("age", ">", 21)
			.where("name", "like", "A%")
			.toSQL();
		expect(normalize(compiled.sql)).toBe(
			'select * from "users" where ("age" > $1 and "name" like $2)',
		);
		expect(compiled.parameters).toEqual([21, "A%"]);
	});

	test("insert uses RETURNING", async () => {
		const event = await capture(orm, () =>
			orm.table("users").insert({ name: "Ada" }),
		);
		expect(normalize(event.sql)).toBe(
			'insert into "users" ("name") values ($1) returning "id"',
		);
	});

	test("distinctOn compiles to DISTINCT ON", () => {
		const compiled = orm
			.table("users")
			.distinctOn("name")
			.orderBy("name")
			.toSQL();
		expect(normalize(compiled.sql)).toBe(
			'select distinct on ("name") * from "users" order by "name" asc',
		);
	});

	test("upsert compiles to ON CONFLICT DO UPDATE", async () => {
		const event = await capture(orm, () =>
			orm
				.table("users")
				.upsert(
					{ email: "a@b.c", name: "A" },
					{ conflictOn: "email", update: ["name"] },
				),
		);
		expect(normalize(event.sql)).toBe(
			'insert into "users" ("email", "name") values ($1, $2) on conflict ("email") do update set "name" = "excluded"."name"',
		);
		expect(event.parameters).toEqual(["a@b.c", "A"]);
	});

	test("whereHas compiles to a correlated EXISTS with numbered bindings", () => {
		const { UserModel } = setup("postgres");
		const compiled = UserModel.query()
			.whereHas("posts", (group) => group.where("title", "Hello"))
			.toSQL();
		expect(normalize(compiled.sql)).toBe(
			'select * from "users" where exists (select 1 as "one" from "posts" where "posts"."userId" = "users"."id" and "posts"."title" = $1)',
		);
	});
});

describe("dialect-independent behavior", () => {
	test("compile-only ORMs refuse execution gracefully", async () => {
		const orm = compileOnlyOrm(schema, "mysql");
		const rows = await orm.table("users").get();
		expect(rows.toArray()).toEqual([]);
	});

	test("ilike falls back per dialect at compile time", () => {
		const sqlite = compileOnlyOrm(schema, "sqlite");
		const sqliteSQL = normalize(
			sqlite.table("users").where("name", "ilike", "a%").toSQL().sql,
		);
		expect(sqliteSQL).toContain("like");
		expect(sqliteSQL.toLowerCase()).not.toContain("ilike");

		const postgres = compileOnlyOrm(schema, "postgres");
		const postgresSQL = normalize(
			postgres.table("users").where("name", "ilike", "a%").toSQL().sql,
		);
		expect(postgresSQL.toLowerCase()).toContain("ilike");
	});
});

describe("dialect DDL", () => {
	test("auto-increment, boolean and floating types compile safely", async () => {
		const expected = {
			mysql:
				"create table `typed` (`id` bigint not null primary key auto_increment, `active` tinyint(1) not null, `score` float not null, `ratio` double not null)",
			postgres:
				'create table "typed" ("id" bigint generated by default as identity not null primary key, "active" boolean not null, "score" real not null, "ratio" double precision not null)',
			sqlite:
				'create table "typed" ("id" integer not null primary key autoincrement, "active" integer not null, "score" float not null, "ratio" double not null)',
		} as const;
		for (const kind of ["mysql", "postgres", "sqlite"] as const) {
			const orm = compileOnlyOrm(
				{
					typed: {
						id: { type: "integer", primaryKey: true, autoIncrement: true },
						active: "boolean",
						score: "float",
						ratio: "double",
					},
				},
				kind,
			);
			const statements: string[] = [];
			const off = orm.onQuery((event) => statements.push(event.sql));
			await orm.schemaBuilder().create("typed", (table) => {
				table.id();
				table.boolean("active");
				table.float("score");
				table.double("ratio");
			});
			off();
			expect(statements).toHaveLength(1);
			expect(normalize(statements[0]!)).toBe(expected[kind]);
		}
	});
});

describe("Priority-1 parity SQL generation", () => {
	test("inRandomOrder uses the dialect's random function", () => {
		expect(
			normalize(
				compileOnlyOrm(schema, "sqlite").table("users").inRandomOrder().toSQL()
					.sql,
			),
		).toBe('select * from "users" order by random()');
		expect(
			normalize(
				compileOnlyOrm(schema, "mysql").table("users").inRandomOrder().toSQL()
					.sql,
			),
		).toBe("select * from `users` order by rand()");
		expect(
			normalize(
				compileOnlyOrm(schema, "postgres")
					.table("users")
					.inRandomOrder()
					.toSQL().sql,
			),
		).toBe('select * from "users" order by random()');
	});

	test("whereIntegerInRaw inlines safe integers and rejects everything else", () => {
		const { UserModel } = setup("sqlite");
		const compiled = UserModel.query()
			.whereIntegerInRaw("id", [1, 2, 3])
			.whereIntegerNotInRaw("id", [4n, 5n])
			.toSQL();
		expect(normalize(compiled.sql)).toBe(
			'select * from "users" where ("id" in (1, 2, 3) and "id" not in (4, 5))',
		);
		expect(compiled.parameters).toEqual([]);
		// Empty lists compile to constant predicates instead of `in ()`.
		expect(
			normalize(UserModel.query().whereIntegerInRaw("id", []).toSQL().sql),
		).toBe('select * from "users" where 1 = 0');
		expect(
			normalize(UserModel.query().whereIntegerNotInRaw("id", []).toSQL().sql),
		).toBe('select * from "users" where 1 = 1');
		// Only safe integers and bigints may be inlined.
		expect(() => UserModel.query().whereIntegerInRaw("id", [1.5])).toThrow(
			InvalidQueryError,
		);
		expect(() =>
			UserModel.query().whereIntegerInRaw("id", ["1" as never]),
		).toThrow(InvalidQueryError);
		expect(() =>
			UserModel.query().whereIntegerNotInRaw("id", [Number.NaN]),
		).toThrow(InvalidQueryError);
	});

	test("whereExists and selectSub compile correlated subqueries", () => {
		const { UserModel } = setup("sqlite");
		const exists = UserModel.query()
			.whereExists("posts", (posts) =>
				posts
					.whereColumn("posts.userId", "=", "users.id")
					.where("posts.published", true),
			)
			.toSQL();
		expect(normalize(exists.sql)).toBe(
			'select * from "users" where exists (select * from "posts" where ("posts"."userId" = "users"."id" and "posts"."published" = ?))',
		);
		expect(exists.parameters).toEqual([true]);

		const sub = UserModel.query()
			.selectSub("posts", "latestTitle", (posts) =>
				posts
					.select("title")
					.whereColumn("posts.userId", "=", "users.id")
					.orderBy("posts.id", "desc")
					.limit(1),
			)
			.toSQL();
		expect(normalize(sub.sql)).toBe(
			'select *, (select "title" from "posts" where "posts"."userId" = "users"."id" order by "posts"."id" desc limit ?) as "latestTitle" from "users"',
		);
		expect(sub.parameters).toEqual([1]);
	});

	test("union and unionAll merge result sets with numbered placeholders", () => {
		const { UserModel } = setup("postgres");
		const compiled = UserModel.query()
			.where("age", ">", 30)
			.union(UserModel.query().where("age", "<", 10))
			.toSQL();
		expect(normalize(compiled.sql)).toBe(
			'select * from "users" where "age" > $1 union select * from "users" where "age" < $2',
		);
		expect(compiled.parameters).toEqual([30, 10]);
		expect(
			normalize(
				UserModel.query()
					.where("age", ">", 30)
					.unionAll(UserModel.query().where("age", "<", 10))
					.toSQL().sql,
			),
		).toBe(
			'select * from "users" where "age" > $1 union all select * from "users" where "age" < $2',
		);
	});

	test("whereNotBetween and orWhereNot negate without interpolation", () => {
		const { UserModel } = setup("mysql");
		const compiled = UserModel.query()
			.whereNotBetween("age", [10, 20])
			.orWhereNot((group) => group.where("name", "x").where("age", 1))
			.toSQL();
		expect(normalize(compiled.sql)).toBe(
			"select * from `users` where (not `age` between ? and ? or not (`name` = ? and `age` = ?))",
		);
		expect(compiled.parameters).toEqual([10, 20, "x", 1]);
	});

	test("one-of-many relations compile a correlated extreme subquery", () => {
		const expected = {
			sqlite:
				'select * from "users" where exists (select 1 as "one" from "posts" where "posts"."userId" = "users"."id" and "posts"."id" = (select "__barq_of_many"."id" from "posts" as "__barq_of_many" where "__barq_of_many"."userId" = "users"."id" order by "__barq_of_many"."views" desc, "__barq_of_many"."id" desc limit 1))',
			mysql:
				"select * from `users` where exists (select 1 as `one` from `posts` where `posts`.`userId` = `users`.`id` and `posts`.`id` = (select `__barq_of_many`.`id` from `posts` as `__barq_of_many` where `__barq_of_many`.`userId` = `users`.`id` order by `__barq_of_many`.`views` desc, `__barq_of_many`.`id` desc limit 1))",
		} as const;
		for (const kind of ["sqlite", "mysql"] as const) {
			const { UserModel } = setup(kind);
			expect(
				normalize(UserModel.query().whereHas("latestPost").toSQL().sql),
			).toBe(expected[kind]);
		}
	});

	test("morphToMany and morphedByMany compile the alias predicate", () => {
		const { PostModel, TagModel } = setup("postgres");
		const forward = PostModel.query().whereHas("tags").toSQL();
		expect(normalize(forward.sql)).toBe(
			'select * from "posts" where exists (select 1 as "one" from "tags" inner join "taggables" on "taggables"."tagId" = "tags"."id" where "taggables"."taggableId" = "posts"."id" and "taggables"."taggableType" = $1)',
		);
		expect(forward.parameters).toEqual(["article"]);

		const inverse = TagModel.query().whereHas("posts").toSQL();
		expect(normalize(inverse.sql)).toBe(
			'select * from "tags" where exists (select 1 as "one" from "posts" inner join "taggables" on "taggables"."taggableId" = "posts"."id" where "taggables"."tagId" = "tags"."id" and "taggables"."taggableType" = $1)',
		);
		expect(inverse.parameters).toEqual(["article"]);
	});

	test("pivot manager constraints compile into the pivot subquery", () => {
		const { orm, UserModel } = setup("sqlite");
		const user = orm.hydrateModelRow(
			UserModel,
			{ id: 7, name: "Ada" },
			true,
		) as InstanceType<typeof UserModel>;
		const compiled = user
			.relation("roles")
			.wherePivot("note", "primary")
			.wherePivotIn("note", ["a", "b"])
			.orderByPivot("note", "desc")
			.query()
			.toSQL();
		expect(normalize(compiled.sql)).toBe(
			'select * from "roles" where "roles"."id" in (select "roleId" from "role_user" where "userId" = ? and "note" = ? and "note" in (?, ?)) order by (select "note" from "role_user" where "roleId" = "roles"."id" and "userId" = ? and "note" = ? and "note" in (?, ?) limit 1) desc',
		);
		expect(compiled.parameters).toEqual([
			7,
			"primary",
			"a",
			"b",
			7,
			"primary",
			"a",
			"b",
		]);
		expect(() =>
			user.relation("roles").wherePivot("note", "evil", "x"),
		).toThrow(InvalidQueryError);
	});

	test("the global morph map resolves aliases before table names", () => {
		const { orm, PostModel, TagModel } = setup("sqlite");
		expect(orm.morphAlias(PostModel)).toBe("article"); // static alias wins
		expect(orm.morphAlias(TagModel)).toBe("tags"); // table-name fallback
		orm.morphMap({ labels: TagModel });
		expect(orm.morphAlias(TagModel)).toBe("labels");
		expect(orm.morphClass("labels")).toBe(TagModel);
		expect(orm.morphClass("article")).toBeUndefined();
		orm.morphMap({ tags: TagModel }); // re-registration moves the class
		expect(orm.morphAlias(TagModel)).toBe("tags");
		expect(orm.morphClass("labels")).toBeUndefined();
		expect(orm.morphMapEntries().map(([alias]) => alias)).toEqual(["tags"]);
		expect(() => orm.morphMap({ "": TagModel })).toThrow(SchemaError);
	});
});

// ---------------------------------------------------------------------------
// Priority-2 additions: JSON paths, morph/attached constraints, new DDL types
// ---------------------------------------------------------------------------

describe("priority-2 SQL generation", () => {
	const ddlSchema = defineSchema({
		widgets: {
			id: { type: "integer", primaryKey: true, autoIncrement: true },
			code: { type: "char", length: 12 },
			flags: { type: "tinyint", nullable: true },
			rank: { type: "smallint", nullable: true },
			size: { type: "mediumint", nullable: true },
			payload: { type: "jsonb", nullable: true },
		},
	});

	test("whereJsonContains path per dialect", () => {
		const sqlite = compileOnlyOrm(schema, "sqlite")
			.table("users")
			.whereJsonContains("name", "x", "$.a.b")
			.toSQL();
		expect(normalize(sqlite.sql)).toContain('json_extract("name", ?)');
		expect(sqlite.parameters).toEqual(["$.a.b", "x"]);

		const mysql = compileOnlyOrm(schema, "mysql")
			.table("users")
			.whereJsonContains("name", "x", "$.a.b")
			.toSQL();
		expect(normalize(mysql.sql)).toContain(
			"json_contains(json_extract(`name`, ?), ?)",
		);
		expect(mysql.parameters).toEqual(["$.a.b", '"x"']);

		const postgres = compileOnlyOrm(schema, "postgres")
			.table("users")
			.whereJsonContains("name", "x", "$.a.b")
			.toSQL();
		expect(normalize(postgres.sql)).toContain('("name" #> $1) @> $2::jsonb');
		expect(postgres.parameters).toEqual(["{a,b}", '"x"']);
	});

	test("containsKey / doesntContainKey per dialect", () => {
		const sqlite = compileOnlyOrm(schema, "sqlite")
			.table("users")
			.whereJsonContainsKey("name", "$.a")
			.whereJsonDoesntContainKey("email", "b.c")
			.toSQL();
		expect(normalize(sqlite.sql)).toContain('json_type("name", ?) is not null');
		expect(normalize(sqlite.sql)).toContain('json_type("email", ?) is null');
		expect(sqlite.parameters).toEqual(["$.a", "$.b.c"]);

		const mysql = compileOnlyOrm(schema, "mysql")
			.table("users")
			.whereJsonContainsKey("name", "$.a")
			.toSQL();
		expect(normalize(mysql.sql)).toContain(
			"json_contains_path(`name`, 'one', ?)",
		);

		const postgres = compileOnlyOrm(schema, "postgres")
			.table("users")
			.whereJsonDoesntContainKey("name", "$.a.b")
			.toSQL();
		expect(normalize(postgres.sql)).toContain(
			'(("name")::jsonb #> $1::text[]) is null',
		);
		expect(postgres.parameters).toEqual(["{a,b}"]);
	});

	test("whereJsonOverlaps per dialect", () => {
		const mysql = compileOnlyOrm(schema, "mysql")
			.table("users")
			.whereJsonOverlaps("name", ["a"])
			.toSQL();
		expect(normalize(mysql.sql)).toContain("json_overlaps(`name`, ?)");

		const postgres = normalize(
			compileOnlyOrm(schema, "postgres")
				.table("users")
				.whereJsonOverlaps("name", ["a"])
				.toSQL().sql,
		);
		expect(postgres).toContain("jsonb_typeof((\"name\")::jsonb) = 'array'");
		expect(postgres).toContain("jsonb_array_elements");

		const sqlite = normalize(
			compileOnlyOrm(schema, "sqlite")
				.table("users")
				.whereJsonOverlaps("name", ["a"])
				.toSQL().sql,
		);
		expect(sqlite).toContain('json_each("name")');
		expect(sqlite).toContain("json_type(\"name\") = 'array'");
	});

	test("whereJsonLength with a path per dialect", () => {
		const sqlite = compileOnlyOrm(schema, "sqlite")
			.table("users")
			.whereJsonLength("name", ">=", 2, "$.tags")
			.toSQL();
		expect(normalize(sqlite.sql)).toContain(
			'json_array_length("name", ?) >= ?',
		);

		const mysql = compileOnlyOrm(schema, "mysql")
			.table("users")
			.whereJsonLength("name", ">", 1, "$.tags")
			.toSQL();
		expect(normalize(mysql.sql)).toContain(
			"json_length(json_extract(`name`, ?)) > ?",
		);

		const postgres = compileOnlyOrm(schema, "postgres")
			.table("users")
			.whereJsonLength("name", "<", 3, "$.tags")
			.toSQL();
		expect(normalize(postgres.sql)).toContain(
			'jsonb_array_length(("name") #> $1) < $2',
		);
	});

	test("whereMorphedTo / whereAttachedTo compile per dialect", () => {
		const target = {
			constructor: undefined as unknown,
			get: (column: string) => (column === "id" ? 7 : undefined),
		};
		const build = (kind: DialectKind) => {
			const orm = compileOnlyOrm(schema, kind);
			class UserM extends orm.model("users") {
				static relations = {
					roles: belongsToMany(() => RoleM, {
						through: "role_user",
						foreignPivotKey: "userId",
						relatedPivotKey: "roleId",
					}),
				};
			}
			class RoleM extends orm.model("roles") {}
			class CommentM extends orm.model("comments") {
				static relations = {
					commentable: morphTo("commentable", () => ({
						users: UserM,
						roles: RoleM,
					})),
				};
			}
			return { orm, UserM, RoleM, CommentM };
		};

		for (const kind of ["sqlite", "mysql", "postgres"] as const) {
			const { orm, UserM, RoleM, CommentM } = build(kind);
			const commentTarget = {
				constructor: CommentM,
				get: (column: string) => (column === "id" ? 3 : undefined),
			};
			const roleTarget = {
				constructor: RoleM,
				get: (column: string) => (column === "id" ? 9 : undefined),
			};
			const byMorph = CommentM.query()
				.whereMorphedTo("commentable", commentTarget as never)
				.toSQL();
			expect(normalize(byMorph.sql)).toContain("commentableType");
			expect(normalize(byMorph.sql)).toContain("commentableId");
			expect(byMorph.parameters).toEqual(["comments", 3]);

			const attached = UserM.query()
				.whereAttachedTo(roleTarget as never)
				.toSQL();
			expect(normalize(attached.sql)).toContain("exists");
			expect(normalize(attached.sql)).toContain("role_user");
			expect(attached.parameters).toEqual([9]);

			const without = UserM.query()
				.whereNotAttachedTo(roleTarget as never)
				.toSQL();
			expect(normalize(without.sql)).toContain("not exists");

			void target;
			void orm;
		}
	});

	test("new column types compile per dialect", async () => {
		const mysql = compileOnlyOrm(ddlSchema, "mysql");
		const mysqlEvent = await capture(mysql, () =>
			mysql.schemaBuilder().create("widgets", (t) => {
				t.id();
				t.char("code", 12);
				t.tinyInteger("flags").unsigned().default(0);
				t.smallInteger("rank");
				t.mediumInteger("size");
				t.jsonb("payload").nullable();
			}),
		);
		const mysqlSql = normalize(mysqlEvent.sql);
		expect(mysqlSql).toContain("`code` char(12)");
		expect(mysqlSql).toContain("`flags` tinyint unsigned");
		expect(mysqlSql).toContain("`rank` smallint");
		expect(mysqlSql).toContain("`size` mediumint");
		expect(mysqlSql).toContain("`payload` json");

		const postgres = compileOnlyOrm(ddlSchema, "postgres");
		const pgEvent = await capture(postgres, () =>
			postgres.schemaBuilder().create("widgets", (t) => {
				t.id();
				t.char("code", 12);
				t.tinyInteger("flags").unsigned();
				t.jsonb("payload").nullable();
			}),
		);
		const pgSql = normalize(pgEvent.sql);
		expect(pgSql).toContain('"code" char(12)');
		expect(pgSql).toContain('"flags" smallint');
		expect(pgSql).toContain('"payload" jsonb');

		const sqlite = compileOnlyOrm(ddlSchema, "sqlite");
		const sqliteEvent = await capture(sqlite, () =>
			sqlite.schemaBuilder().create("widgets", (t) => {
				t.id();
				t.char("code", 12);
				t.tinyInteger("flags").unsigned();
				t.jsonb("payload").nullable();
			}),
		);
		const sqliteSql = normalize(sqliteEvent.sql);
		expect(sqliteSql).toContain('"code" text');
		expect(sqliteSql).toContain('"flags" integer');
		expect(sqliteSql).toContain('"payload" text');
	});
});
