const NULL_BODY_STATUSES: ReadonlySet<number> = new Set([204, 205, 304]);
const DEFAULT_JSON_HEADERS = Object.freeze({
  "content-type": "application/json; charset=utf-8",
});
const DEFAULT_JSON_INIT: ResponseInit = Object.freeze({
  status: 200,
  headers: DEFAULT_JSON_HEADERS,
});
const DEFAULT_TEXT_HEADERS = Object.freeze({
  "content-type": "text/plain; charset=utf-8",
});
export type HeadersInit = NonNullable<ResponseInit["headers"]>;

export function isNullBodyStatus(status: number): boolean {
  return (status >= 100 && status < 200) || NULL_BODY_STATUSES.has(status);
}

function createJsonResponse(data: unknown, init: ResponseInit): Response {
  // Preserve JSON.stringify's empty-body behavior for values that do not
  // produce a JSON value, while using Bun's native serializer otherwise.
  if (
    data === undefined ||
    typeof data === "function" ||
    typeof data === "symbol"
  ) {
    return new Response(JSON.stringify(data), init);
  }
  return Response.json(data, init);
}

export function json(data: unknown, init?: number | ResponseInit): Response {
  if (init === undefined) {
    if (typeof data === "object" && data !== null) {
      return new Response(JSON.stringify(data), DEFAULT_JSON_INIT);
    }
    return createJsonResponse(data, DEFAULT_JSON_INIT);
  }

  if (typeof init === "number") {
    if (isNullBodyStatus(init)) {
      return new Response(null, { status: init });
    }
    return createJsonResponse(data, {
      status: init,
      headers: DEFAULT_JSON_HEADERS,
    });
  }

  const status = init.status ?? 200;
  if (isNullBodyStatus(status)) {
    return new Response(null, { ...init, status });
  }

  if (init.headers === undefined) {
    return createJsonResponse(data, {
      ...init,
      status,
      headers: DEFAULT_JSON_HEADERS,
    });
  }

  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json; charset=utf-8");
  }
  return createJsonResponse(data, { ...init, status, headers });
}

export function text(body: string, init?: number | ResponseInit): Response {
  if (init === undefined) {
    return new Response(body);
  }

  if (typeof init === "number") {
    if (isNullBodyStatus(init)) {
      return new Response(null, { status: init });
    }
    return new Response(body, {
      status: init,
      headers: DEFAULT_TEXT_HEADERS,
    });
  }

  const status = init.status ?? 200;
  if (isNullBodyStatus(status)) {
    return new Response(null, { ...init, status });
  }

  if (init.headers === undefined) {
    return new Response(body, {
      ...init,
      status,
      headers: DEFAULT_TEXT_HEADERS,
    });
  }

  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "text/plain; charset=utf-8");
  }
  return new Response(body, { ...init, status, headers });
}

export function empty(status = 204, headers?: HeadersInit): Response {
  const init: ResponseInit =
    headers !== undefined ? { status, headers } : { status };
  return new Response(null, init);
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: This regex detects control characters in redirect targets.
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

const ALLOWED_REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export function redirect(
  url: string,
  status = 302,
  allowlist?: ReadonlySet<string>,
): Response {
  if (!ALLOWED_REDIRECT_STATUSES.has(status)) {
    throw new TypeError(
      `redirect status must be one of: ${Array.from(ALLOWED_REDIRECT_STATUSES).join(", ")}`,
    );
  }
  if (CONTROL_CHARS.test(url) || url.includes("\\")) {
    throw new TypeError(
      "redirect target contains control or backslash characters",
    );
  }
  if (url.charCodeAt(0) === 47) {
    if (url.charCodeAt(1) === 47) {
      throw new TypeError("redirect target must not be protocol-relative");
    }
  } else {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new TypeError(
        "redirect target must be a root-relative path or an absolute URL",
      );
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new TypeError(
        `redirect target protocol is not allowed: ${parsed.protocol}`,
      );
    }
    const host = parsed.host.toLowerCase();
    if (allowlist !== undefined && !allowlist.has(host)) {
      throw new TypeError(`redirect target host is not allowlisted: ${host}`);
    }
  }
  const res = new Response(null, { status });
  res.headers.set("location", url);
  return res;
}
