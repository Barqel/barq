import type { HttpMethod, ResponseHandler } from "../types";
export declare const MATCH_HANDLER: unique symbol;
export declare const MATCH_NOT_ALLOWED: unique symbol;
export type RouteParams = Record<string, string> & {
    [MATCH_HANDLER]?: ResponseHandler;
};
export interface NotAllowed {
    readonly [MATCH_NOT_ALLOWED]: string;
}
export type RouteResult = ResponseHandler | RouteParams | NotAllowed | null;
type PatternSegment = {
    readonly kind: "static";
    readonly value: string;
} | {
    readonly kind: "param";
    readonly name: string;
    readonly optional?: boolean;
} | {
    readonly kind: "wildcard";
    readonly name: string | null;
};
export declare function parsePattern(pattern: string): PatternSegment[];
export declare class SegmentTrie {
    private root;
    private staticRoutes;
    private staticNotAllowed;
    private maxStaticLength;
    private readonly paramNameBuffer;
    private readonly paramValueBuffer;
    addBatch(routes: readonly {
        method: HttpMethod;
        pattern: string;
        handler: ResponseHandler;
    }[]): void;
    private clone;
    add(method: HttpMethod, pattern: string, handler: ResponseHandler): void;
    private addWithSegments;
    private addParsed;
    static computeAllow(handlers: Record<string, ResponseHandler>): string;
    match(method: string, pathname: string): RouteResult;
}
export {};
//# sourceMappingURL=trie.d.ts.map