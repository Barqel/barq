import { describe, expect, it } from "bun:test";
import { unlink } from "node:fs/promises";

// دالة مساعدة لعمل إعادة محاولة في حال لم يكتمل إقلاع Node.js
async function fetchWithRetry(
  url: string,
  options?: RequestInit,
  retries = 10,
) {
  let lastError: unknown; // <-- تم تحديد النوع هنا لحل مشكلة Biome
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, options);
      return res;
    } catch (e) {
      lastError = e;
      await Bun.sleep(50); // انتظار 50 ملي ثانية ثم المحاولة مجدداً
    }
  }
  throw lastError;
}

describe("Node.js Compatibility Layer", () => {
  it("runs a Barq app successfully under Node.js with routes, json, params, and signed cookies", async () => {
    const buildProc = Bun.spawn(["bun", "run", "build"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const buildExit = await buildProc.exited;
    if (buildExit !== 0) {
      const errText = await new Response(buildProc.stderr).text();
      throw new Error(`Build failed with code ${buildExit}: ${errText}`);
    }

    const jsPath = `./tmp_node_test_${Math.random().toString(36).slice(2)}.js`;

    const scriptContent = `
      import { App } from "./dist/index.js";
      
      const app = new App({ cookieSecret: "test-secret-key-at-least-32-bytes-long-123456" });
      
      app.get("/", (ctx) => "Hello from Node");
      app.get("/users/:id", (ctx) => ({ id: ctx.params.id }));
      app.post("/echo", async (ctx) => await ctx.json());
      app.get("/cookie", (ctx) => {
        ctx.cookies.setSigned("session", "user-node");
        return "cookie-set";
      });
      app.get("/get-cookie", (ctx) => {
        return ctx.cookies.getSigned("session") || "null";
      });

      const server = app.listen(0);
      // إضافة تأخير بسيط لضمان اكتمال حجز المنفذ في Node.js
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
    }, 5000);

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

    if (port === 0) {
      const errReader = proc.stderr.getReader();
      const errVal = await errReader.read();
      const errText = decoder.decode(errVal.value);
      console.error("NODE STDERR:", errText);
    }

    expect(port).toBeGreaterThan(0);

    try {
      // استخدام دالة إعادة المحاولة للطلب الأول فقط ريثما يجهز السيرفر
      const res1 = await fetchWithRetry(`http://localhost:${port}/`);
      expect(res1.status).toBe(200);
      expect(await res1.text()).toBe("Hello from Node");

      // بمجرد نجاح الطلب الأول، أصبح السيرفر جاهزاً تماماً للطلبات المتبقية
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
    } finally {
      proc.kill();
      await proc.exited;
      await unlink(jsPath).catch(() => {});
    }
  });
});
