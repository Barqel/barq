// Cast-parity suite — live SQLite coverage for the expanded attribute casts.
//
// Covers: bool/boolean, int/integer, float/double/real, decimal[:scale],
// string, stringable/AsStringable, array/json/object/AsArrayObject,
// collection/AsCollection, date/datetime, immutable_date/immutable_datetime,
// timestamp, `datetime:<format>`, encrypted / encrypted:array|collection|
// object|json / AsEncryptedArrayObject, hashed / `hashed:<algorithm>`,
// `enum:<Type>`, `AsEnumCollection:<Type>` and the `{ enum }` / class-based
// enum forms, plus `parseCastName`/`isCastName`/`KNOWN_CASTS` coherence.

import { beforeAll, describe, expect, test } from "bun:test";
import {
	CastError,
	Collection,
	defineSchema,
	Orm,
	Stringable,
	verifyHashedValue,
} from "../../src/index";
import {
	isCastName,
	KNOWN_CASTS,
	parseCastName,
	registerCastEnum,
} from "../../src/model/casts";
import { sqlite } from "../../src/sqlite";

const schema = defineSchema({
	castables: {
		id: { type: "integer", primaryKey: true, autoIncrement: true },
		flag: { type: "boolean", nullable: true },
		enabled: { type: "boolean", nullable: true },
		count: { type: "integer", nullable: true },
		quantity: { type: "integer", nullable: true },
		ratio: { type: "float", nullable: true },
		rate: { type: "float", nullable: true },
		label: { type: "string", nullable: true },
		code: { type: "string", nullable: true },
		slug: { type: "string", nullable: true },
		alias: { type: "string", nullable: true },
		amount: { type: "decimal", precision: 10, scale: 2, nullable: true },
		balance: { type: "decimal", precision: 10, scale: 2, nullable: true },
		meta: { type: "json", nullable: true },
		tags: { type: "json", nullable: true },
		options: { type: "json", nullable: true },
		payload: { type: "json", nullable: true },
		bag: { type: "json", nullable: true },
		list: { type: "json", nullable: true },
		bornOn: { type: "datetime", nullable: true },
		seenAt: { type: "datetime", nullable: true },
		lockedAt: { type: "datetime", nullable: true },
		birthday: { type: "datetime", nullable: true },
		epoch: { type: "integer", nullable: true },
		formatted: { type: "datetime", nullable: true },
		secret: { type: "json", nullable: true },
		secretList: { type: "json", nullable: true },
		secretBag: { type: "json", nullable: true },
		secretObject: { type: "json", nullable: true },
		secretJson: { type: "json", nullable: true },
		secretArrayObject: { type: "json", nullable: true },
		password: { type: "text", nullable: true },
		checksum: { type: "text", nullable: true },
		status: { type: "string", nullable: true },
		statuses: { type: "json", nullable: true },
		mode: { type: "string", nullable: true },
		level: { type: "string", nullable: true },
	},
});

const orm = new Orm({
	schema,
	dialect: sqlite(":memory:"),
	encryptionKey: "casts-parity-key",
});

/** A PHP-style backed-enum stand-in: named cases carrying a `value`. */
class StatusCase {
	constructor(readonly value: string) {}
}

// biome-ignore lint/complexity/noStaticOnlyClass: a runtime backed-enum stand-in
class Status {
	static readonly Active = new StatusCase("active");
	static readonly Banned = new StatusCase("banned");
	static readonly Trial = new StatusCase("trial");

	static cases(): StatusCase[] {
		return [Status.Active, Status.Banned, Status.Trial];
	}

	static from(value: unknown): StatusCase {
		const found = Status.cases().find((entry) => entry.value === value);
		if (found === undefined) {
			throw new Error(`Unknown status: ${String(value)}`);
		}
		return found;
	}

	static tryFrom(value: unknown): StatusCase | null {
		return Status.cases().find((entry) => entry.value === value) ?? null;
	}
}

registerCastEnum("Status", Status);

// biome-ignore lint/complexity/noStaticOnlyClass: class-based casts are part of the public contract
class UpperCast {
	static get(value: unknown): unknown {
		return value === null || value === undefined
			? value
			: String(value).toUpperCase();
	}

