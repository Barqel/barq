// End-to-end A/B server: two dynamic routes that differ ONLY in how the
// content-type header is supplied to `new Response()`.
//   /old -> frozen plain object (barq before the change)
//   /new -> prebuilt Headers instance (barq after the change)
const json = '{"id":"42","name":"Ada"}';
const PLAIN = Object.freeze({
  "content-type": "application/json; charset=utf-8",
});
const HDRS = new Headers(PLAIN);

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3500),
  routes: {
    "/old/:id": (_req: Request) => new Response(json, { headers: PLAIN }),
    "/new/:id": (_req: Request) => new Response(json, { headers: HDRS }),
  },
  fetch: () => new Response("not found", { status: 404 }),
});
console.log(`ready ${server.port}`);
