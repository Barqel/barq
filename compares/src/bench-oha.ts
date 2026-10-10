import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { type Framework, type Scenario, scenarios } from "./scenarios";

interface Options {
  duration: number;
  concurrency: number;
  rounds: number;
  framework: string;
  scenario: string | "all";
  serverCpus?: string;
  clientCpus?: string;
  gc: boolean;
}

interface OhaResult {
  summary: { successRate: number; requestsPerSec: number; total: number };
  metrics: {
    success_rate: number;
    requests_per_sec: number;
    latency_ms: { p50: number; p95: number; p99: number };
  };
}

interface Measurement {
  framework: Framework;
  scenario: string;
  round: number;
  oha: OhaResult;
}

const compareDir = resolve(import.meta.dir, "..");
const ohaCacheDir = resolve(compareDir, ".bin");

function parseOptions(args: string[]): Options {
  const values: Record<string, string> = {};
  let gc = true;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg?.startsWith("--"))
      throw new Error(`Unexpected argument: ${arg ?? ""}`);
    const key = arg.slice(2);
    if (key === "no-gc") {
      gc = false;
      continue;
    }
    const value = args[++index];
    if (!value || value.startsWith("--"))
      throw new Error(`Expected a value after --${key}`);
    values[key] = value;
  }

  const duration = Number(values.duration ?? 10);
  const concurrency = Number(values.concurrency ?? 100);
  const rounds = Number(values.rounds ?? 3);
  const framework = values.framework ?? "all";
  const scenario = values.scenario ?? "all";
  const serverCpus = values["server-cpus"];
  const clientCpus = values["client-cpus"];

  const allowed = [
    "barq",
    "elysia",
    "hono",
    "fastify",
    "express",
    "both",
    "all",
  ];
  const reqList = framework.split(",").map((f) => f.trim());
  for (const f of reqList) {
    if (!allowed.includes(f)) {
      throw new Error(
        `Unknown framework: ${f}. Allowed: ${allowed.join(", ")}`,
      );
    }
  }

  return {
    duration,
    concurrency,
    rounds,
    framework,
    scenario,
    serverCpus,
    clientCpus,
    gc,
  };
}

function collect(stream: ReadableStream<Uint8Array>): Promise<string> {
  return (async () => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let output = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return output;
      output += decoder.decode(value, { stream: true });
    }
  })();
}

async function getOhaVersion(executable: string): Promise<string> {
  const child = Bun.spawn([executable, "-V"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    collect(child.stdout),
    collect(child.stderr),
  ]);
  const exitCode = await child.exited;
  if (exitCode !== 0)
    throw new Error(stderr || stdout || `oha -V exited with code ${exitCode}`);
  return `${stdout}${stderr}`.trim();
}

async function checkOha(): Promise<{ executable: string; version: string }> {
  try {
    if (existsSync(ohaCacheDir)) {
      const files = readdirSync(ohaCacheDir, { recursive: true });
      for (const file of files) {
        if (String(file).endsWith("oha") || String(file).endsWith("oha.exe")) {
          const fullPath = resolve(ohaCacheDir, String(file));
          try {
            const version = await getOhaVersion(fullPath);
            console.log(`Using ${version} from ${fullPath}`);
            return { executable: fullPath, version };
          } catch {}
        }
      }
    }
  } catch {}

  const pathExecutable = Bun.which("oha");
  if (pathExecutable) {
    try {
      const version = await getOhaVersion(pathExecutable);
      console.log(`Using ${version} from ${pathExecutable}`);
      return { executable: pathExecutable, version };
    } catch {}
  }

  throw new Error("Could not find oha in .bin or on PATH.");
}

function withTaskset(cpus: string | undefined, command: string[]): string[] {
  return cpus === undefined ? command : ["taskset", "-c", cpus, ...command];
}

