export interface ParsedTarget {
    pathname: string;
    query: string | undefined;
}
export declare function hasEncodedSlash(path: string): boolean;
export declare function normalizeDotSegments(path: string): string;
export declare function scanPathname(url: string): string;
export declare function parseRequestTarget(url: string): ParsedTarget;
//# sourceMappingURL=pathname.d.ts.map