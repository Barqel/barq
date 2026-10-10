import { timingSafeEqual } from "node:crypto";
import type { CookieJar, SetCookieOptions } from "./types";

interface PendingCookie {
  name: string;
  headerString: string;
}

interface CookieState {
  cookies: Map<string, string> | null;
  requestHeaders: Headers | undefined;
  pending: PendingCookie[] | null;
}

class CookieJarImpl implements CookieJar {
  private readonly state: CookieState;

  constructor(
    private readonly secret: string,
    requestHeaders?: Headers,
    private readonly onMutation?: () => void,
  ) {
    this.state = { cookies: null, requestHeaders, pending: null };
  }

  get(name: string): string | undefined {
    return getCookies(this.state).get(name);
  }

  getSigned(name: string, customSecret?: string): string | null {
    const signed = getCookies(this.state).get(name);
    if (!signed) return null;
    const signingSecret = customSecret ?? this.secret;
    if (!signingSecret) return null;
    return unsign(signed, signingSecret);
  }

  set(name: string, value: string, options?: SetCookieOptions): void {
    const cookieOptions = snapshotOptions(options);
    validateCookie(name, cookieOptions);
    getCookies(this.state).set(name, value);
    getPending(this.state).push({
      name,
      headerString: buildCookieString(name, value, cookieOptions),
    });
    this.onMutation?.();
  }

  setSigned(
    name: string,
    value: string,
    options?: SetCookieOptions,
    customSecret?: string,
  ): void {
    const signingSecret = customSecret ?? this.secret;
    if (!signingSecret) {
      throw new Error("A non-empty secret is required to set a signed cookie");
    }
    const cookieOptions = snapshotOptions(options);
    validateCookie(name, cookieOptions);
    const signed = sign(value, signingSecret);
    getCookies(this.state).set(name, signed);
    getPending(this.state).push({
      name,
      headerString: buildCookieString(name, signed, cookieOptions),
    });
    this.onMutation?.();
  }

  delete(name: string, options?: SetCookieOptions): void {
    const cookieOptions = snapshotOptions(options);
    validateCookie(name, cookieOptions);
    getCookies(this.state).delete(name);
    getPending(this.state).push({
      name,
      headerString: buildCookieString(name, "", {
        ...cookieOptions,
        maxAge: 0,
        expires: new Date(0),
      }),
    });
    this.onMutation?.();
  }

  hasPending(): boolean {
    return (this.state.pending?.length ?? 0) > 0;
  }

  apply(headers: Headers): void {
    const pending = this.state.pending;
    if (pending === null) return;
    for (const cookie of pending) {
      headers.append("set-cookie", cookie.headerString);
    }
    pending.length = 0;
  }
}

function normalizeSameSite(value: string | undefined): string {
  if (!value) return "Lax";
  const lower = value.toLowerCase();
  if (lower === "strict") return "Strict";
  if (lower === "lax") return "Lax";
  if (lower === "none") return "None";
  return value;
}

function buildCookieString(
  name: string,
  value: string,
  options: SetCookieOptions,
): string {
  validateCookie(name, options);
  let cookie = `${name}=${encodeURIComponent(value)}`;

  if (options.path) cookie += `; Path=${options.path}`;
  if (options.domain) cookie += `; Domain=${options.domain}`;
  if (options.maxAge !== undefined) cookie += `; Max-Age=${options.maxAge}`;
  if (options.expires) cookie += `; Expires=${options.expires.toUTCString()}`;
  if (options.httpOnly !== false) cookie += "; HttpOnly";
  if (options.secure) cookie += "; Secure";
  const sameSite = normalizeSameSite(options.sameSite);
  if (sameSite) cookie += `; SameSite=${sameSite}`;

  return cookie;
}

function sign(value: string, secret: string): string {
  const hasher = new Bun.CryptoHasher("sha256", secret);
  hasher.update(value);
  const sig = hasher.digest("base64url");
  return `${value}.${sig}`;
}

