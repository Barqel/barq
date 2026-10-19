// Shared integration suite for the server dialects (MySQL / PostgreSQL).
//
// The exact same test body runs against either engine. SQLite is covered by
// `sqlite.test.ts` on every `bun test`; MySQL and PostgreSQL run this suite
// when `BARQ_ORM_MYSQL_URL` / `BARQ_ORM_PG_URL` point at a live server. Until
// then those dialects are documented as "SQL generation tested, live tests
// pending" — never claimed as verified.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Dialect } from "kysely";
import {
	belongsTo,
	belongsToMany,
	defineSchema,
	hasMany,
	hasManyThrough,
	hasOne,
	latestOfMany,
	type MigrationContext,
	Migrator,
	morphedByMany,
	morphMany,
	morphTo,
	morphToMany,
	Orm,
	runSeeders,
	UniqueConstraintError,
	withDefault,
} from "../../src/index";

export function runDialectSuite(
	label: string,
	makeDialect: () => Dialect,
	options: { placeholder: (position: number) => string },
): void {
	describe(label, () => {
		const schema = defineSchema({
			users: {
				id: { type: "integer", primaryKey: true, autoIncrement: true },
				name: "string",
				email: "string",
				age: { type: "integer", nullable: true },
				active: { type: "boolean", default: true },
				settings: { type: "json", nullable: true },
				scores: { type: "json", nullable: true },
				balance: { type: "decimal", nullable: true },
				countryId: { type: "integer", nullable: true },
				deletedAt: { type: "datetime", nullable: true },
				createdAt: { type: "datetime", nullable: true },
				updatedAt: { type: "datetime", nullable: true },
			},
			bigRecords: {
				id: {
					type: "bigint",
					primaryKey: true,
					autoIncrement: true,
					bigInt: true,
				},
				value: { type: "bigint", bigInt: true },
			},
			bigScores: {
				id: { type: "integer", primaryKey: true, autoIncrement: true },
				bigRecordId: { type: "bigint", bigInt: true },
				amount: { type: "bigint", bigInt: true },
			},
			posts: {
				id: { type: "integer", primaryKey: true, autoIncrement: true },
				userId: "integer",
				title: "string",
				views: { type: "integer", default: 0 },
				deletedAt: { type: "datetime", nullable: true },
			},
			profiles: {
				id: { type: "integer", primaryKey: true, autoIncrement: true },
				userId: "integer",
				bio: { type: "text", nullable: true },
			},
			countries: {
				id: { type: "integer", primaryKey: true, autoIncrement: true },
				name: "string",
			},
			comments: {
				id: { type: "integer", primaryKey: true, autoIncrement: true },
				body: "string",
				commentableId: "integer",
				commentableType: "string",
			},
			videos: {
				id: { type: "integer", primaryKey: true, autoIncrement: true },
				title: "string",
			},
			tags: {
				id: { type: "integer", primaryKey: true, autoIncrement: true },
				name: "string",
			},
			taggables: {
				taggableId: "integer",
				taggableType: "string",
				tagId: "integer",
			},
			roles: {
				id: { type: "integer", primaryKey: true, autoIncrement: true },
				name: "string",
			},
			role_user: {
				userId: "integer",
				roleId: "integer",
				note: { type: "string", nullable: true },
				createdAt: { type: "datetime", nullable: true },
				updatedAt: { type: "datetime", nullable: true },
			},
			priorityWidgets: {
				id: { type: "integer", primaryKey: true, autoIncrement: true },
				code: { type: "char", length: 12 },
				flags: { type: "tinyint", nullable: true },
				rank: { type: "smallint", nullable: true },
				size: { type: "mediumint", nullable: true },
				payload: { type: "jsonb", nullable: true },
				userId: { type: "bigint", nullable: true },
			},
			prioritySessions: {
				id: { type: "integer", primaryKey: true, autoIncrement: true },
				token: "string",
				expiresAt: { type: "datetime" },
			},
		});

		const orm = new Orm({ schema, dialect: makeDialect() });

		class Country extends orm.model("countries") {
			static relations = {
				users: hasMany(() => User, "countryId"),
				posts: hasManyThrough(
					() => Post,
					() => User,
					"countryId",
					"userId",
				),
			};
		}

		class User extends orm.model("users") {
			static relations = {
				posts: hasMany(() => Post, "userId"),
				profile: hasOne(() => Profile, "userId"),
				country: belongsTo(() => Country, "countryId"),
				latestPost: latestOfMany(() => Post, "userId", "views"),
				roles: belongsToMany(() => Role, {
					through: "role_user",
					foreignPivotKey: "userId",
					relatedPivotKey: "roleId",
					withPivot: ["note"],
					timestamps: true,
					as: "membership",
				}),
				tags: morphToMany(() => Tag, "taggable", {
					through: "taggables",
					foreignPivotKey: "taggableId",
					relatedPivotKey: "tagId",
				}),
			};
			static casts = { active: "boolean", settings: "json" } as const;
			static fillable = [
				"name",
				"email",
				"age",
				"active",
				"settings",
				"countryId",
			] as const;
			static hidden = ["email"] as const;
		}

		class Post extends orm.model("posts") {
			static softDeletes = true;
			static relations = {
				author: belongsTo(() => User, "userId"),
				authorOrDefault: withDefault(
					belongsTo(() => User, "userId"),
					{
						name: "Guest",
						email: "guest@example.com",
					},
				),
				comments: morphMany(() => Comment, "commentable"),
				tags: morphToMany(() => Tag, "taggable", {
					through: "taggables",
					foreignPivotKey: "taggableId",
					relatedPivotKey: "tagId",
				}),
			};
		}

		class Profile extends orm.model("profiles") {}

		class Comment extends orm.model("comments") {
			static relations = {
				commentable: morphTo("commentable", () => ({
					posts: Post,
					videos: Video,
				})),
			};
		}

		class Video extends orm.model("videos") {
			static relations = {
				comments: morphMany(() => Comment, "commentable"),
			};
		}

		class Tag extends orm.model("tags") {
			static relations = {
				posts: morphedByMany(() => Post, "taggable", {
					through: "taggables",
					foreignPivotKey: "tagId",
					relatedPivotKey: "taggableId",
				}),
			};
		}

		class Role extends orm.model("roles") {}

		/** Same table as Post, but its polymorphic rows store "article". */
		class RenamedPost extends orm.model("posts") {
			static morphAlias = "article";
			static relations = {
				tags: morphToMany(() => Tag, "taggable", {
					through: "taggables",
					foreignPivotKey: "taggableId",
					relatedPivotKey: "tagId",
				}),
			};
		}

		class BigRecord extends orm.model("bigRecords") {
			static fillable = ["value"] as const;
			static relations = {
				scores: hasMany(() => BigScore, "bigRecordId"),
			};
		}

		class BigScore extends orm.model("bigScores") {
			static fillable = ["bigRecordId", "amount"] as const;
		}

		/** Dedicated class so listeners/accessors never leak into other tests. */
		class AuditedUser extends orm.model("users") {
			static fillable = ["name", "email", "age", "settings"] as const;
			static casts = { settings: "json" } as const;
			static accessors = {
				displayName: (user: AuditedUser) =>
					`${user.get("name")} <${user.get("email")}>`,
			};
			static appends = ["displayName"] as const;
		}

		class Widget extends orm.model("priorityWidgets") {}

		/** Priority-2 pruning candidate (`prunable` constraint + chunked delete). */
		class ExpiredSession extends orm.model("prioritySessions") {
			static prunable = (query: unknown) => {
				(
					query as {
						where(column: string, operator: string, value: unknown): unknown;
					}
				).where("expiresAt", "<", new Date("2026-01-01T00:00:00Z"));
			};
		}

		/** Custom pivot model (`using`) with a parameterized date cast. */
		class Membership extends orm.pivot("role_user") {
			static override casts = {
				note: "string",
				createdAt: "date:Y-m-d",
			} as const;
		}

		class PivotUser extends orm.model("users") {
			static relations = {
				roles: belongsToMany(() => Role, {
					through: "role_user",
					foreignPivotKey: "userId",
					relatedPivotKey: "roleId",
					withPivot: ["note", "createdAt"],
					using: Membership,
				}),
			};
			static fillable = ["name", "email"] as const;
		}

		beforeAll(async () => {
			const ddl = orm.schemaBuilder();
			await ddl.dropIfExists("prioritySessions");
			await ddl.dropIfExists("priorityWidgets");
			await ddl.dropIfExists("taggables");
			await ddl.dropIfExists("role_user");
			await ddl.dropIfExists("roles");
			await ddl.dropIfExists("bigScores");
			await ddl.dropIfExists("bigRecords");
			await ddl.dropIfExists("tags");
			await ddl.dropIfExists("comments");
			await ddl.dropIfExists("videos");
			await ddl.dropIfExists("posts");
			await ddl.dropIfExists("profiles");
			await ddl.dropIfExists("countries");
			await ddl.dropIfExists("users");
			await ddl.create("countries", (t) => {
				t.id();
				t.string("name", 120);
			});
			await ddl.create("bigRecords", (t) => {
				t.id();
				t.bigint("value");
			});
			await ddl.create("bigScores", (t) => {
				t.id();
				t.bigint("bigRecordId");
				t.bigint("amount");
			});
			await ddl.create("users", (t) => {
				t.id();
				t.string("name", 120);
				t.string("email", 190).unique();
				t.integer("age").nullable();
				t.boolean("active").default(true);
				t.json("settings").nullable();
				t.json("scores").nullable();
				t.decimal("balance", 12, 2).nullable();
				t.integer("countryId").nullable();
				t.datetime("deletedAt").nullable();
				t.datetime("createdAt").nullable();
				t.datetime("updatedAt").nullable();
			});
			await ddl.create("posts", (t) => {
				t.id();
				t.integer("userId");
				t.string("title", 190);
				t.integer("views").default(0);
				t.datetime("deletedAt").nullable();
			});
			await ddl.create("profiles", (t) => {
				t.id();
				t.integer("userId");
				t.text("bio").nullable();
			});
			await ddl.create("comments", (t) => {
				t.id();
				t.string("body", 190);
				t.integer("commentableId");
				t.string("commentableType", 60);
			});
			await ddl.create("videos", (t) => {
				t.id();
				t.string("title", 190);
			});
			await ddl.create("tags", (t) => {
				t.id();
				t.string("name", 60);
			});
			await ddl.create("taggables", (t) => {
				t.integer("taggableId");
				t.string("taggableType", 60);
				t.integer("tagId");
			});
			await ddl.create("roles", (t) => {
				t.id();
				t.string("name", 60);
			});
			await ddl.create("role_user", (t) => {
				t.integer("userId");
				t.integer("roleId");
				t.string("note", 200).nullable();
				t.datetime("createdAt").nullable();
				t.datetime("updatedAt").nullable();
			});
			await ddl.create("priorityWidgets", (t) => {
				t.id();
				t.char("code", 12);
				t.unique("code", "p2_code_unique");
				t.tinyInteger("flags").unsigned().default(0);
				t.smallInteger("rank").unsigned().nullable();
				t.mediumInteger("size").unsigned().nullable();
				t.jsonb("payload").nullable();
				t.bigint("userId").nullable().references("users.id");
			});
			await ddl.create("prioritySessions", (t) => {
				t.id();
				t.string("token", 60);
				t.datetime("expiresAt");
			});
		});

		afterAll(async () => {
			await orm.destroy();
		});

		test("row path: insert returns the generated id, select round-trips", async () => {
			const inserted = await orm
				.table("users")
				.insert({ name: "Ada", email: "ada@example.com", age: 36 });
			expect(typeof inserted.id).toBe("number");
			const row = await orm
				.table("users")
				.where("email", "ada@example.com")
				.firstOrFail();
			expect(row.name).toBe("Ada");
			expect(row.active).toBe(true);
			expect(row.balance).toBeNull();
		});

		test("bigint columns preserve 64-bit precision", async () => {
			const maximum = 9223372036854775807n;
			const inserted = await orm.table("bigRecords").insert({ value: maximum });
			expect(inserted.id).toBe(1n);

			const row = await orm.table("bigRecords").firstOrFail();
			expect(row.id).toBe(1n);
			expect(row.value).toBe(maximum);

			const filtered = await orm
				.table("bigRecords")
				.where("value", "=", maximum)
				.firstOrFail();
			expect(filtered.id).toBe(1n);
			expect(await orm.table("bigRecords").max("value")).toBe(maximum);

			await orm.table("bigScores").insertMany([
				{ bigRecordId: 1n, amount: 9007199254740993n },
				{ bigRecordId: 1n, amount: 2n },
			]);
			const aggregate = await BigRecord.query()
				.withSum("scores", "amount")
				.withMin("scores", "amount")
				.withMax("scores", "amount")
				.withAvg("scores", "amount")
				.where("id", 1n)
				.firstOrFail();
			expect(aggregate.scoresSumAmount).toBe(9007199254740995n);
			expect(aggregate.scoresMinAmount).toBe(2n);
			expect(aggregate.scoresMaxAmount).toBe(9007199254740993n);
			expect(typeof aggregate.scoresAvgAmount).toBe("number");

			const loaded = await BigRecord.query()
				.with("scores")
				.where("id", 1n)
				.firstOrFail();
			expect(loaded.scores).toHaveLength(2);
			expect(
				loaded.scores.every((score) => score.get("bigRecordId") === 1n),
			).toBe(true);
			const filteredByRelation = await BigRecord.query()
				.whereHas("scores")
				.where("id", 1n)
				.firstOrFail();
			expect(filteredByRelation.get("id")).toBe(1n);

			const model = await BigRecord.create({ value: maximum - 1n });
			expect(model.get("id")).toBe(2n);
			expect(model.get("value")).toBe(maximum - 1n);
			const found = await BigRecord.find(2n);
			expect(found?.get("value")).toBe(maximum - 1n);

			if (orm.dialectKind === "mysql") {
				// mysql2 returns insert ids as strings when they exceed the safe
				// integer range; both write paths must preserve every bit.
				await orm.raw(
					"alter table `bigRecords` auto_increment = 9007199254740993",
				);
				const huge = await orm.table("bigRecords").insert({ value: 7n });
				expect(huge.id).toBe(9007199254740993n);

				const modelHuge = await BigRecord.create({ value: 8n });
				expect(modelHuge.get("id")).toBe(9007199254740994n);

				// Multi-row inserts shift the first id by each row offset.
				const manyHuge = await BigRecord.createMany([
					{ value: 9n },
					{ value: 10n },
				]);
				expect(manyHuge[0]?.get("id")).toBe(9007199254740995n);
				expect(manyHuge[1]?.get("id")).toBe(9007199254740996n);
			}
		});

		test("row path: filters, ordering, pagination and aggregates", async () => {
			await orm.table("users").insertMany([
				{ name: "Grace", email: "grace@example.com", age: 45 },
				{ name: "Alan", email: "alan@example.com", age: 41 },
				{ name: "Linus", email: "linus@example.com", age: 55 },
			]);
			const adults = await orm
				.table("users")
				.where("age", ">", 40)
				.orderBy("age", "desc")
				.limit(2)
				.get();
			expect(adults.map((user) => user.name).all()).toEqual(["Linus", "Grace"]);
			const count = await orm.table("users").where("age", ">", 40).count();
			expect(count).toBe(3);
			const page = await orm.table("users").orderBy("id").paginate(2, 2);
			expect(page.perPage).toBe(2);
			expect(page.data).toHaveLength(2);
			expect(page.total).toBe(4);
		});

		test("update and delete report affected rows", async () => {
			const updated = await orm
				.table("users")
				.where("email", "alan@example.com")
				.update({ age: 42 });
			expect(updated).toBe(1);
			const removed = await orm
				.table("users")
				.where("email", "linus@example.com")
				.delete();
			expect(removed).toBe(1);
		});

		test("upsert inserts, then updates on conflict", async () => {
			await orm
				.table("users")
				.upsert(
					{ name: "Original", email: "upsert@example.com" },
					{ conflictOn: "email", update: ["name"] },
				);
			await orm
				.table("users")
				.upsert(
					{ name: "Replaced", email: "upsert@example.com" },
					{ conflictOn: "email", update: ["name"] },
				);
			const row = await orm
				.table("users")
				.where("email", "upsert@example.com")
				.firstOrFail();
			expect(row.name).toBe("Replaced");
		});

		test("model path: create, casts, dirty tracking, save, refresh", async () => {
			const user = await User.create({
				name: "Model",
				email: "model@example.com",
				age: 20,
				settings: { theme: "dark" },
			});
			expect(user.get("id")).toBeDefined();
			expect(user.get("settings")).toEqual({ theme: "dark" });
			expect(user.isDirty()).toBe(false);
			user.set("age", 21);
			expect(user.getDirty()).toEqual({ age: 21 });
			await user.save();
			expect(user.isDirty()).toBe(false);
			const reloaded = await User.find(user.get("id") as number);
			expect(reloaded?.get("age")).toBe(21);
			expect(reloaded?.get("createdAt")).toBeInstanceOf(Date);
			await reloaded?.delete();
			expect(await User.find(user.get("id") as number)).toBeNull();
		});

		test("model path: fillable allow-list and hidden columns", async () => {
			const user = await User.create({
				name: "Hidden",
				email: "hidden@example.com",
			});
			const json = user.toJSON() as Record<string, unknown>;
			expect(json.email).toBeUndefined();
			expect(json.name).toBe("Hidden");
			await expect(
				User.create({
					name: "X",
					email: "x@example.com",
					role: "root",
				} as never),
			).rejects.toThrow();
		});

		test("relations: batched eager loading without N+1", async () => {
			const ada = await User.create({
				name: "Eager",
				email: "eager@example.com",
			});
			const id = ada.get("id") as number;
			await Post.create({ userId: id, title: "First", views: 10 });
			await Post.create({ userId: id, title: "Second", views: 5 });
			await Profile.create({ userId: id, bio: "hello" });

			const selects: string[] = [];
			const off = orm.onQuery((event) => {
				if (event.sql.trim().toLowerCase().startsWith("select")) {
					selects.push(event.sql);
				}
			});
			const loaded = await User.query()
				.with("posts", "posts.author", "profile")
				.where("id", id)
				.firstOrFail();
			off();

			expect(
				loaded.posts
					.map((post) => post.get("title"))
					.sort()
					.all(),
			).toEqual(["First", "Second"]);
			expect(
				loaded.posts.every((post) => post.author?.get("name") === "Eager"),
			).toBe(true);
			expect(loaded.profile?.get("bio")).toBe("hello");
			// users + posts + posts.author + profile — never one query per row
			expect(selects).toHaveLength(4);
		});

		test("transactions: commit, rollback and savepoints", async () => {
			await orm.transaction(async (tx) => {
				await tx
					.table("users")
					.insert({ name: "Committed", email: "committed@example.com" });
			});
			expect(
				await orm
					.table("users")
					.where("email", "committed@example.com")
					.count(),
			).toBe(1);

			await expect(
				orm.transaction(async (tx) => {
					await tx
						.table("users")
						.insert({ name: "Rolled back", email: "rolled-back@example.com" });
					throw new Error("boom");
				}),
			).rejects.toThrow("boom");
			expect(
				await orm
					.table("users")
					.where("email", "rolled-back@example.com")
					.count(),
			).toBe(0);

			await orm.transaction(async (tx) => {
				await tx
					.table("users")
					.insert({ name: "Outer", email: "sp-outer@example.com" });
				// Nested calls become savepoints on the ambient transaction.
				await orm
					.transaction(async () => {
						await orm
							.table("users")
							.insert({ name: "Inner", email: "sp-inner@example.com" });
						throw new Error("inner");
					})
					.catch(() => undefined);
			});
			expect(
				await orm.table("users").where("email", "sp-outer@example.com").count(),
			).toBe(1);
			expect(
				await orm.table("users").where("email", "sp-inner@example.com").count(),
			).toBe(0);
		});

		test("migrations: migrate books one batch, rollback reverses it", async () => {
			const migrator = new Migrator(orm, {
				table: "barq_dialect_migrations",
				migrations: [
					{
						name: "001_create_widgets",
						async up({ schema: ddl }) {
							await ddl.create("widgets", (t) => {
								t.id();
								t.string("label", 60);
							});
						},
						async down({ schema: ddl }) {
							await ddl.dropIfExists("widgets");
						},
					},
				],
			});
			const applied = await migrator.migrate();
			expect(applied.applied).toEqual(["001_create_widgets"]);
			expect(await orm.schemaBuilder().hasTable("widgets")).toBe(true);
			const rolledBack = await migrator.rollback();
			expect(rolledBack).toEqual(["001_create_widgets"]);
			expect(await orm.schemaBuilder().hasTable("widgets")).toBe(false);
		});

		test("unique violations are translated to UniqueConstraintError", async () => {
			await orm
				.table("users")
				.insert({ name: "Solo", email: "solo@example.com" });
			await expect(
				orm.table("users").insert({ name: "Clone", email: "solo@example.com" }),
			).rejects.toThrow(UniqueConstraintError);
		});

		test("raw SQL with bindings round-trips", async () => {
			const result = await orm.raw(
				`select count(*) as total from users where age >= ${options.placeholder(1)}`,
				[40],
			);
			expect(
				Number((result.rows[0] as { total: unknown }).total),
			).toBeGreaterThan(0);
		});

		// -------------------------------------------------------------------
		// Eloquent parity — the same behaviors SQLite asserts in detail.
		// -------------------------------------------------------------------

		test("increment/decrement and firstOrCreate/updateOrCreate", async () => {
			const created = await User.firstOrCreate(
				{ email: "parity-first@example.com" },
				{ name: "Parity", age: 10 },
			);
			const existing = await User.firstOrCreate(
				{ email: "parity-first@example.com" },
				{ name: "Ignored", age: 99 },
			);
			expect(existing.get("id")).toBe(created.get("id"));
			expect(existing.get("name")).toBe("Parity");

			const updated = await User.updateOrCreate(
				{ email: "parity-first@example.com" },
				{ age: 12 },
			);
			expect(updated.get("age")).toBe(12);

			const id = created.get("id") as number;
			expect(await orm.table("users").where("id", id).increment("age", 3)).toBe(
				1,
			);
			expect((await orm.table("users").where("id", id).firstOrFail()).age).toBe(
				15,
			);
			expect(await orm.table("users").where("id", id).decrement("age", 5)).toBe(
				1,
			);
			expect((await orm.table("users").where("id", id).firstOrFail()).age).toBe(
				10,
			);

			const user = await User.findOrFail(id);
			const originalName = user.getOriginal("name");
			user.set("name", "Renamed");
			expect(user.getOriginal("name")).toBe(originalName);
			expect(user.getDirty()).toEqual({ name: "Renamed" });
			await user.save();
			expect((await User.findOrFail(id)).get("name")).toBe("Renamed");
		});

		test("aggregates and constrained eager loading", async () => {
			const owner = await User.create({
				name: "Aggregates",
				email: "aggregates@example.com",
			});
			const id = owner.get("id") as number;
			await Post.createMany([
				{ userId: id, title: "Low", views: 2 },
				{ userId: id, title: "Mid", views: 3 },
				{ userId: id, title: "High", views: 5 },
			]);

			const row = await User.query()
				.withSum("posts", "views")
				.withAvg("posts", "views")
				.withMin("posts", "views")
				.withMax("posts", "views")
				.withCount("posts as postCount")
				.where("id", id)
				.firstOrFail();
			expect(row.postsSumViews).toBe(10);
			expect(row.postsAvgViews).toBeCloseTo(10 / 3);
			expect(row.postsMinViews).toBe(2);
			expect(row.postsMaxViews).toBe(5);
			expect(row.postCount).toBe(3);

			const owned = Post.query().where("userId", id);
			expect(await owned.clone().sum("views")).toBe(10);
			expect(await owned.clone().avg("views")).toBeCloseTo(10 / 3);
			expect(await owned.clone().min("views")).toBe(2);
			expect(await owned.clone().max("views")).toBe(5);

			const constrained = await User.query()
				.with({
					posts: (query) =>
						query.where("views", ">=", 3).orderBy("views", "desc"),
				})
				.where("id", id)
				.firstOrFail();
			expect(constrained.posts.map((post) => post.get("title")).all()).toEqual([
				"High",
				"Mid",
			]);
			expect(
				await User.query().whereDoesntHave("posts").where("id", id).count(),
			).toBe(0);
		});

		test("events, observers and accessors", async () => {
			const seen: string[] = [];
			const offCreating = AuditedUser.on("creating", () => {
				seen.push("creating");
			});
			const offObserver = AuditedUser.observe({
				created: () => {
					seen.push("created");
				},
				updated: () => {
					seen.push("updated");
				},
			});
			try {
				const user = await AuditedUser.create({
					name: "Evented",
					email: "evented@example.com",
					age: 1,
					settings: { theme: "dark" },
				});
				expect(seen).toEqual(["creating", "created"]);
				expect(user.displayName).toBe("Evented <evented@example.com>");
				expect((user.toJSON() as Record<string, unknown>).displayName).toBe(
					"Evented <evented@example.com>",
				);
				expect(user.get("settings")).toEqual({ theme: "dark" });

				user.set("age", 2);
				await user.save();
				expect(seen).toContain("updated");
			} finally {
				offCreating();
				offObserver();
			}
		});

		test("soft deletes: scopes, restore and force delete", async () => {
			const owner = await User.create({
				name: "Soft",
				email: "soft@example.com",
			});
			const post = await Post.create({
				userId: owner.get("id") as number,
				title: "Disposable",
			});
			const id = post.get("id") as number;

			expect(await post.delete()).toBe(true);
			expect(post.trashed()).toBe(true);
			expect(await Post.find(id)).toBeNull();
			expect(
				(await Post.withTrashed().where("id", id).firstOrFail()).trashed(),
			).toBe(true);
			expect(await Post.onlyTrashed().where("id", id).count()).toBe(1);

			expect(await Post.withTrashed().where("id", id).restore()).toBe(1);
			expect((await Post.find(id))?.trashed()).toBe(false);
			expect(await Post.query().where("id", id).forceDelete()).toBe(1);
			expect(await Post.withTrashed().where("id", id).count()).toBe(0);
		});

		test("hasManyThrough batches and filters across the pivot", async () => {
			const country = await orm
				.table("countries")
				.insert({ name: "Dialect Egypt" });
			const countryId = country.id as number;
			const user = await User.create({
				name: "Through",
				email: "through@example.com",
				countryId,
			});
			await Post.createMany([
				{ userId: user.get("id") as number, title: "First", views: 9 },
				{ userId: user.get("id") as number, title: "Second", views: 1 },
			]);

			const loaded = await Country.query()
				.with("posts")
				.withCount("posts")
				.where("id", countryId)
				.firstOrFail();
			expect(
				loaded.posts
					.map((post) => post.get("title"))
					.sort()
					.all(),
			).toEqual(["First", "Second"]);
			expect(loaded.postsCount).toBe(2);

			const filtered = await Country.query()
				.whereHas("posts", (group) => group.where("views", ">", 5))
				.where("id", countryId)
				.get();
			expect(filtered).toHaveLength(1);
		});

		test("polymorphic relations and morph-to-many pivots", async () => {
			const user = await User.create({
				name: "Morph",
				email: "morph@example.com",
			});
			const userId = user.get("id") as number;
			const post = await Post.create({ userId, title: "Morph post" });
			const postId = post.get("id") as number;
			const video = await Video.create({ title: "Morph video" });
			const videoId = video.get("id") as number;

			await Comment.create({
				body: "post comment",
				commentableId: postId,
				commentableType: "posts",
			});
			await Comment.create({
				body: "video comment",
				commentableId: videoId,
				commentableType: "videos",
			});

			const loadedPost = await Post.query()
				.with("comments")
				.where("id", postId)
				.firstOrFail();
			expect(
				loadedPost.comments.map((comment) => comment.get("body")).all(),
			).toEqual(["post comment"]);

			const comments = await Comment.query()
				.with("commentable")
				.orderBy("id")
				.get();
			expect(
				comments
					.map((comment) =>
						comment.commentable instanceof Post
							? "post"
							: comment.commentable instanceof Video
								? "video"
								: "null",
					)
					.all(),
			).toEqual(["post", "video"]);

			const tag = await Tag.create({ name: "dialect-ts" });
			const tagId = tag.get("id") as number;
			await orm.table("taggables").insert([
				{ taggableId: postId, taggableType: "posts", tagId },
				{ taggableId: userId, taggableType: "users", tagId },
			]);

			const taggedPost = await Post.query()
				.with("tags")
				.withCount("tags")
				.where("id", postId)
				.firstOrFail();
			expect(taggedPost.tags.map((item) => item.get("name")).all()).toEqual([
				"dialect-ts",
			]);
			expect(taggedPost.tagsCount).toBe(1);

			const taggedUser = await User.query()
				.with("tags")
				.where("id", userId)
				.firstOrFail();
			expect(taggedUser.tags.map((item) => item.get("name")).all()).toEqual([
				"dialect-ts",
			]);
		});

		test("pivot parity: named accessor, extra columns, timestamps and constraints", async () => {
			const user = await User.create({
				name: "Pivot",
				email: "pivot@example.com",
			});
			const userId = user.get("id") as number;
			const admin = await Role.create({ name: "dialect-admin" });
			const editor = await Role.create({ name: "dialect-editor" });
			const adminId = admin.get("id") as number;
			const editorId = editor.get("id") as number;

			expect(
				await user.relation("roles").attach(adminId, { note: "primary" }),
			).toBe(1);
			expect(
				await user.relation("roles").attach(editorId, { note: "side" }),
			).toBe(1);

			const pivotRows = await orm
				.table("role_user")
				.where("userId", userId)
				.orderBy("roleId")
				.get();
			expect(pivotRows.map((row) => row.note).all()).toEqual([
				"primary",
				"side",
			]);
			expect(pivotRows[0]?.createdAt).not.toBeNull();
			expect(pivotRows[0]?.updatedAt).not.toBeNull();

			const loaded = await User.query()
				.with("roles")
				.where("id", userId)
				.firstOrFail();
			const memberships = loaded.roles.map((role) => role.membership).all();
			expect(memberships.map((membership) => membership?.note).sort()).toEqual([
				"primary",
				"side",
			]);
			expect(memberships[0]?.createdAt).toBeDefined();
			const firstRole = loaded.roles.first() as object;
			expect(Object.hasOwn(firstRole, "membership")).toBe(true);
			expect(Object.hasOwn(firstRole, "pivot")).toBe(false);

			const primaryOnly = await user
				.relation("roles")
				.wherePivot("note", "primary")
				.query()
				.get();
			expect(primaryOnly.map((role) => role.get("name")).all()).toEqual([
				"dialect-admin",
			]);
			const sideOnly = await user
				.relation("roles")
				.wherePivotIn("note", ["side"])
				.query()
				.get();
			expect(sideOnly.map((role) => role.get("name")).all()).toEqual([
				"dialect-editor",
			]);
			const ordered = await user
				.relation("roles")
				.orderByPivot("note", "desc")
				.query()
				.get();
			expect(ordered.map((role) => role.get("name")).all()).toEqual([
				"dialect-editor",
				"dialect-admin",
			]);

			// `updatedAt` refreshes on updateExistingPivot; DATETIME columns may
			// truncate to seconds, so wait out one tick before comparing.
			await Bun.sleep(1100);
			expect(
				await user
					.relation("roles")
					.updateExistingPivot(editorId, { note: "side+" }),
			).toBe(1);
			const updatedRows = await orm
				.table("role_user")
				.where("userId", userId)
				.where("roleId", editorId)
				.get();
			expect(updatedRows[0]?.note).toBe("side+");
			expect(
				new Date(String(updatedRows[0]?.updatedAt)).getTime(),
			).toBeGreaterThan(new Date(String(pivotRows[1]?.updatedAt)).getTime());
		});

		test("one-of-many extremes and default owners round-trip", async () => {
			const user = await User.create({
				name: "Extreme",
				email: "extreme@example.com",
			});
			const userId = user.get("id") as number;
			await Post.createMany([
				{ userId, title: "Low", views: 1 },
				{ userId, title: "High", views: 50 },
				{ userId, title: "Mid", views: 20 },
			]);

			const loaded = await User.query()
				.with("latestPost")
				.where("id", userId)
				.firstOrFail();
			expect(loaded.latestPost?.get("title")).toBe("High");

			const scoped = await User.query()
				.whereHas("latestPost", (group) => group.where("views", ">", 30))
				.where("id", userId)
				.get();
			expect(scoped).toHaveLength(1);

			const viaManager = await user.relation("latestPost").query().first();
			expect(viaManager?.get("title")).toBe("High");

			const orphan = await Post.create({
				userId: 987_654,
				title: "Orphan",
				views: 0,
			});
			const orphanId = orphan.get("id") as number;
			const plain = await Post.query()
				.with("author")
				.where("id", orphanId)
				.firstOrFail();
			expect(plain.author).toBeNull();
			const defaulted = await Post.query()
				.with("authorOrDefault")
				.where("id", orphanId)
				.firstOrFail();
			expect(defaulted.authorOrDefault?.get("name")).toBe("Guest");
		});

		test("morphedByMany and non-table morph aliases round-trip", async () => {
			const post = await Post.create({ userId: 0, title: "Inverse" });
			const postId = post.get("id") as number;
			const tag = await Tag.create({ name: "dialect-inverse" });
			const tagId = tag.get("id") as number;
			expect(await post.relation("tags").attach(tagId)).toBe(1);

			// Inverse direction: `morphedByMany` filters by the related class's
			// alias, so the same pivot rows are visible from Tag.
			const loadedTag = await Tag.query()
				.with("posts")
				.where("id", tagId)
				.firstOrFail();
			expect(loadedTag.posts.map((item) => item.get("id")).all()).toEqual([
				postId,
			]);
			expect(loadedTag.posts.first()?.pivot.tagId).toBe(tagId);

			// A class-level alias that differs from the table name flows through
			// writes, eager loads and existence subqueries.
			const aliased = await RenamedPost.create({
				userId: 0,
				title: "Aliased",
			});
			const aliasedId = aliased.get("id") as number;
			expect(await aliased.relation("tags").attach(tagId)).toBe(1);

			const rows = await orm.table("taggables").where("tagId", tagId).get();
			expect(
				rows
					.map((row) => row.taggableType)
					.sort()
					.all(),
			).toEqual(["article", "posts"]);

			const aliasedLoaded = await RenamedPost.query()
				.with("tags")
				.where("id", aliasedId)
				.firstOrFail();
			expect(aliasedLoaded.tags.map((item) => item.get("name")).all()).toEqual([
				"dialect-inverse",
			]);
			expect(aliasedLoaded.tags.first()?.pivot.taggableType).toBe("article");

			const matched = await Tag.query().whereHas("posts").get();
			expect(matched.map((item) => item.get("id")).all()).toContain(tagId);
		});

		// -------------------------------------------------------------------
		// Priority 2: casts, schema extras, pruning, factories, JSON extras,
		// morph/attached constraints and custom pivots on live servers.
		// -------------------------------------------------------------------

		describe("priority 2 parity", () => {
			const place = (position: number): string => options.placeholder(position);

			async function columnNames(table: string): Promise<string[]> {
				if (orm.dialectKind === "sqlite") {
					const result = await orm.raw(`pragma table_info('${table}')`);
					return result.rows.map((row) => String(row.name));
				}
				const sql =
					orm.dialectKind === "mysql"
						? `select column_name as name from information_schema.columns where table_schema = database() and table_name = ${place(1)} order by ordinal_position`
						: `select column_name as name from information_schema.columns where table_schema = current_schema() and table_name = ${place(1)} order by ordinal_position`;
				const result = await orm.raw(sql, [table]);
				return result.rows.map((row) => String(row.name));
			}

			async function foreignKeyNames(
				table: string,
				referenced: string,
			): Promise<string[]> {
				if (orm.dialectKind === "sqlite") {
					const result = await orm.raw(`pragma foreign_key_list('${table}')`);
					return result.rows
						.filter((row) => String(row.table) === referenced)
						.map((row) => String(row.id));
				}
				const sql =
					orm.dialectKind === "mysql"
						? `select constraint_name as name from information_schema.key_column_usage where table_schema = database() and table_name = ${place(1)} and referenced_table_name = ${place(2)}`
						: `select c.conname as name from pg_constraint c join pg_class t on t.oid = c.conrelid join pg_namespace n on n.oid = t.relnamespace join pg_class r on r.oid = c.confrelid where n.nspname = current_schema() and t.relname = ${place(1)} and r.relname = ${place(2)} and c.contype = 'f'`;
				const result = await orm.raw(sql, [table, referenced]);
				return result.rows.map((row) => String(row.name));
			}

			test("blueprint extras: char, sized ints, jsonb, unsigned and foreign keys", async () => {
				const inserted = await orm.table("priorityWidgets").insert({
					code: "abc-123",
					flags: 1,
					rank: 5,
					size: 1000,
					payload: JSON.stringify({ nested: [1, 2] }),
				});
				expect(typeof inserted.id).toBe("number");
				const row = await orm
					.table("priorityWidgets")
					.where("code", "abc-123")
					.firstOrFail();
				expect(String(row.code).trim()).toBe("abc-123");
				expect(Number(row.flags)).toBe(1);
				expect(Number(row.rank)).toBe(5);
				expect(Number(row.size)).toBe(1000);
				const payload =
					typeof row.payload === "string"
						? JSON.parse(row.payload)
						: row.payload;
				expect(payload).toEqual({ nested: [1, 2] });

				// The unique index on `code` is live on both engines.
				await expect(
					orm.table("priorityWidgets").insert({ code: "abc-123" }),
				).rejects.toThrow(UniqueConstraintError);
			});

			test("alter: add/rename/drop columns, dropUnique, dropForeign", async () => {
				const ddl = orm.schemaBuilder();
				await ddl.alter("priorityWidgets", (t) => {
					t.string("extra", 40).nullable();
				});
				expect(await columnNames("priorityWidgets")).toContain("extra");

				await ddl.alter("priorityWidgets", (t) => {
					t.renameColumn("extra", "renamed");
				});
				const renamed = await columnNames("priorityWidgets");
				expect(renamed).toContain("renamed");
				expect(renamed).not.toContain("extra");

				await ddl.alter("priorityWidgets", (t) => {
					t.dropColumn(["renamed"]);
				});
				expect(await columnNames("priorityWidgets")).not.toContain("renamed");

				// dropUnique works on every dialect; on SQLite the named
				// unique index is dropped directly.
				await ddl.alter("priorityWidgets", (t) => {
					t.dropUnique("p2_code_unique");
				});
				const duplicate = await orm
					.table("priorityWidgets")
					.insert({ code: "abc-123", flags: 2 });
				expect(typeof duplicate.id).toBe("number");

				const names = await foreignKeyNames("priorityWidgets", "users");
				expect(names.length).toBe(1);
				// dropForeign removes the constraint, so orphan values become
				// acceptable. SQLite rebuilds the table to do it.
				await expect(
					orm
						.table("priorityWidgets")
						.insert({ code: "fk-before", userId: 987654321 }),
				).rejects.toThrow();
				await ddl.alter("priorityWidgets", (t) => {
					t.dropForeign("priorityWidgets_userId_foreign");
				});
				const orphan = await orm
					.table("priorityWidgets")
					.insert({ code: "fk-after", userId: 987654321 });
				expect(typeof orphan.id).toBe("number");
				expect(await foreignKeyNames("priorityWidgets", "users")).toEqual([]);
			});

			test("json extras: paths, keys, length and overlaps", async () => {
				await orm.table("users").insertMany([
					{
						name: "p2-json-a",
						email: "p2-json-a@example.com",
						settings: JSON.stringify({
							tags: ["vip", "beta"],
							profile: { tier: "gold" },
						}),
						scores: JSON.stringify(["vip", "beta"]),
					},
					{
						name: "p2-json-b",
						email: "p2-json-b@example.com",
						settings: JSON.stringify({
							tags: ["basic"],
							profile: { tier: "silver" },
						}),
					},
					{
						name: "p2-json-c",
						email: "p2-json-c@example.com",
						settings: JSON.stringify({ color: "red", vip: true }),
					},
				]);

				const byElement = await orm
					.table("users")
					.whereJsonContains("settings", "vip", "$.tags")
					.where("name", "=", "p2-json-a")
					.get();
				expect(byElement.count()).toBe(1);

				const byObject = await orm
					.table("users")
					.whereJsonContains("settings", { tier: "gold" }, "$.profile")
					.where("name", "=", "p2-json-a")
					.get();
				expect(byObject.count()).toBe(1);

				const withKey = await orm
					.table("users")
					.whereJsonContainsKey("settings", "$.profile.tier")
					.where("email", "like", "p2-json-%")
					.get();
				expect(withKey.count()).toBe(2);

				const withoutKey = await orm
					.table("users")
					.whereJsonDoesntContainKey("settings", "$.profile.tier")
					.where("email", "like", "p2-json-%")
					.get();
				expect(withoutKey.count()).toBe(1);
				expect(withoutKey.first()?.name).toBe("p2-json-c");

				const byLength = await orm
					.table("users")
					.whereJsonLength("settings", ">=", 2, "$.tags")
					.where("email", "like", "p2-json-%")
					.get();
				expect(byLength.count()).toBe(1);
				expect(byLength.first()?.name).toBe("p2-json-a");

				// `whereJsonOverlaps` follows MySQL's `JSON_OVERLAPS`
				// semantics on every dialect: shared key/value pair here.
				const overlaps = await orm
					.table("users")
					.whereJsonOverlaps("settings", { vip: true })
					.where("email", "like", "p2-json-%")
					.get();
				expect(overlaps.count()).toBe(1);
				expect(overlaps.first()?.name).toBe("p2-json-c");

				// Shared pair by exact value (arrays compare structurally).
				const sharedPair = await orm
					.table("users")
					.whereJsonOverlaps("settings", { tags: ["vip", "beta"] })
					.where("email", "like", "p2-json-%")
					.get();
				expect(sharedPair.count()).toBe(1);
				expect(sharedPair.first()?.name).toBe("p2-json-a");

				// Elements of an array column overlap element-wise, so a
				// partial (non-contained) overlap still matches.
				const partial = await orm
					.table("users")
					.whereJsonOverlaps("scores", ["vip", "missing"])
					.where("email", "like", "p2-json-%")
					.get();
				expect(partial.count()).toBe(1);
				expect(partial.first()?.name).toBe("p2-json-a");

				const noOverlap = await orm
					.table("users")
					.whereJsonOverlaps("settings", { vip: false })
					.where("email", "like", "p2-json-%")
					.get();
				expect(noOverlap.count()).toBe(0);
			});

			test("whereMorphedTo / whereAttachedTo follow every relation kind", async () => {
				const owner = await User.create({
					name: "p2-morph-owner",
					email: "p2-morph-owner@example.com",
				});
				const ownerId = owner.get("id") as number;
				const post = await Post.create({
					userId: ownerId,
					title: "p2 morph post",
				});
				const postId = post.get("id") as number;
				await Comment.create({
					body: "p2 comment post",
					commentableId: postId,
					commentableType: "posts",
				});
				await Comment.create({
					body: "p2 comment user",
					commentableId: ownerId,
					commentableType: "users",
				});

				const byInstance = await Comment.query()
					.where("body", "like", "p2 comment%")
					.whereMorphedTo("commentable", post)
					.get();
				expect(byInstance.map((c) => c.get("body")).all()).toEqual([
					"p2 comment post",
				]);

				const byClass = await Comment.query()
					.where("body", "like", "p2 comment%")
					.whereMorphedTo("commentable", Post)
					.get();
				expect(byClass.map((c) => c.get("body")).all()).toEqual([
					"p2 comment post",
				]);

				const byAlias = await Comment.query()
					.where("body", "like", "p2 comment%")
					.whereMorphedTo("commentable", "users")
					.get();
				expect(byAlias.map((c) => c.get("body")).all()).toEqual([
					"p2 comment user",
				]);

				const complement = await Comment.query()
					.where("body", "like", "p2 comment%")
					.whereNotMorphedTo("commentable", post)
					.get();
				expect(complement.map((c) => c.get("body")).all()).toEqual([
					"p2 comment user",
				]);

				// belongsTo: Post -> User
				const ownerPosts = await Post.query().whereAttachedTo(owner).get();
				expect(ownerPosts.map((p) => p.get("id")).all()).toEqual([postId]);

				// hasMany: User -> Post
				const postOwners = await User.query().whereAttachedTo(post).get();
				expect(postOwners.map((u) => u.get("id")).all()).toEqual([ownerId]);

				// morphTo: Comment -> Post
				const comments = await Comment.query()
					.where("body", "like", "p2 comment%")
					.whereAttachedTo(post)
					.get();
				expect(comments.map((c) => c.get("body")).all()).toEqual([
					"p2 comment post",
				]);

				// belongsToMany: User -> Role through the pivot table
				const role = await Role.create({ name: "p2-morph-role" });
				const roleId = role.get("id") as number;
				await owner.relation("roles").attach(roleId, { note: "p2" });
				const roleHolders = await User.query().whereAttachedTo(role).get();
				expect(roleHolders.map((u) => u.get("id")).all()).toContain(ownerId);
				const strangers = await User.query().whereNotAttachedTo(role).get();
				expect(strangers.map((u) => u.get("id")).all()).not.toContain(ownerId);
			});

			test("custom pivot models apply casts on attach and eager loads", async () => {
				const user = await PivotUser.create({
					name: "p2-pivot",
					email: "p2-pivot@example.com",
				});
				const userId = user.get("id") as number;
				const role = await Role.create({ name: "p2-pivot-role" });
				const roleId = role.get("id") as number;
				await user.relation("roles").attach(roleId, {
					note: "p2-note",
					createdAt: new Date(2026, 3, 1),
				});

				// `date:Y-m-d` formatted the Date before it reached the engine.
				const selectFormatted =
					orm.dialectKind === "mysql"
						? `select date_format(\`createdAt\`, '%Y-%m-%d') as formatted from role_user where \`userId\` = ${place(1)} and \`roleId\` = ${place(2)}`
						: orm.dialectKind === "postgres"
							? `select to_char("createdAt", 'YYYY-MM-DD') as formatted from role_user where "userId" = ${place(1)} and "roleId" = ${place(2)}`
							: `select strftime('%Y-%m-%d', "createdAt") as formatted from role_user where "userId" = ${place(1)} and "roleId" = ${place(2)}`;
				const raw = await orm.raw(selectFormatted, [userId, roleId]);
				expect(String(raw.rows[0]?.formatted)).toBe("2026-04-01");

				const loaded = await PivotUser.query()
					.with("roles")
					.where("id", userId)
					.firstOrFail();
				const pivot = loaded.roles.first()?.pivot as Membership;
				expect(pivot).toBeInstanceOf(Membership);
				expect(pivot.get("note")).toBe("p2-note");
				expect(pivot.get("createdAt")).toBe("2026-04-01");
			});

			test("factories, seeders and pruning", async () => {
				const created = await User.factory()
					.define({
						email: (index) => `p2-factory${index}@example.com`,
						name: (index) => `P2 Factory ${index}`,
					})
					.count(2)
					.create({ age: 20 });
				expect(created.count()).toBe(2);
				expect(created.all().every((user) => user.get("age") === 20)).toBe(
					true,
				);
				expect(
					await orm
						.table("users")
						.where("email", "like", "p2-factory%@example.com")
						.count(),
				).toBe(2);

				let seeded = 0;
				await runSeeders(orm, [
					async () => {
						seeded += 1;
						await orm.table("countries").insert({ name: "p2-seeded" });
					},
					{
						run: async () => {
							seeded += 1;
						},
					},
				]);
				expect(seeded).toBe(2);

				await orm.table("prioritySessions").insert([
					{ token: "p2-a", expiresAt: new Date("2025-01-01T00:00:00Z") },
					{ token: "p2-b", expiresAt: new Date("2025-06-01T00:00:00Z") },
					{ token: "p2-c", expiresAt: new Date("2027-01-01T00:00:00Z") },
				]);
				const deleted = await ExpiredSession.prune(2);
				expect(deleted).toBe(2);
				expect(await ExpiredSession.query().count()).toBe(1);
			});

			test("migrator: pretend, migrate, reset and refresh", async () => {
				const ddl = orm.schemaBuilder();
				await ddl.dropIfExists("p2_things");
				await ddl.dropIfExists("p2_migrations");
				const migrator = new Migrator(orm, {
					table: "p2_migrations",
					migrations: [
						{
							name: "0001_create_p2_things",
							async up({
								schema: schemaBuilder,
							}: MigrationContext<typeof schema>) {
								await schemaBuilder.create("p2_things", (t) => {
									t.id();
									t.string("name", 60);
								});
							},
							async down({
								schema: schemaBuilder,
							}: MigrationContext<typeof schema>) {
								await schemaBuilder.drop("p2_things");
							},
						},
					],
				});

				const plan = await migrator.pretend();
				expect(plan.map((entry) => entry.migration)).toEqual([
					"0001_create_p2_things",
				]);
				expect(plan[0]?.statements.join(" ")).toContain("p2_things");
				const applied = await migrator.migrate();
				expect(applied.applied).toEqual(["0001_create_p2_things"]);
				expect(await ddl.hasTable("p2_things")).toBe(true);
				expect(await migrator.pretend()).toEqual([]);
				expect(await migrator.reset()).toEqual(["0001_create_p2_things"]);
				expect(await ddl.hasTable("p2_things")).toBe(false);
				const refreshed = await migrator.refresh();
				expect(refreshed.applied).toEqual(["0001_create_p2_things"]);
				expect(await ddl.hasTable("p2_things")).toBe(true);
			});

			test("one-of-many predicates match exactly one tied row", async () => {
				const owner = await User.create({
					name: "p3-ties",
					email: "p3-ties@example.com",
				});
				const ownerId = owner.get("id");
				await Post.create({
					userId: ownerId,
					title: "p3-tie-a",
					views: 42,
				});
				await Post.create({
					userId: ownerId,
					title: "p3-tie-b",
					views: 42,
				});

				expect(
					(
						await User.query().where("id", ownerId).whereHas("latestPost").get()
					).count(),
				).toBe(1);
				const counted = await User.query()
					.where("id", ownerId)
					.withCount("latestPost")
					.withSum("latestPost", "views")
					.get();
				const row = counted.first() as unknown as {
					latestPostCount: number;
					latestPostSumViews: number;
				};
				expect(row.latestPostCount).toBe(1);
				expect(Number(row.latestPostSumViews)).toBe(42);
				const manager = await owner.relation("latestPost").query().get();
				expect(manager.count()).toBe(1);
				expect(manager.first()?.get("title")).toBe("p3-tie-b");
			});

			test("pivot events fire on the parent model and gates cancel", async () => {
				const owner = await User.create({
					name: "p3-pivot-events",
					email: "p3-pivot-events@example.com",
				});
				const role = await orm.table("roles").insert({ name: "p3-role" });
				const roleId = (role as { id: unknown }).id;

				const events: string[] = [];
				const offs = [
					User.onPivot("pivotAttaching", (payload) => {
						events.push(
							`attaching:${payload.relation}:${(payload.ids ?? []).length}`,
						);
					}),
					User.onPivot("pivotAttached", (payload) => {
						events.push(`attached:${payload.relation}`);
					}),
					User.onPivot("pivotUpdating", () => {
						events.push("updating");
					}),
					User.onPivot("pivotUpdated", () => {
						events.push("updated");
					}),
					User.onPivot("pivotDetaching", () => {
						events.push("detaching");
					}),
					User.onPivot("pivotDetached", () => {
						events.push("detached");
					}),
				];
				try {
					expect(
						await owner.relation("roles").attach(roleId, { note: "first" }),
					).toBe(1);
					await owner
						.relation("roles")
						.updateExistingPivot(roleId, { note: "second" });
					expect(await owner.relation("roles").detach(roleId)).toBe(1);
				} finally {
					for (const off of offs) off();
				}
				expect(events).toEqual([
					"attaching:roles:1",
					"attached:roles",
					"updating",
					"updated",
					"detaching",
					"detached",
				]);

				// Returning `false` from a gate event cancels the write.
				const gate = User.onPivot("pivotAttaching", () => false);
				try {
					expect(await owner.relation("roles").attach(roleId)).toBe(0);
				} finally {
					gate();
				}
				expect(await owner.relation("roles").query().count()).toBe(0);
			});

			test("cursor pagination walks forwards and backwards over many columns", async () => {
				await orm.table("priorityWidgets").insertMany(
					[1, 2, 3, 4, 5].map((index) => ({
						code: `p3-cursor-0${index}`,
						flags: index,
						rank: index,
						size: index * 10,
					})),
				);
				const base = () =>
					orm.table("priorityWidgets").where("code", "like", "p3-cursor-%");
				const order = [
					{ column: "rank" as const },
					{ column: "code" as const },
				];

				const first = await base().cursorPaginate(2, { order });
				expect(first.data.map((row) => String(row.code)).all()).toEqual([
					"p3-cursor-01",
					"p3-cursor-02",
				]);
				expect(first.hasMore).toBe(true);
				expect(first.hasPrevious).toBe(false);
				expect(first.prevCursor).toBeNull();

				const second = await base().cursorPaginate(2, {
					order,
					cursor: first.nextCursor,
				});
				expect(second.data.map((row) => String(row.code)).all()).toEqual([
					"p3-cursor-03",
					"p3-cursor-04",
				]);
				expect(second.hasPrevious).toBe(true);

				const third = await base().cursorPaginate(2, {
					order,
					cursor: second.nextCursor,
				});
				expect(third.data.map((row) => String(row.code)).all()).toEqual([
					"p3-cursor-05",
				]);
				expect(third.hasMore).toBe(false);
				expect(third.nextCursor).toBeNull();

				// `prevCursor` walks back to the page we came from.
				const back = await base().cursorPaginate(2, {
					order,
					cursor: second.prevCursor,
				});
				expect(back.data.map((row) => String(row.code)).all()).toEqual([
					"p3-cursor-01",
					"p3-cursor-02",
				]);
				expect(back.hasPrevious).toBe(false);

				// Single descending column keeps working.
				const desc = await base().cursorPaginate(2, {
					column: "rank",
					direction: "desc",
				});
				expect(desc.data.map((row) => Number(row.rank)).all()).toEqual([5, 4]);
				const descNext = await base().cursorPaginate(2, {
					column: "rank",
					direction: "desc",
					cursor: desc.nextCursor,
				});
				expect(descNext.data.map((row) => Number(row.rank)).all()).toEqual([
					3, 2,
				]);
				const descBack = await base().cursorPaginate(2, {
					column: "rank",
					direction: "desc",
					cursor: descNext.prevCursor,
				});
				expect(descBack.data.map((row) => Number(row.rank)).all()).toEqual([
					5, 4,
				]);
			});

			test("transactional seeders roll back as a unit", async () => {
				const email = "p3-seed@example.com";
				await expect(
					runSeeders(
						orm,
						[
							async () => {
								await User.create({ name: "p3-seed", email });
							},
							async () => {
								throw new Error("p3 seeder failed");
							},
						],
						{ transaction: true },
					),
				).rejects.toThrow("p3 seeder failed");
				expect(await orm.table("users").where("email", email).count()).toBe(0);
				await runSeeders(orm, [
					async () => {
						await User.create({ name: "p3-seed", email });
					},
				]);
				expect(await orm.table("users").where("email", email).count()).toBe(1);
			});

			// Destructive: drops every table in the database, so it runs last.
			test("migrator.fresh drops every table and re-runs migrations", async () => {
				const migrator = new Migrator(orm, {
					table: "p2_migrations",
					migrations: [
						{
							name: "0001_create_p2_things",
							async up({
								schema: schemaBuilder,
							}: MigrationContext<typeof schema>) {
								await schemaBuilder.create("p2_things", (t) => {
									t.id();
									t.string("name", 60);
								});
							},
							async down({
								schema: schemaBuilder,
							}: MigrationContext<typeof schema>) {
								await schemaBuilder.drop("p2_things");
							},
						},
					],
				});
				const dropped = await migrator.dropAllTables();
				expect(dropped).toContain("users");
				const fresh = await migrator.fresh();
				expect(fresh.applied).toEqual(["0001_create_p2_things"]);
				expect(await orm.schemaBuilder().hasTable("p2_things")).toBe(true);
				expect(await orm.schemaBuilder().hasTable("users")).toBe(false);
			});
		});
	});
}
