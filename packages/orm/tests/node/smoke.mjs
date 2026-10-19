// Runtime smoke test for the *built* @barqel/barq-orm package.
//
// The main test suite runs under Bun (`bun test`); this script proves the same
// core surface works on Node.js with the published artifact:
//
//   bun run build && node tests/node/smoke.mjs
//
// Against a packed tarball installed in a scratch project:
//
//   BARQ_ORM_PACKED=1 node tests/node/smoke.mjs
//
// MySQL and PostgreSQL are exercised when the matching URL is present:
//
//   BARQ_ORM_MYSQL_URL=mysql://root:secret@127.0.0.1:3306/barq_test \
//   BARQ_ORM_PG_URL=postgres://postgres:secret@127.0.0.1:5432/barq_test \
//   node tests/node/smoke.mjs
//
// Exit code 0 means every scenario passed; any assertion failure throws.

import assert from "node:assert/strict";

const packed = process.env.BARQ_ORM_PACKED === "1";
const dist = (file) => new URL(`../../dist/${file}`, import.meta.url).href;

const entry = packed ? "@barqel/barq-orm" : dist("index.js");
const sqliteEntry = packed ? "@barqel/barq-orm/sqlite" : dist("sqlite.js");
const mysqlEntry = packed ? "@barqel/barq-orm/mysql" : dist("mysql.js");
const postgresEntry = packed ? "@barqel/barq-orm/postgres" : dist("postgres.js");

const {
	Orm,
	defineSchema,
	belongsTo,
	belongsToMany,
	hasMany,
	latestOfMany,
	Migrator,
	Pivot,
	runSeeders,
} = await import(entry);
const { sqlite } = await import(sqliteEntry);

const schema = defineSchema({
	smoke_users: {
		id: { type: "integer", primaryKey: true, autoIncrement: true },
		name: "string",
		email: "string",
		settings: { type: "json", nullable: true },
		createdAt: { type: "datetime", nullable: true },
		updatedAt: { type: "datetime", nullable: true },
	},
	smoke_posts: {
		id: { type: "integer", primaryKey: true, autoIncrement: true },
		userId: "integer",
		title: "string",
		views: { type: "integer", default: 0 },
	},
	smoke_roles: {
		id: { type: "integer", primaryKey: true, autoIncrement: true },
		name: "string",
	},
	smoke_role_user: {
		userId: "integer",
		roleId: "integer",
		note: { type: "string", nullable: true },
	},
});

