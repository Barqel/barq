// Response-construction shapes, measured the way the server actually uses them:
// construct, then fully consume the body (as Bun does when writing to a socket).
const json = '{"id":"42","name":"Ada"}';
const PLAIN = Object.freeze({
  "content-type": "application/json; charset=utf-8",
});
const HDRS = new Headers(PLAIN);
const INIT = Object.freeze({ headers: HDRS });
const bytes = new TextEncoder().encode(json);
const blob = new Blob([json]);
const N = 200_000;

async function bench(name: string, make: () => Response) {
  for (let i = 0; i < 20_000; i++) await make().arrayBuffer();
  let best = Number.POSITIVE_INFINITY;
  for (let rep = 0; rep < 5; rep++) {
    const t0 = Bun.nanoseconds();
    for (let i = 0; i < N; i++) {
      const r = make();
      await r.arrayBuffer();
    }
    const ns = (Bun.nanoseconds() - t0) / N;
    if (ns < best) best = ns;
  }
  console.log(`${name.padEnd(46)} ${best.toFixed(0)} ns/req`);
  return best;
}

const _baseline = await bench(
  "baseline (no body work)",
  () => new Response(null),
);
await bench("new Response(json)  [no headers]", () => new Response(json));
await bench(
  "new Response(json, {headers: PLAIN_OBJ})",
  () => new Response(json, { headers: PLAIN }),
);
await bench(
  "new Response(json, {headers: Headers})",
  () => new Response(json, { headers: HDRS }),
);
await bench("new Response(json, INIT_FROZEN)", () => new Response(json, INIT));
await bench(
  "new Response(json, {headers:[]})",
  () => new Response(json, { headers: [] }),
);
await bench(
  "new Response(blob, {headers: HDRS})",
  () => new Response(blob, { headers: HDRS }),
);
await bench(
  "new Response(bytes, {headers: HDRS})",
  () => new Response(bytes, { headers: HDRS }),
);
await bench("Response.json(obj)", () =>
  Response.json({ id: "42", name: "Ada" }),
);

// Does reusing one Headers object across many Responses stay correct?
const reused = new Headers(PLAIN);
let ok = true;
for (let i = 0; i < 5; i++) {
  const r = new Response(json, { headers: reused });
  const ct = r.headers.get("content-type");
  if (ct !== "application/json; charset=utf-8") ok = false;
  r.headers.set("content-type", "text/evil");
  if (reused.get("content-type") !== "application/json; charset=utf-8")
    ok = false;
}
console.log("\nshared-Headers isolation is safe:", ok);
process.exit(0);
