// Drives oha against /old and /new alternately and reports medians.
const exe = process.env.OHA ?? "oha";
const port = process.env.PORT ?? "3500";
const base = `http://127.0.0.1:${port}`;
const rounds = Number(process.env.ROUNDS ?? 6);
const duration = process.env.DURATION ?? "10s";
const conc = process.env.CONC ?? "200";

async function run(path: string): Promise<number> {
  const proc = Bun.spawn(
    [
      exe,
      "--no-tui",
      "--no-color",
      "--output-format",
      "json",
      "-c",
      conc,
      "-z",
      duration,
      `${base}${path}`,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return JSON.parse(out).summary.requestsPerSec;
}

function median(a: number[]) {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const oldR: number[] = [];
const newR: number[] = [];
for (let r = 0; r < rounds; r++) {
  // alternate order to cancel ordering bias
  if (r % 2 === 0) {
    oldR.push(await run("/old/42"));
    newR.push(await run("/new/42"));
  } else {
    newR.push(await run("/new/42"));
    oldR.push(await run("/old/42"));
  }
  console.log(
    `round ${r + 1}: old=${oldR[oldR.length - 1]}  new=${newR[newR.length - 1]}`,
  );
}
const om = median(oldR);
const nm = median(newR);
console.log(`\nmedian OLD (plain object headers): ${om}`);
console.log(`median NEW (Headers instance):     ${nm}`);
console.log(
  `delta: ${(((nm - om) / om) * 100).toFixed(2)}%  (${nm > om ? "NEW faster" : "NEW slower"})`,
);
