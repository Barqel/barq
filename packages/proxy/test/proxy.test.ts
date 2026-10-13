import { describe, expect, it } from "bun:test";
import { App, json } from "@barqel/barq";
import { proxy } from "../src/index";

describe("@barqel/barq-proxy", () => {
	it("proxies requests to the target server", async () => {
		const backend = new App();
		backend.get("/data", (ctx) => {
			return json({
				host: ctx.req.headers.get("host"),
				query: ctx.queryParam("q"),
				customHeader: ctx.req.headers.get("x-custom"),
			});
		});
		const backendServer = backend.listen(0);

		const gateway = new App();
		gateway.all(
			"/*path",
			proxy({
				target: `http://localhost:${backendServer.port}`,
				changeOrigin: true,
				headers: { "x-custom": "gateway-value" },
			}),
		);
		const gatewayServer = gateway.listen(0);

		try {
			const res = await fetch(
				`http://localhost:${gatewayServer.port}/data?q=search`,
			);
			expect(res.status).toBe(200);

			const data = await res.json();
			expect(data.host).toBe(`localhost:${backendServer.port}`);
			expect(data.query).toBe("search");
			expect(data.customHeader).toBe("gateway-value");
		} finally {
			await gatewayServer.stop();
			await backendServer.stop();
		}
	});

	it("rewrites paths using pathRewrite", async () => {
		const backend = new App();
		backend.get("/internal/users", () => json({ success: true }));
		const backendServer = backend.listen(0);

		const gateway = new App();
		gateway.get(
			"/api/users",
			proxy({
				target: `http://localhost:${backendServer.port}`,
				pathRewrite: (path) => path.replace("/api", "/internal"),
			}),
		);
		const gatewayServer = gateway.listen(0);

		try {
			const res = await fetch(
				`http://localhost:${gatewayServer.port}/api/users`,
			);
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data.success).toBe(true);
		} finally {
			await gatewayServer.stop();
			await backendServer.stop();
		}
	});

	it("handles onProxyReq and onProxyRes hooks", async () => {
		const backend = new App();
		backend.post("/echo", async (ctx) => {
			return json({
				body: await ctx.json(),
				appended: ctx.req.headers.get("x-appended"),
			});
		});
		const backendServer = backend.listen(0);

		const gateway = new App();
		gateway.post(
			"/echo",
			proxy({
				target: `http://localhost:${backendServer.port}`,
				onProxyReq: (init) => {
					(init.headers as Headers).set("x-appended", "true");
				},
				onProxyRes: async (res) => {
					const newHeaders = new Headers(res.headers);
					newHeaders.set("x-gateway-processed", "done");
					return new Response(res.body, {
						status: res.status,
						headers: newHeaders,
					});
				},
			}),
		);
		const gatewayServer = gateway.listen(0);

		try {
			const res = await fetch(`http://localhost:${gatewayServer.port}/echo`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ hello: "world" }),
			});

			expect(res.status).toBe(200);
			expect(res.headers.get("x-gateway-processed")).toBe("done");

			const data = await res.json();
			expect(data.body).toEqual({ hello: "world" });
			expect(data.appended).toBe("true");
		} finally {
			await gatewayServer.stop();
			await backendServer.stop();
		}
	});
});
