// Benchmark suite: raw driver vs Kysely vs Drizzle vs Barq ORM.
//
// Every library runs against its OWN isolated in-memory SQLite database with
// the exact same schema and seed data, so no run can warm a shared cache for
// another. Each workload is verified once (result sanity), then measured:
// warmup, then `SAMPLES` timed rounds of `ITERATIONS` operations; the median
// round is reported as ops/sec.
//
// Run:  bun run bench
// JSON: bun benchmarks/run.ts --json benchmarks/results.json

import { Database } from "bun:sqlite";
import { count, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { sql } from "kysely";
import { createKysely } from "../src/adapters/kysely";
import { defineSchema, hasMany, Orm } from "../src/index";
import { sqlite } from "../src/sqlite";

// ---------------------------------------------------------------------------
// Workload definitions
// ---------------------------------------------------------------------------

const USER_COUNT = 100;
const POSTS_PER_USER = 10;
const ONE_SAMPLE_ITERATIONS = {
	selectByPk: 2_000,
	selectMany50: 500,
	countPosts: 1_000,
	insertOne: 400,
	updateOne: 1_000,
	eager10: 300,
	hydrate100: 500,
	modelFind: 2_000,
	modelEager10: 200,
} as const;

const SAMPLES = 5;
const WARMUP_ITERATIONS = 50;

type WorkloadName = keyof typeof ONE_SAMPLE_ITERATIONS;

interface Harness {
	readonly name: string;
	/** Rebuilds schema + seed data from scratch. */
	seed(): Promise<void>;
	selectByPk(id: number): Promise<unknown>;
	selectMany50(): Promise<unknown>;
	countPosts(): Promise<unknown>;
	insertOne(index: number): Promise<unknown>;
	updateOne(id: number): Promise<unknown>;
	eager10(): Promise<{ users: unknown[]; posts: unknown[] }>;
	hydrate100(): Promise<unknown>;
	modelFind?(id: number): Promise<unknown>;
	modelEager10?(): Promise<unknown>;
	destroy(): Promise<void>;
}

const DDL = [
	`create table users (
		id integer primary key autoincrement,
		name text not null,
		email text not null,
		age integer,
		active integer not null default 1
	)`,
	`create table posts (
		id integer primary key autoincrement,
		userId integer not null,
		title text not null,
		views integer not null default 0
	)`,
	`create index posts_userId_idx on posts (userId)`,
];

function seedUsers(): Array<{ name: string; email: string; age: number }> {
	return Array.from({ length: USER_COUNT }, (_, index) => ({
		name: `User ${index + 1}`,
		email: `user${index + 1}@example.com`,
		age: 20 + (index % 50),
	}));
}

function seedPosts(): Array<{ userId: number; title: string; views: number }> {
	const posts: Array<{ userId: number; title: string; views: number }> = [];
	for (let userId = 1; userId <= USER_COUNT; userId += 1) {
		for (let post = 1; post <= POSTS_PER_USER; post += 1) {
			posts.push({
				userId,
				title: `Post ${userId}-${post}`,
				views: userId * post,
			});
		}
	}
	return posts;
}

const EAGER_IDS = Array.from({ length: 10 }, (_, index) => index + 1);

// ---------------------------------------------------------------------------
// Raw bun:sqlite
// ---------------------------------------------------------------------------

async function makeRawHarness(): Promise<Harness> {
	const client = new Database(":memory:");
	client.exec("pragma journal_mode = memory");
	for (const statement of DDL) client.exec(statement);
	const insertUser = client.query(
		"insert into users (name, email, age, active) values (?, ?, ?, 1)",
	);
	const insertPost = client.query(
		"insert into posts (userId, title, views) values (?, ?, ?)",
	);
	await (async () => {
		for (const user of seedUsers())
			insertUser.run(user.name, user.email, user.age);
		for (const post of seedPosts())
			insertPost.run(post.userId, post.title, post.views);
	})();

	const selectById = client.query("select * from users where id = ?");
	const selectMany = client.query("select * from users order by id limit 50");
	const countPosts = client.query("select count(*) as c from posts");
	const updateAge = client.query("update users set age = ? where id = ?");
	const insertBench = client.query(
		"insert into users (name, email, age, active) values (?, ?, ?, 1)",
	);
	const selectUsers10 = client.query(
		"select * from users order by id limit 10",
	);
	const selectAll100 = client.query(
		"select * from users order by id limit 100",
	);

	return {
		name: "raw bun:sqlite",
		async seed() {},
		async selectByPk(id) {
			return selectById.get(id);
		},
		async selectMany50() {
			return selectMany.all();
		},
		async countPosts() {
			return countPosts.get();
		},
		async insertOne(index) {
			insertBench.run(`Benchmark ${index}`, `bench-${index}@example.com`, 30);
		},
		async updateOne(id) {
			updateAge.run(31, id);
		},
		async eager10() {
			const users = selectUsers10.all() as Array<{ id: number }>;
			const placeholders = users.map(() => "?").join(",");
			const posts = client
				.query(
					`select * from posts where userId in (${placeholders}) order by id`,
				)
				.all(...(users.map((user) => user.id) as number[]));
			return { users, posts };
		},
		async hydrate100() {
			return selectAll100.all();
		},
		async destroy() {
			client.close();
		},
	};
}

// ---------------------------------------------------------------------------
// Kysely
// ---------------------------------------------------------------------------

const benchSchema = defineSchema({
	users: {
		id: { type: "integer", primaryKey: true, autoIncrement: true },
		name: "string",
		email: "string",
		age: { type: "integer", nullable: true },
		active: { type: "boolean", default: true },
	},
	posts: {
		id: { type: "integer", primaryKey: true, autoIncrement: true },
		userId: "integer",
		title: "string",
		views: { type: "integer", default: 0 },
	},
});

async function makeKyselyHarness(): Promise<Harness> {
	const db = createKysely<typeof benchSchema>(sqlite(":memory:"));
	for (const statement of DDL) await sql.raw(statement).execute(db);
	await db
		.insertInto("users")
		.values(seedUsers().map((user) => ({ ...user, active: true })))
		.execute();
	await db.insertInto("posts").values(seedPosts()).execute();

	return {
		name: "Kysely",
		async seed() {},
		async selectByPk(id) {
			return db
				.selectFrom("users")
				.selectAll()
				.where("id", "=", id)
				.executeTakeFirst();
		},
		async selectMany50() {
			return db
				.selectFrom("users")
				.selectAll()
				.orderBy("id")
				.limit(50)
				.execute();
		},
		async countPosts() {
			return db
				.selectFrom("posts")
				.select((eb) => eb.fn.countAll<number>().as("c"))
				.executeTakeFirst();
		},
		async insertOne(index) {
			await db
				.insertInto("users")
				.values({
					name: `Benchmark ${index}`,
					email: `bench-${index}@example.com`,
					age: 30,
				})
				.execute();
		},
		async updateOne(id) {
			await db
				.updateTable("users")
				.set({ age: 31 })
				.where("id", "=", id)
				.execute();
		},
		async eager10() {
			const users = await db
				.selectFrom("users")
				.selectAll()
				.orderBy("id")
				.limit(10)
				.execute();
			const posts = await db
				.selectFrom("posts")
				.selectAll()
				.where(
					"userId",
					"in",
					users.map((user) => user.id),
				)
				.execute();
			return { users, posts };
		},
		async hydrate100() {
			return db
				.selectFrom("users")
				.selectAll()
				.orderBy("id")
				.limit(100)
				.execute();
		},
		async destroy() {
			await db.destroy();
		},
	};
}

// ---------------------------------------------------------------------------
// Drizzle
// ---------------------------------------------------------------------------

const drizzleUsers = sqliteTable("users", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	name: text("name").notNull(),
	email: text("email").notNull(),
	age: integer("age"),
	active: integer("active").notNull().default(1),
});