/** One full scenario against an already-connected ORM. */
async function scenario(label, orm) {
	const ddl = orm.schemaBuilder();
	await ddl.dropIfExists("smoke_role_user");
	await ddl.dropIfExists("smoke_roles");
	await ddl.dropIfExists("smoke_posts");
	await ddl.dropIfExists("smoke_users");
	await ddl.create("smoke_users", (t) => {
		t.id();
		t.string("name", 80);
		t.string("email", 120).unique();
		t.json("settings").nullable();
		t.datetime("createdAt").nullable();
		t.datetime("updatedAt").nullable();
	});
	await ddl.create("smoke_posts", (t) => {
		t.id();
		t.integer("userId");
		t.string("title", 120);
		t.integer("views").default(0);
	});
	await ddl.create("smoke_roles", (t) => {
		t.id();
		t.string("name", 40);
	});
	await ddl.create("smoke_role_user", (t) => {
		t.integer("userId");
		t.integer("roleId");
		t.string("note", 60).nullable();
	});

	class SmokeRole extends orm.model("smoke_roles") {}
	class SmokeUser extends orm.model("smoke_users") {
		static relations = {
			posts: hasMany(() => SmokePost, "userId"),
			latestPost: latestOfMany(() => SmokePost, "userId", "views"),
			roles: belongsToMany(() => SmokeRole, {
				through: "smoke_role_user",
				foreignPivotKey: "userId",
				relatedPivotKey: "roleId",
				withPivot: ["note"],
			}),
		};
	}
	class SmokePost extends orm.model("smoke_posts") {
		static relations = {
			author: belongsTo(() => SmokeUser, "userId"),
		};
	}

	// --- writes -------------------------------------------------------------
	const ada = await SmokeUser.create({
		name: "Ada",
		email: `${label}-ada@example.com`,
		settings: JSON.stringify({ theme: "dark", tags: ["a", "b"] }),
	});
	await SmokeUser.create({
		name: "Grace",
		email: `${label}-grace@example.com`,
		settings: JSON.stringify({ theme: "light" }),
	});
	const adaId = ada.get("id");

	await SmokePost.create({ userId: adaId, title: "First", views: 10 });
	await SmokePost.create({ userId: adaId, title: "Second", views: 30 });
	// Tied extremes: the one-of-many predicate must still match exactly once.
	await SmokePost.create({ userId: adaId, title: "Tied A", views: 50 });
	await SmokePost.create({ userId: adaId, title: "Tied B", views: 50 });
	await SmokePost.create({ userId: adaId, title: "Low", views: 1 });

	// --- reads --------------------------------------------------------------
	assert.equal(await SmokeUser.query().count(), 2, "user count");
	assert.equal(await SmokePost.query().where("views", ">", 15).count(), 3);
	const ordered = await SmokePost.query()
		.where("userId", "=", adaId)
		.orderBy("views", "desc")
		.get();
	assert.deepEqual(
		ordered.map((post) => post.get("title")).all(),
		["Tied A", "Tied B", "Second", "First", "Low"],
	);

	// --- eager loading (typed, no N+1) --------------------------------------
	const loaded = await SmokeUser.query().orderBy("id").with("posts").get();
	assert.equal(loaded.length, 2);
	assert.equal(loaded.first().posts.length, 5);
	const withAuthor = await SmokePost.query().with("author").firstOrFail();
	assert.equal(withAuthor.author.get("name"), "Ada");

	// --- aggregates and instance extras -------------------------------------
	const counted = await SmokeUser.query()
		.where("name", "Ada")
		.withCount("posts")
		.withSum("posts", "views")
		.firstOrFail();
	assert.equal(Number(counted.postsCount), 5);
	assert.equal(Number(counted.postsSumViews), 141);
	const withExtras = await (
		await SmokeUser.query().where("name", "Ada").firstOrFail()
	).loadCount("posts");
	assert.equal(Number(withExtras.postsCount), 5);

	// --- one-of-many ties ---------------------------------------------------
	const tied = await SmokeUser.query()
		.where("name", "Ada")
		.whereHas("latestPost")
		.get();
	assert.equal(tied.length, 1);
	const latest = await (
		await SmokeUser.query().where("name", "Ada").firstOrFail()
	)
		.relation("latestPost")
		.query()
		.get();
	assert.equal(latest.length, 1);

	// --- JSON ---------------------------------------------------------------
	const json = await orm
		.table("smoke_users")
		.whereJsonContainsKey("settings", "$.theme")
		.where("name", "Ada")
		.get();
	assert.equal(json.length, 1);

	// --- belongsToMany + pivot events ---------------------------------------
	const role = await orm.table("smoke_roles").insert({ name: "admin" });
	const events = [];
	const offs = [
		SmokeUser.onPivot("pivotAttaching", (payload) => {
			events.push(`attaching:${payload.relation}`);
		}),
		SmokeUser.onPivot("pivotAttached", (payload) => {
			events.push(`attached:${payload.relation}`);
		}),
		SmokeUser.onPivot("pivotDetached", () => {
			events.push("detached");
		}),
	];
	try {
		const attached = await (await SmokeUser.query()
			.where("name", "Ada")
			.firstOrFail()
		)
			.relation("roles")
			.attach(role.id, { note: "primary" });
		assert.equal(attached, 1);
		const withRole = await SmokeUser.query()
			.where("name", "Ada")
			.with("roles")
			.firstOrFail();
		assert.equal(withRole.roles.first().get("name"), "admin");
		assert.equal(withRole.roles.first().pivot.note, "primary");
		const detached = await (await SmokeUser.query()
			.where("name", "Ada")
			.firstOrFail()
		)
			.relation("roles")
			.detach(role.id);
		assert.equal(detached, 1);
	} finally {
		for (const off of offs) off();
	}
	assert.deepEqual(events, ["attaching:roles", "attached:roles", "detached"]);

	// --- transactions -------------------------------------------------------
	const rolledBack = await orm
		.transaction(async () => {
			await SmokeUser.create({
				name: "Rollback",
				email: `${label}-rollback@example.com`,
			});
			throw new Error("rollback");
		})
		.catch((error) => error.message);
	assert.equal(rolledBack, "rollback");
	assert.equal(
		await SmokeUser.query().where("name", "Rollback").count(),
		0,
		"rollback removed the row",
	);

	// --- cursor pagination --------------------------------------------------
	const firstPage = await SmokePost.query().cursorPaginate(2, {
		order: [{ column: "id" }],
	});
	assert.equal(firstPage.data.length, 2);
	assert.equal(firstPage.hasMore, true);
	assert.equal(firstPage.hasPrevious, false);
	const secondPage = await SmokePost.query().cursorPaginate(2, {
		order: [{ column: "id" }],
		cursor: firstPage.nextCursor,
	});
	assert.equal(secondPage.hasPrevious, true);
	const back = await SmokePost.query().cursorPaginate(2, {
		order: [{ column: "id" }],
		cursor: secondPage.prevCursor,
	});
	assert.deepEqual(
		back.data.map((row) => row.id).all(),
		firstPage.data.map((row) => row.id).all(),
	);

	// --- seeders ------------------------------------------------------------
	await runSeeders(
		orm,
		[
			async () => {
				await orm.table("smoke_users").insert({
					name: "Seeded",
					email: `${label}-seeded@example.com`,
				});
			},
		],
		{ transaction: true },
	);
	assert.equal(await SmokeUser.query().where("name", "Seeded").count(), 1);

	// --- DDL teardown -------------------------------------------------------
	const migrator = new Migrator(orm, { migrations: [] });
	const dropped = await migrator.dropAllTables();
	assert.ok(dropped.includes("smoke_users"), "dropAllTables reports names");

	await orm.destroy();
	console.log(`ok   ${label}`);
}

await scenario("sqlite", new Orm({ schema, dialect: sqlite({ path: ":memory:" }) }));

const mysqlUrl = process.env.BARQ_ORM_MYSQL_URL;
if (mysqlUrl !== undefined && mysqlUrl !== "") {
	const { mysql } = await import(mysqlEntry);
	await scenario("mysql", new Orm({ schema, dialect: mysql({ uri: mysqlUrl }) }));
}

const pgUrl = process.env.BARQ_ORM_PG_URL;
if (pgUrl !== undefined && pgUrl !== "") {
	const { postgres } = await import(postgresEntry);
	await scenario(
		"postgres",
		new Orm({ schema, dialect: postgres({ uri: pgUrl }) }),
	);
}

// `Pivot` must be exported for custom pivot models (`using`).
assert.equal(typeof Pivot, "function");
console.log(`ok   exports (${packed ? "packed tarball" : "dist"})`);
