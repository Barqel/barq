const exe = process.env.OHA ?? "oha";
const roundR = Number(process.env.ROUNDS ?? 5);
const duration = process.env.DURATION ?? "8s";
const conc = process.env.CONC ?? "200";

const targets = [
  { name: "bare", port: 3600 },
  { name: "barq", port: 3601 },
  { name: "elysia", port: 3602 },
];

async function run(port: number): Promise<number> {
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
      `http://127.0.0.1:${port}/users/42`,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return JSON.parse(out).summary.requestsPerSec;
}

const results: Record<string, number[]> = Object.fromEntries(
  targets.map((t) => [t.name, [] as number[]]),
);

for (let r = 0; r < roundR; r++) {
  const order = r % 2 === 0 ? targets : [...targets].reverse();
  for (const t of order) {
    const v = await run(t.port);
    results[t.name]?.push(v);
    console.log(`round ${r + 1} ${t.name.padEnd(7)} ${v.toFixed(0)}`);
  }
}

function median(a: number[]) {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
console.log("");
for (const t of targets) {
  console.log(
    `${t.name.padEnd(8)} median ${median(results[t.name] ?? []).toFixed(0)} req/s`,
  );
}
