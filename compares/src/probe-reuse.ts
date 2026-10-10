// Does Bun let us reuse a Headers instance and a prebuilt Response across requests?
const HEADERS_OBJ = Object.freeze({
  "content-type": "application/json; charset=utf-8",
});
const HEADERS = new Headers(HEADERS_OBJ);
const json = '{"id":"42","name":"Ada"}';

const variants: Record<string, (req: Request) => Response> = {
  plainObject: (_req) => new Response(json, { headers: HEADERS_OBJ }),
  headersInstance: (_req) => new Response(json, { headers: HEADERS }),
  noHeaders: (_req) => new Response(json),
  blobBody: (_req) => new Response(new Blob([json]), { headers: HEADERS }),
};

// A variant that returns the SAME Response object every time.
const shared = new Response(json, { headers: HEADERS });
variants.sharedResponse = () => shared;

const names = Object.keys(variants);
const routes: Record<string, unknown> = {};
for (const n of names) {
  routes[`/${n}`] = (req: Request) => variants[n]?.(req);
}
routes["/staticShared"] = shared;

const server = Bun.serve({
  port: 0,
  routes,
  fetch: () => new Response("miss"),
});

const base = `http://localhost:${server.port}`;
console.log("server on", server.port);

for (const n of names) {
  const res = await fetch(`${base}/${n}`);
  const text = await res.text();
  console.log(
    `${n.padEnd(18)} status=${res.status} ct=${res.headers.get("content-type")} body=${JSON.stringify(text)}`,
  );
}

// Hit sharedResponse twice to check the body is still readable.
for (let i = 0; i < 2; i++) {
  const res = await fetch(`${base}/sharedResponse`);
  console.log(
    `sharedResponse #${i}:`,
    res.status,
    JSON.stringify(await res.text()),
  );
}
const stat = await fetch(`${base}/staticShared`);
console.log("staticShared:", stat.status, JSON.stringify(await stat.text()));
server.stop();
