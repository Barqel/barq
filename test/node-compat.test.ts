import { describe, expect, it } from "bun:test";
import { unlink } from "node:fs/promises";
import { connect } from "node:net";

async function fetchWithRetry(
	url: string,
	options?: RequestInit,
	retries = 10,
) {
	let lastError: unknown;
	for (let i = 0; i < retries; i++) {
		try {
			const res = await fetch(url, options);
			return res;
		} catch (e) {
			lastError = e;
			await Bun.sleep(50);
		}
	}
	throw lastError;
}

describe("Node.js Compatibility Layer", () => {
	it("runs Barq under Node.js with high-performance routing, JSON, cookies, and WebSockets", async () => {
		const buildProc = Bun.spawn(["bun", "run", "build"], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const buildExit = await buildProc.exited;
		if (buildExit !== 0) {
			const [stdout, stderr] = await Promise.all([
				new Response(buildProc.stdout).text(),
				new Response(buildProc.stderr).text(),
			]);
			throw new Error(
				`Build failed with code ${buildExit}:\n${stdout}\n${stderr}`,
			);
		}

		const jsPath = `./tmp_node_test_${Math.random().toString(36).slice(2)}.js`;

		const scriptContent = `
      import { App } from "./dist/index.js";
      
      const app = new App({ cookieSecret: "test-secret-key-at-least-32-bytes-long-123456" });
      
      app.get("/", () => "Hello from Node");
      app.get("/users/:id", (ctx) => ({ id: ctx.params.id }));
      app.post("/echo", async (ctx) => await ctx.json());
      app.get("/cookie", (ctx) => {
        ctx.cookies.setSigned("session", "user-node");
        return "cookie-set";
      });
      app.get("/get-cookie", (ctx) => {
        return ctx.cookies.getSigned("session") || "null";
      });

      app.ws("/ws", {
        open(ws) {
          ws.send("node-ws-ready");
        },
        message(ws, msg) {
          ws.send("echo:" + msg);
        }
      });

      const server = app.listen(0);
      setTimeout(() => {
        console.log("PORT:" + server.port);
      }, 50);
    `;

		await Bun.write(jsPath, scriptContent);

		const proc = Bun.spawn(["node", jsPath], {
			stdout: "pipe",
			stderr: "pipe",
		});

		const reader = proc.stdout.getReader();
		const decoder = new TextDecoder();
		let output = "";

		const timeout = setTimeout(() => {
			proc.kill();
		}, 6000);

		let port = 0;
		try {
			while (true) {
				const { value, done } = await reader.read();
				if (done) break;
				output += decoder.decode(value, { stream: true });
				const match = output.match(/PORT:(\d+)/);
				if (match) {
					port = Number(match[1]);
					break;
				}
			}
		} finally {
			clearTimeout(timeout);
		}

		expect(port).toBeGreaterThan(0);

		try {
			const res1 = await fetchWithRetry(`http://localhost:${port}/`);
			expect(res1.status).toBe(200);
			expect(await res1.text()).toBe("Hello from Node");

			const res2 = await fetch(`http://localhost:${port}/users/99`);
			expect(res2.status).toBe(200);
			expect(await res2.json()).toEqual({ id: "99" });

			const res3 = await fetch(`http://localhost:${port}/echo`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ test: true }),
			});
			expect(res3.status).toBe(200);
			expect(await res3.json()).toEqual({ test: true });

			const res4 = await fetch(`http://localhost:${port}/cookie`);
			expect(res4.status).toBe(200);
			const cookieHeader = res4.headers.get("set-cookie");
			expect(cookieHeader).toContain("session=");

			const res5 = await fetch(`http://localhost:${port}/get-cookie`, {
				headers: { cookie: cookieHeader!.split(";")[0]! },
			});
			expect(res5.status).toBe(200);
			expect(await res5.text()).toBe("user-node");

			const wsHandshakePromise = new Promise<string>((resolve, reject) => {
				const client = connect(port, "127.0.0.1", () => {
					client.write(
						"GET /ws HTTP/1.1\r\n" +
							"Host: localhost\r\n" +
							"Upgrade: websocket\r\n" +
							"Connection: Upgrade\r\n" +
							"Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
							"Sec-WebSocket-Version: 13\r\n\r\n",
					);
				});

				let data = "";
				client.on("data", (chunk) => {
					data += chunk.toString("latin1");
					if (data.includes("\r\n\r\n")) {
						client.destroy();
						resolve(data);
					}
				});
				client.on("error", reject);
				setTimeout(() => {
					client.destroy();
					reject(new Error("WebSocket handshake timeout"));
				}, 2000);
			});

			const handshake = await wsHandshakePromise;
			expect(handshake).toContain("101 Switching Protocols");
			expect(handshake).toContain(
				"Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=",
			);
		} finally {
			proc.kill();
			await proc.exited;
			await unlink(jsPath).catch(() => {});
		}
	});
});
