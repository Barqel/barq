import type { Middleware } from "./types";
export interface CorsOptions {
    origin?: string | string[] | ((origin: string) => boolean | string);
    methods?: string[];
    allowedHeaders?: string[];
    exposedHeaders?: string[];
    credentials?: boolean;
    maxAge?: number;
}
export declare function cors(options?: CorsOptions): Middleware;
//# sourceMappingURL=cors.d.ts.map