const drizzlePosts = sqliteTable("posts", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	userId: integer("userId").notNull(),
	title: text("title").notNull(),
	views: integer("views").notNull().default(0),
});

async function makeDrizzleHarness(): Promise<Harness> {
	const client = new Database(":memory:");
	client.exec("pragma journal_mode = memory");
	for (const statement of DDL) client.exec(statement);
	const db = drizzle(client);
	const insertUser = client.query(
		"insert into users (name, email, age, active) values (?, ?, ?, 1)",
	);
	const insertPost = client.query(
		"insert into posts (userId, title, views) values (?, ?, ?)",
	);
	for (const user of seedUsers())
		insertUser.run(user.name, user.email, user.age);
	for (const post of seedPosts())
		insertPost.run(post.userId, post.title, post.views);

	return {
		name: "Drizzle",
		async seed() {},
		async selectByPk(id) {
			return db
				.select()
				.from(drizzleUsers)
				.where(eq(drizzleUsers.id, id))
				.get();
		},
		async selectMany50() {
			return db
				.select()
				.from(drizzleUsers)
				.orderBy(drizzleUsers.id)
				.limit(50)
				.all();
		},
		async countPosts() {
			return db.select({ c: count() }).from(drizzlePosts).get();
		},
		async insertOne(index) {
			db.insert(drizzleUsers)
				.values({
					name: `Benchmark ${index}`,
					email: `bench-${index}@example.com`,
					age: 30,
				})
				.run();
		},
		async updateOne(id) {
			db.update(drizzleUsers)
				.set({ age: 31 })
				.where(eq(drizzleUsers.id, id))
				.run();
		},
		async eager10() {
			const users = db
				.select()
				.from(drizzleUsers)
				.orderBy(drizzleUsers.id)
				.limit(10)
				.all();
			const posts = db
				.select()
				.from(drizzlePosts)
				.where(
					inArray(
						drizzlePosts.userId,
						users.map((user) => user.id),
					),
				)
				.all();
			return { users, posts };
		},
		async hydrate100() {
			return db
				.select()
				.from(drizzleUsers)
				.orderBy(drizzleUsers.id)
				.limit(100)
				.all();
		},
		async destroy() {
			client.close();
		},
	};
}

