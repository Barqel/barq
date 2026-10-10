// Break down the per-request JS cost precisely.
import { App } from "../../src/index";

const N = 400_000;

let barqOpts: Record<string, unknown> = null;
const barqApp = new App();
barqApp.get("/users/:id", (ctx) => ({ id: ctx.params.id, name: "Ada" }));
const origServe = Bun.serve;
(Bun as Record<string, unknown>).serve = (opts: Record<string, unknown>) => {
  barqOpts = opts;
  return {
    port: 1,
    stop() {},
    requestIP: () => null,
    upgrade: () => false,
    timeout() {},
    reload() {},
  };
};
barqApp.listen(0);
(Bun as Record<string, unknown>).serve = origServe;
const barqHandler = (barqOpts.routes["/users/:id"] as Record<string, unknown>)
  .GET;

let elyOpts: Record<string, unknown> = null;
const { Elysia } = await import("elysia");
const elyApp = new Elysia().get("/users/:id", ({ params }) => ({
  id: params.id,
  name: "Ada",
}));
(Bun as Record<string, unknown>).serve = (opts: Record<string, unknown>) => {
  elyOpts = opts;
  return {
    port: 1,
    stop() {},
    requestIP: () => null,
    upgrade: () => false,
    timeout() {},
    reload() {},
  };
};
elyApp.listen(0);
(Bun as Record<string, unknown>).serve = origServe;
const elyRoute = (
  elyOpts.routes instanceof Map
    ? [...elyOpts.routes.entries()].find(([k]) => k === "/users/:id")?.[1]
    : elyOpts.routes["/users/:id"]
) as Record<string, unknown>;
const elyHandler = elyRoute.GET;

const mkReq = () => {
  const r = new Request("http://localhost/users/42");
  (r as Record<string, unknown>).params = { id: "42" };
  return r;
};
await elyHandler(mkReq());

async function drain(v: unknown) {
  const r = v instanceof Response ? v : await v;
  await r.arrayBuffer();
}

async function bench(name: string, fn: (r: Request) => unknown) {
  for (let i = 0; i < 30_000; i++) await drain(fn(mkReq()));
  let best = Number.POSITIVE_INFINITY;
  for (let rep = 0; rep < 5; rep++) {
    const t0 = Bun.nanoseconds();
    for (let i = 0; i < N; i++) await drain(fn(mkReq()));
    const ns = (Bun.nanoseconds() - t0) / N;
    if (ns < best) best = ns;
  }
  console.log(`${name.padEnd(34)} ${best.toFixed(0)} ns/req`);
  return best;
}

// Baselines
const base = await bench(
  "baseline: mkReq + drain only",
  () => new Response("x"),
);
const b = await bench("barq handler", barqHandler);
const e = await bench("elysia handler", elyHandler);
console.log(
  `\nnet handler cost:  barq ${(b - base).toFixed(0)} ns  |  elysia ${(e - base).toFixed(0)} ns`,
);

// Now: pure response-construction shapes at this payload
const json = '{"id":"42","name":"Ada"}';
const PLAIN = Object.freeze({
  "content-type": "application/json; charset=utf-8",
});
const HDRS = new Headers(PLAIN);
await bench(
  "shape: new Response(json,{plain})",
  () => new Response(json, { headers: PLAIN }),
);
await bench(
  "shape: new Response(json,{Headers})",
  () => new Response(json, { headers: HDRS }),
);
await bench("shape: Response.json(obj)", () =>
  Response.json({ id: "42", name: "Ada" }),
);
await bench("shape: new Response(json) only", () => new Response(json));
process.exit(0);
