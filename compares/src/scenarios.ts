export type Framework = "elysia" | "hono" | "fastify" | "express" | "barq";
export const allFrameworks: Framework[] = [
  "elysia",
  "hono",
  "fastify",
  "express",
  "barq",
];

export interface Scenario {
  name: string;
  method: "GET" | "POST";
  path: string;
  body?: string;
  expectedStatus: number;
  expectedBody: string;
}

export const scenarios: Scenario[] = [
  {
    name: "plain-text",
    method: "GET",
    path: "/text",
    expectedStatus: 200,
    expectedBody: "ok",
  },
  {
    name: "static-json",
    method: "GET",
    path: "/json",
    expectedStatus: 200,
    expectedBody: '{"message":"ok","count":42}',
  },
  {
    name: "route-parameter",
    method: "GET",
    path: "/users/42",
    expectedStatus: 200,
    expectedBody: '{"id":"42","name":"Ada"}',
  },
  {
    name: "query-parameters",
    method: "GET",
    path: "/search?q=barq&page=2",
    expectedStatus: 200,
    expectedBody: '{"q":"barq","page":2}',
  },
  {
    name: "json-request-body",
    method: "POST",
    path: "/echo",
    body: '{"name":"Ada","active":true}',
    expectedStatus: 200,
    expectedBody: '{"name":"Ada","active":true}',
  },
];
