export type HeadersInit = NonNullable<ResponseInit["headers"]>;
export declare function isNullBodyStatus(status: number): boolean;
export declare function json(data: unknown, init?: number | ResponseInit): Response;
export declare function text(body: string, init?: number | ResponseInit): Response;
export declare function empty(status?: number, headers?: HeadersInit): Response;
export declare function redirect(url: string, status?: number, allowlist?: ReadonlySet<string>): Response;
//# sourceMappingURL=http.d.ts.map