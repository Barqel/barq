import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { type Scenario, scenarios } from "./scenarios";

type SupportedFramework = "barq" | "elysia";

interface Options {
  duration: number;
  concurrency: number;
  rounds: number;
  framework: SupportedFramework | "both";
}

interface Measurement {
  framework: SupportedFramework;
  scenario: string;
  round: number;
  requests: number;
  requestsPerSecond: number;
  nonSuccessResponses: number;
  errors: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  elapsedSeconds: number;
}

const maxLatencySamples = 50_000;
const compareDir = resolve(import.meta.dir, "..");
const rootDir = resolve(compareDir, "..");

function parseOptions(args: string[]): Options {
  const values: Record<string, string> = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg?.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg ?? ""}`);
    }
    const key = arg.slice(2);
    const value = args[++index];
    if (!value || value.startsWith("--")) {
      throw new Error(`Expected a value after --${key}`);
    }
    values[key] = value;
  }

  const duration = Number(values.duration ?? 5);
  const concurrency = Number(values.concurrency ?? 16);
  const rounds = Number(values.rounds ?? 3);
  const framework = values.framework ?? "both";

  if (!Number.isFinite(duration) || duration < 1 || duration > 300) {
    throw new RangeError("--duration must be between 1 and 300 seconds");
  }
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 1024) {
    throw new RangeError("--concurrency must be an integer between 1 and 1024");
  }
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 20) {
    throw new RangeError("--rounds must be an integer between 1 and 20");
  }
  if (framework !== "barq" && framework !== "elysia" && framework !== "both") {
    throw new Error("--framework must be barq, elysia, or both");
  }

  return { duration, concurrency, rounds, framework };
}

function percentile(samples: number[], fraction: number): number {
  if (samples.length === 0) return 0;
  samples.sort((left, right) => left - right);
  return samples[Math.ceil(fraction * samples.length) - 1] ?? 0;
}

function addReservoirSample(
  samples: number[],
  value: number,
  count: number,
): void {
  if (samples.length < maxLatencySamples) {
    samples.push(value);
    return;
  }
  const slot = Math.floor(Math.random() * count);
  if (slot < maxLatencySamples) samples[slot] = value;
}

async function startServer(
  framework: SupportedFramework,
  port: number,
): Promise<{
  baseUrl: string;
  stop: () => Promise<void>;
}> {
  const entrypoint = framework === "barq" ? "src/barq.ts" : "src/elysia.ts";
  const child = Bun.spawn(["bun", "run", entrypoint], {
    cwd: compareDir,
    env: { ...Bun.env, PORT: String(port) },
    stdout: "pipe",
    stderr: "pipe",
  });
  const output: string[] = [];
  const collect = async (stream: ReadableStream<Uint8Array>) => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      output.push(decoder.decode(value, { stream: true }));
    }
  };
  const outputTasks = Promise.all([
    collect(child.stdout),
    collect(child.stderr),
  ]);
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = performance.now() + 10_000;

  while (performance.now() < deadline) {
    if (child.exitCode !== null) {
      await outputTasks;
      throw new Error(
        `${framework} server exited with code ${child.exitCode}:\n${output.join("")}`,
      );
    }
    try {
      const response = await fetch(`${baseUrl}/health`, {
        signal: AbortSignal.timeout(500),
      });
      if (response.status === 200 && (await response.text()) === "ok") {
        return {
          baseUrl,
          stop: async () => {
            child.kill();
            await child.exited;
            await outputTasks;
          },
        };
      }
    } catch {
      await Bun.sleep(50);
    }
  }

  child.kill();
  await child.exited;
  await outputTasks;
  throw new Error(
    `Timed out starting ${framework} on port ${port}:\n${output.join("")}`,
  );
}

async function request(baseUrl: string, scenario: Scenario): Promise<Response> {
  return fetch(`${baseUrl}${scenario.path}`, {
    method: scenario.method,
    headers: scenario.body ? { "content-type": "application/json" } : undefined,
    body: scenario.body,
  });
}

async function verifyRoutes(baseUrl: string): Promise<void> {
  for (const scenario of scenarios) {
    const response = await request(baseUrl, scenario);
    const body = await response.text();
    if (
      response.status !== scenario.expectedStatus ||
      body !== scenario.expectedBody
    ) {
      throw new Error(
        `Smoke test failed for ${scenario.name}: got ${response.status} ${JSON.stringify(body)}, expected ${scenario.expectedStatus} ${JSON.stringify(scenario.expectedBody)}`,
      );
    }
  }
}

async function runLoad(
  baseUrl: string,
  scenario: Scenario,
  durationSeconds: number,
  concurrency: number,
  collectMetrics: boolean,
): Promise<{
  requests: number;
  nonSuccessResponses: number;
  errors: number;
  samples: number[];
  elapsedSeconds: number;
}> {
  const samples: number[] = [];
  let requests = 0;
  let nonSuccessResponses = 0;
  let errors = 0;
  const startedAt = performance.now();
  const deadline = startedAt + durationSeconds * 1000;
  let reservoirCount = 0;

  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (performance.now() < deadline) {
        const requestStartedAt = performance.now();
        try {
          const response = await request(baseUrl, scenario);
          await response.arrayBuffer();
          requests++;
          if (!response.ok) nonSuccessResponses++;
          if (collectMetrics) {
            reservoirCount++;
            addReservoirSample(
              samples,
              performance.now() - requestStartedAt,
              reservoirCount,
            );
          }
        } catch {
          requests++;
          errors++;
          if (collectMetrics) {
            reservoirCount++;
            addReservoirSample(
              samples,
              performance.now() - requestStartedAt,
              reservoirCount,
            );
          }
        }
      }
    }),
  );

  const elapsedSeconds = (performance.now() - startedAt) / 1000;
  return {
    requests,
    nonSuccessResponses,
    errors,
    samples,
    elapsedSeconds,
  };
}

function csvEscape(value: string | number): string {
  const text = String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function median(values: number[]): number {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  if (ordered.length % 2 === 1) return ordered[middle] ?? 0;
  return ((ordered[middle - 1] ?? 0) + (ordered[middle] ?? 0)) / 2;
}

async function main(): Promise<void> {
  const options = parseOptions(Bun.argv.slice(2));

  const frameworks: SupportedFramework[] =
    options.framework === "both" ? ["barq", "elysia"] : [options.framework];
  const measurements: Measurement[] = [];
  const ports: Record<SupportedFramework, number> = {
    barq: Number(Bun.env.BARQ_PORT ?? 3100),
    elysia: Number(Bun.env.ELYSIA_PORT ?? 3101),
  };

  for (let round = 1; round <= options.rounds; round++) {
    const order = round % 2 === 1 ? frameworks : [...frameworks].reverse();
    for (const framework of order) {
      const server = await startServer(framework, ports[framework]);
      try {
        await verifyRoutes(server.baseUrl);
        for (const scenario of scenarios) {
          await runLoad(
            server.baseUrl,
            scenario,
            1,
            options.concurrency,
            false,
          );
          const result = await runLoad(
            server.baseUrl,
            scenario,
            options.duration,
            options.concurrency,
            true,
          );
          const measurement: Measurement = {
            framework,
            scenario: scenario.name,
            round,
            requests: result.requests,
            requestsPerSecond: result.requests / result.elapsedSeconds,
            nonSuccessResponses: result.nonSuccessResponses,
            errors: result.errors,
            p50Ms: percentile(result.samples, 0.5),
            p95Ms: percentile(result.samples, 0.95),
            p99Ms: percentile(result.samples, 0.99),
            elapsedSeconds: result.elapsedSeconds,
          };
          measurements.push(measurement);
          console.log(
            `${framework.padEnd(6)} round ${round} ${scenario.name.padEnd(20)} ${measurement.requestsPerSecond.toFixed(0).padStart(8)} req/s  p50 ${measurement.p50Ms.toFixed(2)} ms  p99 ${measurement.p99Ms.toFixed(2)} ms`,
          );
        }
      } finally {
        await server.stop();
      }
    }
  }

  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const resultsDir = resolve(compareDir, "results");
  await mkdir(resultsDir, { recursive: true });
  const csvHeader = [
    "framework",
    "scenario",
    "round",
    "requests",
    "requests_per_second",
    "non_success_responses",
    "errors",
    "p50_ms",
    "p95_ms",
    "p99_ms",
    "elapsed_seconds",
  ];
  const csvRows = measurements.map((item) =>
    [
      item.framework,
      item.scenario,
      item.round,
      item.requests,
      item.requestsPerSecond.toFixed(3),
      item.nonSuccessResponses,
      item.errors,
      item.p50Ms.toFixed(3),
      item.p95Ms.toFixed(3),
      item.p99Ms.toFixed(3),
      item.elapsedSeconds.toFixed(3),
    ]
      .map(csvEscape)
      .join(","),
  );
  const jsonPath = resolve(resultsDir, `benchmark-${timestamp}.json`);
  const csvPath = resolve(resultsDir, `benchmark-${timestamp}.csv`);
  const rootPackage = JSON.parse(
    await readFile(resolve(rootDir, "package.json"), "utf8"),
  ) as { version: string };
  const localPackage = JSON.parse(
    await readFile(
      resolve(compareDir, "node_modules/elysia/package.json"),
      "utf8",
    ),
  ) as { version: string };
  const report = {
    createdAt: new Date().toISOString(),
    machine: {
      platform: process.platform,
      architecture: process.arch,
      bunVersion: Bun.version,
    },
    versions: { barq: rootPackage.version, elysia: localPackage.version },
    configuration: options,
    measurements,
  };

  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(csvPath, `${csvHeader.join(",")}\n${csvRows.join("\n")}\n`);

  console.log(`\nDetailed results: ${jsonPath}`);
  console.log(`CSV results:      ${csvPath}`);
  for (const scenario of scenarios) {
    const medians = frameworks.map((framework) => {
      const runs = measurements.filter(
        (item) =>
          item.framework === framework && item.scenario === scenario.name,
      );
      return `${framework} ${median(runs.map((item) => item.requestsPerSecond)).toFixed(0)} req/s`;
    });
    console.log(`${scenario.name}: ${medians.join(" | ")}`);
  }
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
