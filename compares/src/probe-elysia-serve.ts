// Intercept the code Elysia compiles for its route handler.
const origFunction = Function;
const captured: string[] = [];
// @ts-expect-error test shim
// biome-ignore lint/suspicious/noGlobalAssign: test shim to intercept Function constructor
Function = new Proxy(origFunction, {
  apply(_t, _this, args: unknown[]) {
    const body = args[args.length - 1];
    if (typeof body === "string" && body.includes("params"))
      captured.push(body);
    // @ts-expect-error test shim
    return origFunction(...(args as []));
  },
  construct(_t, args: unknown[]) {
    const body = args[args.length - 1];
    if (typeof body === "string" && body.includes("params"))
      captured.push(body);
    // @ts-expect-error test shim
    return new origFunction(...(args as []));
  },
});

const { Elysia } = await import("elysia");
const app = new Elysia().get("/users/:id", ({ params }) => ({
  id: params.id,
  name: "Ada",
}));
const origServe = Bun.serve;
let serveOpts: Record<string, unknown> = null;
(Bun as Record<string, unknown>).serve = (opts: Record<string, unknown>) => {
  serveOpts = opts;
  return {
    port: 1,
    stop() {},
    requestIP: () => null,
    upgrade: () => false,
    timeout() {},
    reload() {},
  };
};
try {
  (app as Record<string, unknown>).listen(0);
} catch {}
(Bun as Record<string, unknown>).serve = origServe;

const t =
  serveOpts.routes instanceof Map
    ? [...serveOpts.routes.entries()]
    : Object.entries(serveOpts.routes);
const lazy = (t[0][1] as Record<string, unknown>).GET;
const fakeReq = new Request("http://localhost/users/42");
(fakeReq as Record<string, unknown>).params = { id: "42" };
const res = await lazy(fakeReq);
console.log(
  "status:",
  res.status,
  "| ct:",
  res.headers.get("content-type"),
  "| body:",
  await res.text(),
);

console.log(`\n===== captured ${captured.length} compiled snippets =====`);
for (const c of captured) {
  if (c.includes("mapCompactResponse") || c.includes("params")) {
    console.log(c.slice(0, 3000));
    console.log("-----");
  }
}
