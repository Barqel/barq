import { afterEach, describe, expect, it } from "bun:test";
import {
	Crypt,
	DecryptException,
	EncryptionKeyError,
	Hash,
	HashAlgorithmMismatchError,
	InvalidHashError,
	Password,
	WeakPasswordError,
} from "../src/index";

const KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
const PREVIOUS = Buffer.from("abcdef0123456789abcdef0123456789").toString(
	"base64",
);

afterEach(() => {
	delete process.env.APP_KEY;
	delete process.env.APP_PREVIOUS_KEYS;
	delete process.env.HASH_DRIVER;
	delete process.env.HASH_VERIFY;
});

describe("Hash", () => {
	it("hashes and verifies a password", async () => {
		const hashed = await Hash.make("Hassan");

		expect(hashed.includes("Hassan")).toBe(false);
		expect(await Hash.check("Hassan", hashed)).toBe(true);
		expect(await Hash.check("wrong-password", hashed)).toBe(false);
	});

	it("salts every hash", async () => {
		const first = await Hash.make("same-password");
		const second = await Hash.make("same-password");

		expect(first === second).toBe(false);
		expect(await Hash.check("same-password", first)).toBe(true);
		expect(await Hash.check("same-password", second)).toBe(true);
	});

	it("needs a rehash when the cost went up", async () => {
		const weak = await Hash.make("s3cret", { cost: 1024 });

		expect(Hash.needsRehash(weak)).toBe(true);
		expect(Hash.needsRehash(weak, { cost: 1024 })).toBe(false);
	});

	it("refuses a hash made with another algorithm", async () => {
		const hashed = await Hash.make("s3cret");

		process.env.HASH_DRIVER = "bcrypt";

		await expect(Hash.check("s3cret", hashed)).rejects.toThrow(
			HashAlgorithmMismatchError,
		);
	});

	it("allows several algorithms when the verification is off", async () => {
		const hashed = await Hash.make("s3cret");

		process.env.HASH_DRIVER = "bcrypt";
		process.env.HASH_VERIFY = "false";

		expect(await Hash.check("s3cret", hashed)).toBe(true);
	});

	it("rejects a malformed hash", async () => {
		await expect(Hash.check("s3cret", "not-a-hash")).rejects.toThrow(
			InvalidHashError,
		);
	});
});

describe("Crypt", () => {
	it("round-trips a value", () => {
		process.env.APP_KEY = KEY;

		const payload = Crypt.encryptString("sk_live_123");

		expect(payload.includes("sk_live_123")).toBe(false);
		expect(Crypt.decryptString(payload)).toBe("sk_live_123");
	});

	it("decrypts with a previous key after a rotation", () => {
		process.env.APP_KEY = KEY;

		const payload = Crypt.encryptString("sk_live_123");

		process.env.APP_KEY = PREVIOUS;
		process.env.APP_PREVIOUS_KEYS = KEY;

		expect(Crypt.decryptString(payload)).toBe("sk_live_123");
	});

	it("refuses a tampered payload", () => {
		process.env.APP_KEY = KEY;

		const payload = Crypt.encryptString("sk_live_123");
		const raw = Buffer.from(payload, "base64");

		raw[raw.length - 1] = raw[raw.length - 1]! ^ 0xff;

		expect(() => Crypt.decryptString(raw.toString("base64"))).toThrow(
			DecryptException,
		);
	});

	it("needs an APP_KEY", () => {
		expect(() => Crypt.encryptString("sk_live_123")).toThrow(
			EncryptionKeyError,
		);
	});
});

describe("Password", () => {
	it("accepts a password that satisfies the rule", () => {
		const rule = Password.of().min(8).mixedCase().numbers();

		expect(rule.validate("Passw0rd")).toBe(true);
	});

	it("reports every broken rule", () => {
		const rule = Password.of().min(8).mixedCase().numbers();
		const issues = rule.issues("short");

		expect(rule.validate("short")).toBe(false);
		expect(issues).toContain("tooShort");
		expect(issues).toContain("missingUppercase");
		expect(issues).toContain("missingDigit");
	});

	it("throws on a weak password", () => {
		expect(() => Password.of().min(8).assert("weak")).toThrow(
			WeakPasswordError,
		);
	});
});
