import type { CookieJar } from "./types";
export declare function createCookieJar(secret?: string, requestHeaders?: Headers, onMutation?: () => void): CookieJar;
export declare function hasPendingCookies(cookieJar: CookieJar): boolean;
export declare function applyPendingCookies(cookieJar: CookieJar, headers: Headers): void;
//# sourceMappingURL=cookies.d.ts.map