// ---------------------------------------------------------------------------
// Barq ORM (rows + models)
// ---------------------------------------------------------------------------

async function makeBarqHarness(): Promise<Harness> {
	const orm = new Orm({ schema: benchSchema, dialect: sqlite(":memory:") });
	const ddl = orm.schemaBuilder();
	await ddl.create("users", (t) => {
		t.id();
		t.string("name");
		t.string("email");
		t.integer("age").nullable();
		t.boolean("active").default(true);
	});
	await ddl.create("posts", (t) => {
		t.id();
		t.integer("userId");
		t.string("title");
		t.integer("views").default(0);
	});
	await orm.table("users").insertMany(seedUsers());
	await orm.table("posts").insertMany(seedPosts());

	class BenchUser extends orm.model("users") {
		static relations = {
			posts: hasMany(() => BenchPost, "userId"),
		};
	}
	class BenchPost extends orm.model("posts") {}

	return {
		name: "Barq ORM",
		async seed() {},
		async selectByPk(id) {
			return orm.table("users").where("id", id).first();
		},
		async selectMany50() {
			return orm.table("users").orderBy("id").limit(50).get();
		},
		async countPosts() {
			return orm.table("posts").count();
		},
		async insertOne(index) {
			await orm.table("users").insert({
				name: `Benchmark ${index}`,
				email: `bench-${index}@example.com`,
				age: 30,
			});
		},
		async updateOne(id) {
			await orm.table("users").where("id", id).update({ age: 31 });
		},
		async eager10() {
			const users = await BenchUser.query()
				.whereIn("id", [...EAGER_IDS])
				.with("posts")
				.get();
			const posts = users.flatMap((user) => user.posts);
			return { users, posts };
		},
		async hydrate100() {
			return orm.table("users").orderBy("id").limit(100).get();
		},
		async modelFind(id) {
			return BenchUser.find(id);
		},
		async modelEager10() {
			return BenchUser.query()
				.whereIn("id", [...EAGER_IDS])
				.with("posts")
				.get();
		},
		async destroy() {
			await orm.destroy();
		},
	};
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

interface Measurement {
	library: string;
	workload: string;
	opsPerSecond: number;
	medianNsPerOp: number;
}

async function measure(
	library: string,
	workload: string,
	iterations: number,
	fn: (index: number) => Promise<unknown>,
): Promise<Measurement> {
	for (let index = 0; index < WARMUP_ITERATIONS; index += 1) {
		await fn(index);
	}
	const rounds: number[] = [];
	for (let sample = 0; sample < SAMPLES; sample += 1) {
		const start = Bun.nanoseconds();
		for (let index = 0; index < iterations; index += 1) {
			await fn(index);
		}
		rounds.push(Bun.nanoseconds() - start);
	}
	rounds.sort((a, b) => a - b);
	const median = rounds[Math.floor(rounds.length / 2)]!;
	return {
		library,
		workload,
		opsPerSecond: (iterations / median) * 1e9,
		medianNsPerOp: median / iterations,
	};
}

function assert(condition: unknown, message: string): void {
	if (!condition) throw new Error(`Benchmark sanity check failed: ${message}`);
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function verifyHarness(harness: Harness): Promise<void> {
	const byPk = (await harness.selectByPk(7)) as { id?: number } | undefined;
	assert(byPk !== undefined && byPk !== null, `${harness.name}: selectByPk`);
	const many = (await harness.selectMany50()) as unknown[];
	assert(many.length === 50, `${harness.name}: selectMany50 length`);
	const total = await harness.countPosts();
	const numeric =
		typeof total === "number"
			? total
			: Number(
					(total as { c?: unknown; count?: unknown }).c ??
						(total as { count?: unknown }).count,
				);
	assert(
		numeric === USER_COUNT * POSTS_PER_USER,
		`${harness.name}: countPosts`,
	);
	const eager = (await harness.eager10()) as {
		users?: unknown[];
		posts?: unknown[];
	};
	assert(eager.users?.length === 10, `${harness.name}: eager users`);
	assert(eager.posts?.length === 100, `${harness.name}: eager posts`);
	if (harness.modelFind !== undefined) {
		const found = (await harness.modelFind(7)) as {
			get?: (k: string) => unknown;
		};
		assert(found !== null, `${harness.name}: modelFind`);
	}
}

async function main(): Promise<void> {
	const jsonIndex = process.argv.indexOf("--json");
	const jsonPath = jsonIndex >= 0 ? process.argv[jsonIndex + 1] : undefined;

	const harnesses: Harness[] = [
		await makeRawHarness(),
		await makeKyselyHarness(),
		await makeDrizzleHarness(),
		await makeBarqHarness(),
	];

	const measurements: Measurement[] = [];
	const workloads: WorkloadName[] = [
		"selectByPk",
		"selectMany50",
		"countPosts",
		"insertOne",
		"updateOne",
		"eager10",
		"hydrate100",
		"modelFind",
		"modelEager10",
	];

	for (const harness of harnesses) {
		await verifyHarness(harness);
		for (const workload of workloads) {
			const fn = harness[workload] as
				| ((argument: number) => Promise<unknown>)
				| undefined;
			if (fn === undefined) continue;
			const iterations = ONE_SAMPLE_ITERATIONS[workload];
			const usesId =
				workload === "selectByPk" ||
				workload === "updateOne" ||
				workload === "modelFind";
			const bound = (index: number) =>
				fn.call(harness, usesId ? (index % USER_COUNT) + 1 : index);
			measurements.push(
				await measure(harness.name, workload, iterations, bound),
			);
		}
	}

	// Markdown report
	const libraries = harnesses.map((harness) => harness.name);
	console.log(`\n| Workload | ${libraries.join(" | ")} |`);
	console.log(`| --- | ${libraries.map(() => "---:").join(" | ")} |`);
	for (const workload of workloads) {
		const cells = libraries.map((library) => {
			const found = measurements.find(
				(entry) => entry.library === library && entry.workload === workload,
			);
			return found === undefined
				? "—"
				: `${Math.round(found.opsPerSecond)} ops/s`;
		});
		if (cells.every((cell) => cell === "—")) continue;
		console.log(`| ${workload} | ${cells.join(" | ")} |`);
	}
	console.log(
		`\nMedian of ${SAMPLES} rounds after ${WARMUP_ITERATIONS} warmup ops; each round runs the workload iterations back-to-back (see benchmarks/run.ts).`,
	);

	if (jsonPath !== undefined) {
		await Bun.write(jsonPath, JSON.stringify({ measurements }, null, 2));
		console.log(`\nWrote ${jsonPath}`);
	}

	for (const harness of harnesses) await harness.destroy();
}

await main();
