# Barq vs Elysia benchmark

This is a standalone Bun project for comparing Barq with Elysia. Its only connection to the parent checkout is a direct import of Barq's source; benchmark code and dependencies stay in this directory. Both servers are implemented independently and expose the same routes and response bodies.

## Requirements

- Bun 1.1 or newer.
- The Barq source checkout containing this directory.
- `bench:oha` downloads and verifies the official `oha` release automatically when it is not already on `PATH` (Linux/macOS x64 and ARM64).

## Install and run

From this directory:

```sh
bun install
bun run bench
```

The default run measures both frameworks for three rounds, with 16 concurrent clients and five seconds per route per round. Each benchmark run starts one server at a time, checks that all routes return identical expected responses, warms each route for one second, then measures it. Framework order alternates between rounds.

Tune the run with:

```sh
bun run bench -- --duration 10 --concurrency 32 --rounds 5
bun run bench -- --framework barq
bun run bench -- --framework elysia
```

`--duration` accepts 1–300 seconds, `--concurrency` accepts 1–1024 clients, and `--rounds` accepts 1–20. Set `BARQ_PORT` or `ELYSIA_PORT` if the default ports (3100 and 3101) are occupied.

## External load generation with oha

For throughput comparisons, prefer `oha` so request generation does not run in Bun beside the server. Run:

```sh
bun run bench:oha -- --duration 30 --concurrency 500 --rounds 10
```

Use a single route for a focused run:

```sh
bun run bench:oha -- --framework both --scenario plain-text --duration 30 --concurrency 500 --rounds 10
```

On Linux/WSL2, optionally pin the servers and load generator to separate CPU sets:

```sh
bun run bench:oha -- --scenario plain-text --duration 30 --concurrency 500 --rounds 10 --server-cpus 2-7 --client-cpus 0-1
```

If `oha` is not already on `PATH`, the runner downloads the latest official release into the ignored `.bin/` directory and verifies it against the SHA-256 digest published by the GitHub release API before execution. An existing `oha` on `PATH` takes precedence. The oha runner starts each selected server once and keeps it running throughout the rounds, alternates framework order per round, checks every route's status/body before measuring, warms each selected endpoint, and records oha's JSON metrics to `results/benchmark-oha-*.json` and `.csv`. Omit `--latency-correction` unless using oha's rate limiter (`-q`); it has no effect in an unrestricted throughput run. The existing `bench` command remains available as a lightweight Bun-client smoke benchmark, but its in-process client can limit throughput measurements.

`bench:oha` accepts `--duration` (1–300 seconds), `--concurrency` (1–4096), `--rounds` (1–20), `--framework` (`barq`, `elysia`, or `both`), and `--scenario` (`all` or a scenario name). `--server-cpus` and `--client-cpus` accept Linux CPU lists such as `2-7` or `0-1,4`; pinning is optional and requires `taskset`.

## Scenarios

| Scenario | Work measured |
| --- | --- |
| `plain-text` | Static text response |
| `static-json` | Static JSON serialization |
| `route-parameter` | Named path parameter extraction and JSON response |
| `query-parameters` | Query parsing, conversion, and JSON response |
| `json-request-body` | JSON body parsing and response serialization |

The in-process `bench` uses Bun's `fetch` from the same machine. It reports completed requests per second, non-success responses, request errors, and sampled p50/p95/p99 end-to-end latency. Latency sampling uses a bounded reservoir of at most 50,000 observations per measurement to limit memory use. Results include each round; the console summary shows median throughput across rounds.

Raw JSON and CSV reports are written to the ignored `results/` directory. Keep the Bun version, machine load, power profile, and benchmark options consistent when comparing runs. These measurements are local microbenchmarks, not a substitute for production workload tests; the built-in client shares machine resources with the server and can become the bottleneck.