	static set(value: unknown): unknown {
		return value === null || value === undefined
			? value
			: String(value).toLowerCase();
	}
}

class Castable extends orm.model("castables") {
	static casts = {
		flag: "bool",
		enabled: "boolean",
		count: "int",
		quantity: "integer",
		ratio: "float",
		rate: "double",
		label: "string",
		code: UpperCast,
		slug: "stringable",
		alias: "AsStringable",
		amount: "decimal:2",
		balance: "decimal",
		meta: "array",
		tags: "collection",
		options: "AsCollection",
		payload: "object",
		bag: "AsArrayObject",
		list: "json",
		bornOn: "date",
		seenAt: "datetime",
		lockedAt: "immutable_datetime",
		birthday: "immutable_date",
		epoch: "timestamp",
		formatted: "datetime:Y-m-d H:i:s",
		secret: "encrypted",
		secretList: "encrypted:array",
		secretBag: "encrypted:collection",
		secretObject: "encrypted:object",
		secretJson: "encrypted:json",
		secretArrayObject: "AsEncryptedArrayObject",
		password: "hashed",
		checksum: "hashed:sha256",
		status: "enum:Status",
		statuses: "AsEnumCollection:Status",
		mode: { enum: Status },
		level: { enum: { Active: "active", Banned: "banned" } },
	} as const;
}

beforeAll(async () => {
	await orm.schemaBuilder().create("castables", (t) => {
		t.id();
		t.boolean("flag").nullable();
		t.boolean("enabled").nullable();
		t.integer("count").nullable();
		t.integer("quantity").nullable();
		t.float("ratio").nullable();
		t.double("rate").nullable();
		t.string("label").nullable();
		t.string("code").nullable();
		t.string("slug").nullable();
		t.string("alias").nullable();
		t.decimal("amount", 10, 2).nullable();
		t.decimal("balance", 10, 2).nullable();
		t.json("meta").nullable();
		t.json("tags").nullable();
		t.json("options").nullable();
		t.json("payload").nullable();
		t.json("bag").nullable();
		t.json("list").nullable();
		t.datetime("bornOn").nullable();
		t.datetime("seenAt").nullable();
		t.datetime("lockedAt").nullable();
		t.datetime("birthday").nullable();
		t.integer("epoch").nullable();
		t.datetime("formatted").nullable();
		t.json("secret").nullable();
		t.json("secretList").nullable();
		t.json("secretBag").nullable();
		t.json("secretObject").nullable();
		t.json("secretJson").nullable();
		t.json("secretArrayObject").nullable();
		t.text("password").nullable();
		t.text("checksum").nullable();
		t.string("status").nullable();
		t.json("statuses").nullable();
		t.string("mode").nullable();
		t.string("level").nullable();
	});
});

describe("cast names and parsing", () => {
	test("parseCastName covers bare and parameterized forms", () => {
		expect(parseCastName("bool")).toEqual({ base: "bool" });
		expect(parseCastName("timestamp")).toEqual({ base: "timestamp" });
		expect(parseCastName("datetime:Y-m-d")).toEqual({
			base: "datetime",
			arg: "Y-m-d",
		});
		expect(parseCastName("decimal:3")).toEqual({ base: "decimal", arg: "3" });
		expect(parseCastName("hashed:sha256")).toEqual({
			base: "hashed",
			arg: "sha256",
		});
		expect(parseCastName("enum:Status")).toEqual({
			base: "enum",
			arg: "Status",
		});
		expect(parseCastName("AsEnumCollection:Status")).toEqual({
			base: "AsEnumCollection",
			arg: "Status",
		});
		expect(parseCastName("decimal:x")).toBeNull();
		expect(parseCastName("hashed:")).toBeNull();
		expect(parseCastName("enum:")).toBeNull();
		expect(parseCastName("AsEnumCollection:")).toBeNull();
		expect(parseCastName("nope:1")).toBeNull();
	});

	test("KNOWN_CASTS and isCastName stay coherent", () => {
		for (const name of [
			"bool",
			"timestamp",
			"AsStringable",
			"AsCollection",
			"AsArrayObject",
			"AsEncryptedArrayObject",
			"encrypted:object",
			"encrypted:json",
		] as const) {
			expect(KNOWN_CASTS.has(name)).toBe(true);
			expect(isCastName(name)).toBe(true);
		}
		expect(isCastName("hashed:sha512")).toBe(true);
		expect(isCastName("AsEnumCollection:Foo")).toBe(true);
		expect(isCastName("bogus")).toBe(false);
		expect(isCastName(42)).toBe(false);
	});
});

