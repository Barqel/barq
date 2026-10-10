// Is oha the bottleneck? If two concurrent oha runs against the bare server
// give the SAME total throughput as one, the client is the limiter.
const exe = process.env.OHA ?? "oha";
const duration = process.env.DURATION ?? "8s";
const conc = process.env.CONC ?? "200";
const url = `http://127.0.0.1:${process.env.PORT ?? 3600}/users/42`;

async function run(): Promise<number> {
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
      url,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return JSON.parse(out).summary.requestsPerSec;
}

// warmup
await run();

const one = await run();
console.log(`1x oha : ${one.toFixed(0)} req/s`);

const two = await Promise.all([run(), run()]);
console.log(
  `2x oha : ${two[0]?.toFixed(0)} + ${two[1]?.toFixed(0)} = ${((two[0] ?? 0) + (two[1] ?? 0)).toFixed(0)} req/s total`,
);

const three = await Promise.all([run(), run(), run()]);
const sum3 = three.reduce((a, b) => a + b, 0);
console.log(
  `3x oha : ${three.map((v) => v.toFixed(0)).join(" + ")} = ${sum3.toFixed(0)} req/s total`,
);

console.log(
  `\nIf total stays ~flat as clients multiply, the LOAD GENERATOR (or machine) is the cap, not the server.`,
);
