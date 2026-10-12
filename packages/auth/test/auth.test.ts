import { describe, expect, it } from "bun:test";
import { App, json } from "@barqel/barq";
import { bearerAuth, hashPassword, requireRoles, signJwt, verifyJwt, verifyPassword } from "../src/index";

describe("@barqel/barq-auth", () => {
	const secret = "super-secret-key-at-least-32-chars-long";

	describe("JWT Engine", () => {
		it("signs and verifies JWT payload", () => {
			const token = signJwt({ sub: "user-42", role: "admin" }, secret, { expiresIn: "1h" });
			expect(typeof token).toBe("string");

			const verified = verifyJwt(token, secret);
			expect(verified.sub).toBe("user-42");
			expect(verified.role).toBe("admin");
			expect(verified.exp).toBeDefined();
		});

		it("throws when token is expired", async () => {
			const token = signJwt({ sub: "user-42" }, secret, { expiresIn: 0 });
			await Bun.sleep(1100);
			expect(() => verifyJwt(token, secret)).toThrow("Token has expired");
		});

		it("throws when signature is invalid", () => {
			const token = signJwt({ sub: "user-42" }, secret);
			expect(() => verifyJwt(token, "wrong-secret")).toThrow("Invalid token signature");
		});
	});

	describe("Password Hashing", () => {
		it("hashes and verifies password", () => {
			const password = "my-secure-password";
			const hashed = hashPassword(password);

			expect(hashed.startsWith("$pbkdf2$")).toBe(true);
			expect(verifyPassword(password, hashed)).toBe(true);
			expect(verifyPassword("wrong-password", hashed)).toBe(false);
		});
	});

	describe("Middleware Integration", () => {
		it("authenticates valid Bearer token and injects user into context state", async () => {
			const app = new App();
			const token = signJwt({ id: "usr_101", role: "admin" }, secret);

			app.get("/protected", bearerAuth({ secret }), (ctx) => {
				const user = ctx.state.user as { id: string; role: string };
				return json({ authenticated: true, user });
			});

			const server = app.listen(0);

			try {
				const resNoAuth = await fetch(`http://localhost:${server.port}/protected`);
				expect(resNoAuth.status).toBe(401);

				const resAuth = await fetch(`http://localhost:${server.port}/protected`, {
					headers: { Authorization: `Bearer ${token}` },
				});
				expect(resAuth.status).toBe(200);
				const data = await resAuth.json();
				expect(data).toMatchObject({ authenticated: true, user: { id: "usr_101", role: "admin" } });
			} finally {
				await app.stop();
			}
		});

		it("enforces role requirements", async () => {
			const app = new App();
			const userToken = signJwt({ sub: "regular-user", role: "user" }, secret);
			const adminToken = signJwt({ sub: "admin-user", role: "admin" }, secret);

			app.get("/admin", bearerAuth({ secret }), requireRoles("admin"), () => json({ access: "granted" }));

			const server = app.listen(0);

			try {
				const userRes = await fetch(`http://localhost:${server.port}/admin`, {
					headers: { Authorization: `Bearer ${userToken}` },
				});
				expect(userRes.status).toBe(403);

				const adminRes = await fetch(`http://localhost:${server.port}/admin`, {
					headers: { Authorization: `Bearer ${adminToken}` },
				});
				expect(adminRes.status).toBe(200);
				expect(await adminRes.json()).toEqual({ access: "granted" });
			} finally {
				await app.stop();
			}
		});
	});
});
