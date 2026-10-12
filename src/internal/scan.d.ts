/**
 * Token-based lexical scanner + semantic analyzer for handler functions.
 * Runs ONCE per route at registration time. Zero dependencies.
 */
export interface LiteralInfo {
    kind: "string" | "json";
    value: string;
}
export type HandlerFunction = (...args: never[]) => unknown;
export type ParamSerializer = (params: Record<string, string> | string) => string;
export interface ParamEntry {
    key: string;
    isParam: boolean;
    paramKey?: string;
    literalValue?: string;
}
export interface HandlerAnalysis {
    isNoArg: boolean;
    contextProps: Set<string>;
    hasDynamicAccess: boolean;
    isDestructured: boolean;
    destructuredProps: Set<string>;
    literal: LiteralInfo | null;
    arglessJsonCall: boolean;
    isParamJson?: boolean;
    paramJsonKey?: string;
    paramSerializer?: ParamSerializer | null;
    paramParts?: ParamEntry[] | null;
}
export declare const ESCAPE_JSON_CHARS_RE: RegExp;
export declare function escapeJsonString(value: string): string;
export declare function analyzeHandler(fn: HandlerFunction): HandlerAnalysis;
//# sourceMappingURL=scan.d.ts.map