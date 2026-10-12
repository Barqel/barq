import { describe, expect, it } from "bun:test";
import { App, json } from "@barqel/barq";
import { helmet, helmetPlugin } from "../src/index";

describe("@barqel/barq-helmet", () => {
	it("applies default security headers", async () => {
		const app = new App();
		app.plugin(helmetPlugin());
		app.get("/test", () => json({ ok: true }));

		const server = app.listen(0);

		try {
			const res = await fetch(`http://localhost:${server.port}/test`);
			expect(res.status).toBe(200);

			expect(res.headers.get("x-content-type-options")).toBe("nosniff");
			expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
			expect(res.headers.get("x-download-options")).toBe("noopen");
			expect(res.headers.get("x-xss-protection")).toBe("0");
			expect(res.headers.get("referrer-policy")).toBe("no-referrer");
			expect(res.headers.get("cross-origin-opener-policy")).toBe("same-origin");
			expect(res.headers.get("cross-origin-resource-policy")).toBe("same-origin");
			expect(res.headers.get("strict-transport-security")).toContain("max-age=31536000");
			expect(res.headers.get("origin-agent-cluster")).toBe("?1");
		} finally {
			await app.stop();
		}
	});

	it("supports disabling specific headers", async () => {
		const app = new App();
		app.use(
			helmet({
				xFrameOptions: false,
				strictTransportSecurity: false,
			}),
		);
		app.get("/disabled", () => json({ ok: true }));

		const server = app.listen(0);

		try {
			const res = await fetch(`http://localhost:${server.port}/disabled`);
			expect(res.status).toBe(200);
			expect(res.headers.get("x-frame-options")).toBeNull();
			expect(res.headers.get("strict-transport-security")).toBeNull();
			expect(res.headers.get("x-content-type-options")).toBe("nosniff");
		} finally {
			await app.stop();
		}
	});

	it("builds custom CSP directives", async () => {
		const app = new App();
		app.use(
			helmet({
				contentSecurityPolicy: {
					directives: {
						defaultSrc: ["'self'", "https://api.example.com"],
						scriptSrc: ["'self'", "'unsafe-inline'"],
						objectSrc: ["'none'"],
					},
				},
			}),
		);
		app.get("/csp", () => json({ ok: true }));

		const server = app.listen(0);

		try {
			const res = await fetch(`http://localhost:${server.port}/csp`);
			const csp = res.headers.get("content-security-policy");
			expect(csp).toBeDefined();
			expect(csp).toContain("default-src 'self' https://api.example.com");
			expect(csp).toContain("script-src 'self' 'unsafe-inline'");
			expect(csp).toContain("object-src 'none'");
		} finally {
			await app.stop();
		}
	});

	it("removes X-Powered-By header by default", async () => {
		const app = new App();
		app.use(helmet());
		app.get("/powered", () => {
			const res = json({ ok: true });
			res.headers.set("x-powered-by", "Express");
			return res;
		});

		const server = app.listen(0);

		try {
			const res = await fetch(`http://localhost:${server.port}/powered`);
			expect(res.headers.get("x-powered-by")).toBeNull();
		} finally {
			await app.stop();
		}
	});
});
