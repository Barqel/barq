import http from "node:http";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type { Server } from "bun";
import { App } from "./app";

const isNode = typeof Bun === "undefined";

if (isNode) {
  App.prototype.listen = function (port?: number) {
    // biome-ignore lint/complexity/useLiteralKeys: Access private members outside the class.
    const listenPort = port ?? this["_options"]?.port ?? 3000;
    // biome-ignore lint/complexity/useLiteralKeys: Access private members outside the class.
    const hostname = this["_options"]?.hostname ?? "0.0.0.0";

    const server = http.createServer(
      async (req: http.IncomingMessage, res: http.ServerResponse) => {
        try {
          const protocol = "http";
          const host = req.headers.host || "localhost";
          const url = `${protocol}://${host}${req.url || "/"}`;
          const method = req.method || "GET";

          // تحويل الطلب بـ Zero-Copy باستخدام النواة الأصلية (C++)
          let reqBody: ReadableStream<Uint8Array> | undefined;
          if (method !== "GET" && method !== "HEAD") {
            reqBody = Readable.toWeb(
              req,
            ) as unknown as ReadableStream<Uint8Array>;
          }

          const webReq = new Request(url, {
            method,
            headers: req.headers as HeadersInit,
            body: reqBody,
            // @ts-expect-error - duplex مطلوب للتدفق في Node.js
            duplex: "half",
          });

          const remoteIp = req.socket.remoteAddress || "";

          // استمرار العمل مع معالج Barq الداخلي مباشرة
          // biome-ignore lint/complexity/useLiteralKeys: Access private members outside the class.
          const webRes = await this["handle"](webReq, {
            requestIP: () => (remoteIp ? { address: remoteIp } : null),
          } as unknown as Server<unknown>);

          res.statusCode = webRes.status;
          res.statusMessage = webRes.statusText;

          webRes.headers.forEach((val, key) => {
            res.setHeader(key, val);
          });

          if (!webRes.body) {
            res.end();
            return;
          }

          // استخدام C++ Pipe للسرعة القصوى بدون حلقات JS تستهلك الذاكرة
          const nodeStream = Readable.fromWeb(
            webRes.body as unknown as NodeReadableStream<Uint8Array>,
          );
          nodeStream.pipe(res);
        } catch (err) {
          console.error("Barq Node Adapter Error:", err);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end('{"error":"Internal Server Error"}');
          }
        }
      },
    );

    server.listen(listenPort, hostname);

    const address = server.address() as {
      port: number;
      address: string;
    } | null;
    const actualPort = address ? address.port : listenPort;

    console.log(
      `⚡ Barq (Node.js C++ Stream Mode) listening on http://${hostname}:${actualPort}`,
    );

    return {
      port: actualPort,
      hostname,
      stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
    } as unknown as Server<unknown>;
  };
}
