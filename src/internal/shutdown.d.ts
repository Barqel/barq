import type { Server } from "bun";
export interface ShutdownResult {
    forced: boolean;
    pending: number;
}
export declare function stopServer(server: Server<unknown>, hardTimeoutMs: number): Promise<ShutdownResult>;
//# sourceMappingURL=shutdown.d.ts.map