async function startServer(
  framework: Framework,
  port: number,
  serverCpus?: string,
): Promise<{ baseUrl: string; stop: () => Promise<void> }> {
  const entrypoints: Record<Framework, string> = {
    barq: "src/barq.ts",
    elysia: "src/elysia.ts",
    hono: "src/hono.ts",
    fastify: "src/fastify.ts",
    express: "src/express.ts",
  };
  const entrypoint = entrypoints[framework];
  const child = Bun.spawn(withTaskset(serverCpus, ["bun", "run", entrypoint]), {
    cwd: compareDir,
    env: { ...Bun.env, PORT: String(port) },
    stdout: "pipe",
    stderr: "pipe",
  });
  const outputTasks = Promise.all([
    collect(child.stdout),
    collect(child.stderr),
  ]);
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = performance.now() + 10_000;

  while (performance.now() < deadline) {
    if (child.exitCode !== null) {
      const output = await outputTasks;
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
  const output = await outputTasks;
  throw new Error(
    `${framework} server failed to become ready:\n${output.join("")}`,
  );
}

async function verifyRoutes(baseUrl: string): Promise<void> {
  for (const scenario of scenarios) {
    const response = await fetch(`${baseUrl}${scenario.path}`, {
      method: scenario.method,
      headers: scenario.body
        ? { "content-type": "application/json" }
        : undefined,
      body: scenario.body,
    });
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

async function runOha(
  executable: string,
  framework: Framework,
  baseUrl: string,
  scenario: Scenario,
  duration: number,
  concurrency: number,
  clientCpus?: string,
): Promise<OhaResult> {
  const args = [
    executable,
    "--no-tui",
    "--no-color",
    "--output-format",
    "json",
    "-c",
    String(concurrency),
    "-z",
    `${duration}s`,
  ];
  if (scenario.method !== "GET") args.push("-m", scenario.method);
  if (scenario.body !== undefined)
    args.push("-H", "content-type: application/json", "-d", scenario.body);
  args.push(`${baseUrl}${scenario.path}`);

  const child = Bun.spawn(withTaskset(clientCpus, args), {
    cwd: compareDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    collect(child.stdout),
    collect(child.stderr),
  ]);
  const exitCode = await child.exited;
  if (exitCode !== 0)
    throw new Error(`oha failed for ${framework}/${scenario.name}: ${stderr}`);

  return JSON.parse(stdout) as OhaResult;
}

function median(values: number[]): number {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  if (ordered.length % 2 === 1) return ordered[middle] ?? 0;
  return ((ordered[middle - 1] ?? 0) + (ordered[middle] ?? 0)) / 2;
}

async function main(): Promise<void> {
  const options = parseOptions(Bun.argv.slice(2));
  const ohaCli = await checkOha();

  let frameworks: Framework[];
  if (options.framework === "all") {
    frameworks = ["elysia", "hono", "fastify", "express", "barq"];
  } else if (options.framework === "both") {
    frameworks = ["elysia", "barq"];
  } else {
    const list = options.framework
      .split(",")
      .map((f) => f.trim()) as Framework[];
    frameworks = list.filter((f) => f !== "barq");
    if (list.includes("barq")) frameworks.push("barq");
  }

  const selectedScenarios =
    options.scenario === "all"
      ? scenarios
      : scenarios.filter((s) => s.name === options.scenario);

  const ports: Record<Framework, number> = {
    barq: Number(Bun.env.BARQ_PORT ?? 3100),
    elysia: Number(Bun.env.ELYSIA_PORT ?? 3101),
    hono: Number(Bun.env.HONO_PORT ?? 3102),
    fastify: Number(Bun.env.FASTIFY_PORT ?? 3103),
    express: Number(Bun.env.EXPRESS_PORT ?? 3104),
  };

  const measurements: Measurement[] = [];

  for (let round = 1; round <= options.rounds; round++) {
    const roundOrder = round % 2 === 1 ? frameworks : [...frameworks].reverse();
    for (const framework of roundOrder) {
      const server = await startServer(
        framework,
        ports[framework],
        options.serverCpus,
      );
      try {
        await verifyRoutes(server.baseUrl);
        for (const scenario of selectedScenarios) {
          const warmupDuration =
            scenario.name === "route-parameter" ||
            scenario.name === "plain-text"
              ? 3
              : 1;
          await runOha(
            ohaCli.executable,
            framework,
            server.baseUrl,
            scenario,
            warmupDuration,
            Math.min(options.concurrency, 64),
            options.clientCpus,
          );
          const result = await runOha(
            ohaCli.executable,
            framework,
            server.baseUrl,
            scenario,
            options.duration,
            options.concurrency,
            options.clientCpus,
          );
          measurements.push({
            framework,
            scenario: scenario.name,
            round,
            oha: result,
          });
          console.log(
            `${framework.padEnd(8)} round ${round} ${scenario.name.padEnd(20)} ${result.metrics.requests_per_sec.toFixed(0).padStart(8)} req/s  p50 ${result.metrics.latency_ms.p50.toFixed(3)} ms  p99 ${result.metrics.latency_ms.p99.toFixed(3)} ms`,
          );
          await Bun.sleep(1500); // Cooldown

          await Bun.sleep(3000);
        }
      } finally {
        await server.stop();
        if (options.gc) {
          Bun.gc(true);
        }
        await Bun.sleep(2500);
      }
    }
  }

  console.log("\n==================== Median ====================");
  for (const scenario of selectedScenarios) {
    const medians = frameworks.map((framework) => {
      const runs = measurements.filter(
        (item) =>
          item.framework === framework && item.scenario === scenario.name,
      );
      return `${framework} ${median(runs.map((item) => item.oha.metrics.requests_per_sec)).toFixed(0)} req/s`;
    });
    console.log(`${scenario.name}: ${medians.join(" | ")}`);
  }
}

await main();