function unsign(signedValue: string, secret: string): string | null {
  const lastDot = signedValue.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === signedValue.length - 1) return null;
  const value = signedValue.slice(0, lastDot);
  const sig = signedValue.slice(lastDot + 1);
  const hasher = new Bun.CryptoHasher("sha256", secret);
  hasher.update(value);
  const expected = hasher.digest("base64url");
  const actualBytes = Buffer.from(sig);
  const expectedBytes = Buffer.from(expected);
  if (actualBytes.length !== expectedBytes.length) return null;
  if (!timingSafeEqual(actualBytes, expectedBytes)) return null;
  return value;
}

function decodeCookieValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // A malformed percent escape is an invalid cookie value, not a request error.
    return value;
  }
}

function validateCookie(name: string, options: SetCookieOptions): void {
  if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name)) {
    throw new TypeError("Cookie name must be a valid HTTP token");
  }
  if (
    options.path !== undefined &&
    (!options.path.startsWith("/") || /[;\r\n\0]/.test(options.path))
  ) {
    throw new TypeError(
      "Cookie path must start with '/' and contain no controls",
    );
  }
  if (
    options.domain !== undefined &&
    (!/^(?:\.?[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*$/.test(
      options.domain,
    ) ||
      options.domain.includes(".."))
  ) {
    throw new TypeError("Cookie domain is invalid");
  }
  if (
    options.maxAge !== undefined &&
    (!Number.isSafeInteger(options.maxAge) || options.maxAge < 0)
  ) {
    throw new TypeError("Cookie maxAge must be a non-negative safe integer");
  }
  if (
    options.expires !== undefined &&
    !Number.isFinite(options.expires.getTime())
  ) {
    throw new TypeError("Cookie expires must be a valid Date");
  }
  if (
    options.sameSite !== undefined &&
    !["strict", "lax", "none"].includes(options.sameSite.toLowerCase())
  ) {
    throw new TypeError("Cookie sameSite must be Strict, Lax, or None");
  }
  if (options.sameSite?.toLowerCase() === "none" && !options.secure) {
    throw new TypeError("SameSite=None cookies must also be Secure");
  }
  if (name.startsWith("__Secure-") && !options.secure) {
    throw new TypeError("__Secure- cookies must also be Secure");
  }
  if (
    name.startsWith("__Host-") &&
    (!options.secure || options.path !== "/" || options.domain !== undefined)
  ) {
    throw new TypeError(
      "__Host- cookies must be Secure, use Path=/, and omit Domain",
    );
  }
}

function snapshotOptions(options?: SetCookieOptions): SetCookieOptions {
  if (!options) return {};
  return {
    ...options,
    ...(options.expires === undefined
      ? {}
      : { expires: new Date(options.expires.getTime()) }),
  };
}

function parseCookieHeader(header: string): Map<string, string> {
  const cookies = new Map<string, string>();
  let pos = 0;
  const len = header.length;
  while (pos < len) {
    while (pos < len && header.charCodeAt(pos) === 32) pos++;
    if (pos >= len) break;
    const eq = header.indexOf("=", pos);
    if (eq === -1) break;
    const name = header.slice(pos, eq).trim();
    pos = eq + 1;
    let end = header.indexOf(";", pos);
    if (end === -1) end = len;
    const value = header.slice(pos, end);
    if (name) cookies.set(name, decodeCookieValue(value));
    pos = end + 1;
  }
  return cookies;
}

function getCookies(state: CookieState): Map<string, string> {
  if (state.cookies !== null) return state.cookies;
  const header = state.requestHeaders?.get("cookie") ?? "";
  state.requestHeaders = undefined;
  state.cookies = header.length === 0 ? new Map() : parseCookieHeader(header);
  return state.cookies;
}

function getPending(state: CookieState): PendingCookie[] {
  if (state.pending === null) state.pending = [];
  return state.pending;
}

export function createCookieJar(
  secret?: string,
  requestHeaders?: Headers,
  onMutation?: () => void,
): CookieJar {
  return new CookieJarImpl(secret ?? "", requestHeaders, onMutation);
}

export function hasPendingCookies(cookieJar: CookieJar): boolean {
  return cookieJar instanceof CookieJarImpl && cookieJar.hasPending();
}

export function applyPendingCookies(
  cookieJar: CookieJar,
  headers: Headers,
): void {
  if (!(cookieJar instanceof CookieJarImpl)) {
    throw new TypeError("CookieJar was not created by Barq");
  }
  cookieJar.apply(headers);
}
