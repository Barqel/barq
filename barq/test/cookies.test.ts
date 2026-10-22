import { beforeEach, describe, expect, it } from "bun:test";
import {
	applyPendingCookies,
	createCookieJar,
	hasPendingCookies,
} from "../src/cookies";

describe("CookieJar", () => {
	let jar: ReturnType<typeof createCookieJar>;
	const secret = "test-secret-key";

	beforeEach(() => {
		jar = createCookieJar(secret);
	});

	it("allows unsigned cookies without a signing secret", () => {
		const unsignedJar = createCookieJar();
		unsignedJar.set("session", "abc");
		expect(unsignedJar.get("session")).toBe("abc");
		expect(unsignedJar.getSigned("session")).toBeNull();
		expect(() => unsignedJar.setSigned("session", "abc")).toThrow(
			"A non-empty secret is required",
		);
	});

	it("should parse cookies from request headers", () => {
		const headers = new Headers({ cookie: "foo=bar; baz=qux" });
		const jar2 = createCookieJar(secret, headers);
		expect(jar2.get("foo")).toBe("bar");
		expect(jar2.get("baz")).toBe("qux");
	});

	it("does not read or parse the Cookie header until first cookie access", () => {
		let cookieHeaderReads = 0;
		const source = new Headers({ cookie: "session=abc" });
		const headers = new Proxy(source, {
			get(target, property) {
				if (property === "get") {
					return (name: string) => {
						if (name.toLowerCase() === "cookie") cookieHeaderReads++;
						return target.get(name);
					};
				}
				const value: unknown = Reflect.get(target, property, target);
				return typeof value === "function" ? value.bind(target) : value;
			},
		});
		const lazyJar = createCookieJar(undefined, headers);

		expect(cookieHeaderReads).toBe(0);
		expect(hasPendingCookies(lazyJar)).toBe(false);
		expect(cookieHeaderReads).toBe(0);
		expect(lazyJar.get("session")).toBe("abc");
		expect(lazyJar.get("missing")).toBeUndefined();
		expect(cookieHeaderReads).toBe(1);
	});

	it("should get and set cookies", () => {
		jar.set("session", "abc123");
		expect(jar.get("session")).toBe("abc123");
	});

	it("should set signed cookies", () => {
		jar.setSigned("user", "john");
		const val = jar.get("user");
		expect(val).toContain("john.");
		const unsigned = jar.getSigned("user");
		expect(unsigned).toBe("john");
	});

	it("should verify signed cookies with custom secret", () => {
		jar.setSigned("user", "john", {}, "custom-secret");
		expect(jar.getSigned("user", "custom-secret")).toBe("john");
		expect(jar.getSigned("user", "wrong-secret")).toBeNull();
	});

	it("returns null for malformed signature lengths", () => {
		jar.set("forged", "value.short");
		expect(jar.getSigned("forged")).toBeNull();
	});

	it("preserves malformed percent escapes in incoming values", () => {
		const jar2 = createCookieJar(
			secret,
			new Headers({ cookie: "broken=%; ok=yes" }),
		);
		expect(jar2.get("broken")).toBe("%");
		expect(jar2.get("ok")).toBe("yes");
	});

	it("requires Secure for SameSite=None", () => {
		expect(() => jar.set("session", "abc", { sameSite: "None" })).toThrow(
			"SameSite=None cookies must also be Secure",
		);
		expect(() =>
			jar.set("session", "abc", { sameSite: "None", secure: true }),
		).not.toThrow();
	});

	it("enforces browser security rules for cookie prefixes", () => {
		expect(() => jar.set("__Secure-session", "x")).toThrow(
			"must also be Secure",
		);
		expect(() =>
			jar.set("__Host-session", "x", {
				secure: true,
				path: "/",
				domain: "example.com",
			}),
		).toThrow("omit Domain");
		expect(() =>
			jar.set("__Host-session", "x", { secure: true, path: "/" }),
		).not.toThrow();
	});

	it("snapshots cookie attributes when queued", () => {
		const options = { path: "/private" };
		jar.set("session", "x", options);
		options.path = "/public";
		const headers = new Headers();
		applyPendingCookies(jar, headers);
		expect(headers.get("set-cookie")).toContain("Path=/private");
	});

	it("should delete cookies", () => {
		jar.set("temp", "value");
		jar.delete("temp");
		expect(jar.get("temp")).toBeUndefined();
	});

	it("should have pending cookies after set", () => {
		expect(hasPendingCookies(jar)).toBe(false);
		jar.set("a", "1");
		expect(hasPendingCookies(jar)).toBe(true);
	});

	it("should apply cookies to headers", () => {
		jar.set("session", "abc123", { httpOnly: true, path: "/" });
		const headers = new Headers();
		applyPendingCookies(jar, headers);
		expect(headers.get("set-cookie")).toContain("session=abc123");
		expect(headers.get("set-cookie")).toContain("HttpOnly");
		expect(headers.get("set-cookie")).toContain("Path=/");
	});

	it("sets HttpOnly by default and permits an explicit opt-out", () => {
		jar.set("session", "private");
		jar.set("client-readable", "public", { httpOnly: false });
		const headers = new Headers();
		applyPendingCookies(jar, headers);
		const cookies = headers.get("set-cookie") ?? "";
		expect(cookies).toContain("session=private");
		expect(cookies).toContain("HttpOnly");
		expect(cookies).toContain("client-readable=public");
	});

	it("should clear pending after apply", () => {
		jar.set("a", "1");
		applyPendingCookies(jar, new Headers());
		expect(hasPendingCookies(jar)).toBe(false);
	});

	it("should handle cookie with special characters", () => {
		jar.set("special", "value with spaces & symbols!", { path: "/" });
		const headers = new Headers();
		applyPendingCookies(jar, headers);
		const cookie = headers.get("set-cookie")!;
		expect(cookie).toContain("special=value%20with%20spaces%20%26%20symbols!");
	});

	it("should handle multiple cookies", () => {
		jar.set("a", "1");
		jar.set("b", "2");
		jar.set("c", "3");
		const headers = new Headers();
		applyPendingCookies(jar, headers);
		const cookies = headers.get("set-cookie")!;
		expect(cookies.split(",").length).toBeGreaterThanOrEqual(3);
	});
});
