# Benchmarks

## Methodology

`bun run bench` (`benchmarks/run.ts`) compares four libraries on the **same
workloads and the same data**, each on its **own isolated in-memory SQLite
database** so no run can warm a cache for another:

- **raw `bun:sqlite`** — prepared statements, the floor to compare against.
- **Kysely** — through the same driver the ORM uses internally.
- **Drizzle 0.45** (`drizzle-orm/bun-sqlite`).
- **Barq ORM** — row path for CRUD workloads plus model path where noted.

Schema: `users(id, name, email, age, active)` and
`posts(id, userId, title, views)` with an index on `posts(userId)`; seeded with
100 users and 10 posts each (1,000 posts).

Protocol per workload and library:

1. One **sanity verification** run asserts the result shape (rows returned,
   counts, eager-loaded children) — a library cannot win by returning nothing.
2. 50 **warmup** operations.
3. 5 timed rounds of N operations each; the **median round** is reported
   because the median is robust to occasional GC/scheduler spikes.
4. Result: `ops/s = iterations / median(round duration)`.

The numbers below come from one machine (Linux, Bun 1.4.2, Node 24) and one
run; treat them as a relative comparison, not absolute limits. Reproduce with
`bun run bench --json benchmarks/results.json` — the raw JSON is committed at
[`benchmarks/results.json`](../benchmarks/results.json).

## Results

| Workload | raw `bun:sqlite` | Kysely | Drizzle | Barq ORM |
| --- | ---: | ---: | ---: | ---: |
| selectByPk | 866,170 ops/s | 89,571 | 25,199 | 32,165 |
| selectMany50 | 40,607 | 25,477 | 10,887 | 16,907 |
| countPosts | 1,614,763 | 88,537 | 55,102 | 71,056 |
| insertOne | 416,270 | 65,711 | 34,287 | 44,991 |
| updateOne | 1,036,127 | 111,441 | 36,784 | 52,322 |
| eager10 (10 users + 100 posts) | 14,794 | 11,773 | 5,060 | 3,013 |
| hydrate100 | 22,837 | 15,628 | 7,085 | 10,698 |
| modelFind (Barq models) | — | — | — | 31,115 |
| modelEager10 (Barq models) | — | — | — | 3,242 |

## Reading the results

- The row path stays in the same order of magnitude as Kysely across read and
  write workloads — the ORM adds planning, validation and hydration on top of
  the same compiled SQL.
- The model path (`modelFind`, `modelEager10`) pays for identity hydration,
  casts and dirty tracking; `modelFind` at ~31k ops/s is roughly one third of
  Kysely's `executeTakeFirst`, which is the documented cost of the behavior.
- `eager10` for the ORM includes `.with()` typing work, batched `where in`
  loading and model instantiation for 110 rows; raw/Kysely/Drizzle rows are
  untouched driver objects.
- Drizzle is the slowest of the four in every workload except `eager10` (where
  its two raw result sets beat model hydration slightly); that is a property of
  the measured workloads, not a general claim.

## Caveats

- In-memory SQLite removes network and disk variance; on a real server the
  driver dominates and the differences shrink.
- Sequential `await` per operation measures round-trip latency, not throughput
  under concurrency.
- Only the Bun runtime is benchmarked; the Node path (`node:sqlite`) shares the
  same code and adds nothing to the ORM layer.
