export type HeadersInit = NonNullable<ResponseInit["headers"]>;
export declare class HttpError extends Error {
    readonly status: number;
    readonly body: unknown;
    readonly headers?: HeadersInit;
    constructor(status: number, body?: unknown, headers?: HeadersInit);
}
export declare function errorToResponse(err: unknown, development: boolean): Response;
export declare const createErrorResponse: typeof errorToResponse;
//# sourceMappingURL=errors.d.ts.map