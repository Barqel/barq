import crypto from "node:crypto";
import http from "node:http";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type { Server } from "bun";
import { App } from "../app";

const isNode = typeof Bun === "undefined";

if (isNode) {
  if (typeof (globalThis as Record<string, unknown>).Bun === "undefined") {
    Object.defineProperty(globalThis, "Bun", {
      configurable: true,
      value: {
        env: process.env,
        CryptoHasher: class {
          private hmac: crypto.Hmac;
          constructor(_algo: string, secret: string) {
            this.hmac = crypto.createHmac("sha256", secret);
          }
          update(data: string) {
            this.hmac.update(data);
            return this;
          }
          digest(encoding: crypto.BinaryToTextEncoding) {
            return this.hmac.digest(encoding);
          }
        },
      },
    });
  }

  App.prototype.listen = function (port?: number) {
    // biome-ignore lint/complexity/useLiteralKeys: Access private members outside the class.
    const rawPort = port ?? this["_options"]?.port ?? 3000;
    // biome-ignore lint/complexity/useLiteralKeys: Access private members outside the class.
    const hostname = this["_options"]?.hostname ?? "0.0.0.0";

    const listenPort =
      rawPort === 0 ? Math.floor(Math.random() * 20000) + 30000 : rawPort;

    const server = http.createServer(
      async (req: http.IncomingMessage, res: http.ServerResponse) => {
        try {
          const protocol = (req.socket as { encrypted?: boolean })?.encrypted
            ? "https"
            : "http";
          const host = req.headers.host || "localhost";
          const url = `${protocol}://${host}${req.url || "/"}`;
          const method = req.method || "GET";

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
            // @ts-expect-error - duplex is required for streaming in Node.js
            duplex: "half",
          });

          const remoteIp = req.socket.remoteAddress || "";

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

    return {
      port: listenPort,
      hostname,
      stop: () =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
          if (typeof server.closeAllConnections === "function") {
            server.closeAllConnections();
          }
        }),
    } as unknown as Server<unknown>;
  };
}
