export type IpMatcher = (ip: string) => boolean;
export declare function compileTrustProxy(trust: boolean | string | readonly string[] | ((ip: string) => boolean) | undefined): IpMatcher;
export declare function isIpRange(value: string): boolean;
export declare function ipMatchesRange(ip: string, range: string): boolean;
export declare function isValidIpAddress(value: string): boolean;
//# sourceMappingURL=ip.d.ts.map