describe("scalar and numeric casts", () => {
	test("bool/boolean, int/integer, float/double, string and decimal", async () => {
		const row = await Castable.create({
			flag: 1 as unknown as boolean,
			enabled: 0 as unknown as boolean,
			count: 41.9,
			quantity: "7" as unknown as number,
			ratio: "9.5" as unknown as number,
			rate: 2.5,
			label: 42 as unknown as string,
			code: "MiXeD",
			amount: "12.5",
			balance: "30",
		});

		expect(row.get("flag")).toBe(true);
		expect(row.get("enabled")).toBe(false);
		expect(row.get("count")).toBe(41);
		expect(row.get("quantity")).toBe(7);
		expect(row.get("ratio")).toBe(9.5);
		expect(row.get("rate")).toBe(2.5);
		expect(row.get("label")).toBe("42");
		expect(row.get("code")).toBe("MIXED");
		expect(row.get("amount") as unknown as string).toBe("12.50");
		expect(row.get("balance") as unknown as string).toBe("30");

		const stored = await orm
			.table("castables")
			.select("code")
			.where("id", row.get("id"))
			.first();
		expect(String(stored?.code)).toBe("mixed");

		const reloaded = await Castable.findOrFail(row.get("id"));
		expect(reloaded.get("count")).toBe(41);
		expect(reloaded.get("code")).toBe("MIXED");
		expect(reloaded.get("amount") as unknown as string).toBe("12.50");
	});
});

describe("JSON, array and collection casts", () => {
	test("array/json/object/AsArrayObject round-trip", async () => {
		const row = await Castable.create({
			meta: ["a", "b"],
			list: ["c", "d"],
			payload: { nested: { enabled: true } },
			bag: { tier: "gold" },
		});
		expect(row.get("meta")).toEqual(["a", "b"]);
		expect(row.get("list")).toEqual(["c", "d"]);
		expect(row.get("payload")).toEqual({ nested: { enabled: true } });
		expect(row.get("bag")).toEqual({ tier: "gold" });

		const reloaded = await Castable.findOrFail(row.get("id"));
		expect(reloaded.get("meta")).toEqual(["a", "b"]);
		expect(reloaded.get("payload")).toEqual({ nested: { enabled: true } });
	});

	test("collection/AsCollection hydrate to Collection instances", async () => {
		const row = await Castable.create({
			tags: Collection.make(["x", "y"]),
			options: ["p", "q"],
		});
		expect(row.get("tags")).toBeInstanceOf(Collection);
		expect((row.get("tags") as Collection<string>).all()).toEqual(["x", "y"]);
		expect(row.get("options")).toBeInstanceOf(Collection);
		expect((row.get("options") as Collection<string>).all()).toEqual([
			"p",
			"q",
		]);

		const reloaded = await Castable.findOrFail(row.get("id"));
		expect(reloaded.get("tags")).toBeInstanceOf(Collection);
		expect((reloaded.get("tags") as Collection<string>).all()).toEqual([
			"x",
			"y",
		]);
	});
});

