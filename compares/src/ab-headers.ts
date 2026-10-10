// Interleaved A/B of barq against itself, to measure the FAST_*_HEADERS change
// without machine-load drift dominating. Both variants run in the SAME process,
// alternating round-robin, so drift hits both equally.

const json = '{"id":"42","name":"Ada"}';
const PLAIN = Object.freeze({
  "content-type": "application/json; charset=utf-8",
});
const HDRS = new Headers(PLAIN);

// The two shapes under test, mirroring app.ts before/after.
const oldShape = () => new Response(json, { headers: PLAIN });
const newShape = () => new Response(json, { headers: HDRS });

const N = 150_000;
const ROUNDS = 9;

async function measure(make: () => Response): Promise<number> {
  for (let i = 0; i < 20_000; i++) await make().arrayBuffer();
  const t0 = Bun.nanoseconds();
  for (let i = 0; i < N; i++) await make().arrayBuffer();
  return (Bun.nanoseconds() - t0) / N;
}

const oldSamples: number[] = [];
const newSamples: number[] = [];
for (let r = 0; r < ROUNDS; r++) {
  // Alternate order each round so any ordering bias cancels.
  if (r % 2 === 0) {
    oldSamples.push(await measure(oldShape));
    newSamples.push(await measure(newShape));
  } else {
    newSamples.push(await measure(newShape));
    oldSamples.push(await measure(oldShape));
  }
}

function median(a: number[]) {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const om = median(oldSamples);
const nm = median(newSamples);
console.log(
  "old (plain object):",
  oldSamples.map((v) => v.toFixed(0)).join(" "),
);
console.log(
  "new (Headers inst):",
  newSamples.map((v) => v.toFixed(0)).join(" "),
);
console.log(
  `\nmedian old = ${om.toFixed(0)} ns   median new = ${nm.toFixed(0)} ns`,
);
console.log(
  `saving = ${(om - nm).toFixed(0)} ns/response (${(((om - nm) / om) * 100).toFixed(1)}%)`,
);
process.exit(0);