describe("date and immutable casts", () => {
	test("date/datetime hydrate to Date and datetime:<format> round-trips", async () => {
		const born = new Date("2026-03-14T00:00:00.000Z");
		const seen = new Date("2026-03-14T15:09:26.000Z");
		const row = await Castable.create({
			bornOn: born,
			seenAt: seen,
			formatted: new Date(2026, 2, 14, 15, 9, 26),
		});

		expect(row.get("bornOn")).toBeInstanceOf(Date);
		expect(row.get("seenAt")).toBeInstanceOf(Date);

		const formatted = row.get("formatted") as unknown as string;
		expect(formatted).toBe("2026-03-14 15:09:26");

		const reloaded = await Castable.findOrFail(row.get("id"));
		expect(reloaded.get("bornOn")).toBeInstanceOf(Date);
		expect(reloaded.get("formatted") as unknown as string).toBe(formatted);
	});

	test("immutable_date / immutable_datetime hand out defensive copies", async () => {
		const row = await Castable.create({
			lockedAt: new Date("2026-05-05T10:20:30.000Z"),
			birthday: new Date("1990-01-02T00:00:00.000Z"),
		});

		const first = row.get("lockedAt") as Date;
		const second = row.get("lockedAt") as Date;
		expect(first).toBeInstanceOf(Date);
		expect(first).not.toBe(second);

		first.setFullYear(1999);
		const third = row.get("lockedAt") as Date;
		expect(third.getFullYear()).not.toBe(1999);
		expect(third.getTime()).toBe(
			new Date("2026-05-05T10:20:30.000Z").getTime(),
		);

		const cake = row.get("birthday") as Date;
		cake.setFullYear(1800);
		const cakeAgain = row.get("birthday") as Date;
		expect(cakeAgain.getFullYear()).not.toBe(1800);
	});

	test("timestamp normalizes to UNIX seconds in both directions", async () => {
		const instant = new Date("2026-01-02T03:04:05.000Z");
		const expected = Math.floor(instant.getTime() / 1000);
		const row = await Castable.create({
			epoch: instant as unknown as number,
		});
		expect(row.get("epoch")).toBe(expected);

		const stored = await orm
			.table("castables")
			.select("epoch")
			.where("id", row.get("id"))
			.first();
		expect(Number(stored?.epoch)).toBe(expected);

		const reloaded = await Castable.findOrFail(row.get("id"));
		expect(reloaded.get("epoch")).toBe(expected);

		await reloaded.update({ epoch: 1_700_000_000 });
		expect(reloaded.get("epoch")).toBe(1_700_000_000);
	});
});

describe("stringable casts", () => {
	test("stringable and AsStringable hydrate to Stringable", async () => {
		const row = await Castable.create({ slug: "Hello", alias: "World" });
		expect(row.get("slug")).toBeInstanceOf(Stringable);
		expect(row.get("alias")).toBeInstanceOf(Stringable);
		const slug = row.get("slug") as unknown as Stringable;
		expect(slug.upper().value()).toBe("HELLO");

		const reloaded = await Castable.findOrFail(row.get("id"));
		expect(reloaded.get("slug")).toBeInstanceOf(Stringable);
		expect(String(reloaded.get("alias"))).toBe("World");
	});
});

describe("encrypted casts", () => {
	test("encrypted, encrypted:array|collection|object|json and AsEncryptedArrayObject round-trip", async () => {
		const row = await Castable.create({
			secret: "classified",
			secretList: ["token", "refresh"],
			secretBag: Collection.make(["compact", "dark"]),
			secretObject: { nested: { enabled: true } },
			secretJson: ["a", "b"],
			secretArrayObject: { tier: "gold" },
		});

		expect(row.get("secret")).toBe("classified");
		expect(row.get("secretList")).toEqual(["token", "refresh"]);
		expect(row.get("secretBag")).toBeInstanceOf(Collection);
		expect((row.get("secretBag") as Collection<string>).all()).toEqual([
			"compact",
			"dark",
		]);
		expect(row.get("secretObject")).toEqual({ nested: { enabled: true } });
		expect(row.get("secretJson")).toEqual(["a", "b"]);
		expect(row.get("secretArrayObject")).toEqual({ tier: "gold" });

		const raw = await orm.raw(
			'select "secret", "secretList" from "castables" where "id" = ?',
			[row.get("id")],
		);
		expect(String(raw.rows[0]?.secret).startsWith("v1:")).toBe(true);
		expect(String(raw.rows[0]?.secret)).not.toContain("classified");
		expect(String(raw.rows[0]?.secretList).startsWith("v1:")).toBe(true);

		const reloaded = await Castable.findOrFail(row.get("id"));
		expect(reloaded.get("secret")).toBe("classified");
		expect(reloaded.get("secretList")).toEqual(["token", "refresh"]);
		expect(reloaded.get("secretObject")).toEqual({ nested: { enabled: true } });
	});

	test("a corrupted encrypted payload throws CastError on read", async () => {
		const row = await Castable.create({ secret: "ok" });
		await orm
			.table("castables")
			.where("id", row.get("id"))
			.update({ secret: "not-an-encrypted-payload" } as never);
		await expect(Castable.findOrFail(row.get("id"))).rejects.toThrow(CastError);
	});
});

describe("hashed casts", () => {
	test("hashed is one-way and verifies with verifyHashedValue", async () => {
		const row = await Castable.create({
			password: "hunter2",
			checksum: "hunter2",
		});
		expect(verifyHashedValue("hunter2", row.get("password"))).toBe(true);
		expect(verifyHashedValue("wrong", row.get("password"))).toBe(false);
		expect(verifyHashedValue("hunter2", row.get("checksum"))).toBe(true);
		expect(verifyHashedValue("wrong", row.get("checksum"))).toBe(false);

		const raw = await orm
			.table("castables")
			.select("password", "checksum")
			.where("id", row.get("id"))
			.first();
		expect(String(raw?.password).startsWith("scrypt:")).toBe(true);
		expect(String(raw?.checksum).startsWith("sha256:")).toBe(true);

		// Assigning the stored payload back must not hash it twice.
		const hash = row.get("password") as string;
		await row.update({ password: hash });
		expect(verifyHashedValue("hunter2", row.get("password"))).toBe(true);
	});

	test("hashed rejects non-strings with CastError", async () => {
		const row = await Castable.create({ password: "seed" });
		expect(() => {
			row.set("password", 123 as never);
		}).toThrow(CastError);
	});
});

describe("enum casts", () => {
	test("enum:<Type> hydrates cases and stores the backed value", async () => {
		// The `"enum:<Type>"` form resolves the enum through the runtime
		// registry, so the case type is not known statically.
		const row = await Castable.create({ status: Status.Active as never });
		expect(row.get("status")).toBe(Status.Active as never);

		const stored = await orm
			.table("castables")
			.select("status")
			.where("id", row.get("id"))
			.first();
		expect(stored?.status).toBe("active");

		const reloaded = await Castable.findOrFail(row.get("id"));
		expect(reloaded.get("status")).toBe(Status.Active as never);
	});

	test("AsEnumCollection:<Type> hydrates a Collection of cases", async () => {
		const row = await Castable.create({
			statuses: [Status.Active, Status.Banned],
		});
		const statuses = row.get("statuses") as Collection<StatusCase>;
		expect(statuses).toBeInstanceOf(Collection);
		expect(statuses.all().map((entry) => entry.value)).toEqual([
			"active",
			"banned",
		]);

		const stored = await orm
			.table("castables")
			.select("statuses")
			.where("id", row.get("id"))
			.first();
		expect(stored?.statuses).toEqual(["active", "banned"]);

		const reloaded = await Castable.findOrFail(row.get("id"));
		expect(
			(reloaded.get("statuses") as Collection<StatusCase>)
				.all()
				.map((entry) => entry.value),
		).toEqual(["active", "banned"]);
	});

	test("{ enum } object and class forms validate membership", async () => {
		const row = await Castable.create({
			mode: Status.Trial,
			level: "active",
		});
		expect(row.get("mode")).toBe(Status.Trial as never);
		expect(row.get("level")).toBe("active");

		expect(() => {
			row.set("mode", "nope" as never);
		}).toThrow(CastError);
		expect(() => {
			row.set("mode", Status.Banned as never);
		}).not.toThrow();
		expect(() => {
			row.set("level", "unknown" as never);
		}).toThrow(CastError);
	});

	test("invalid stored enum values throw CastError on hydration", async () => {
		const row = await Castable.create({ status: Status.Active as never });
		await orm
			.table("castables")
			.where("id", row.get("id"))
			.update({ status: "not-a-status" } as never);
		await expect(Castable.findOrFail(row.get("id"))).rejects.toThrow(CastError);
	});
});
