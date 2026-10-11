import { describe, expect, it } from "bun:test";
import {
	ipMatchesRange,
	isIpRange,
	isValidIpAddress,
} from "../src/internal/ip";

describe("IP range parsing", () => {
	it("validates IPv4 and IPv6 addresses strictly", () => {
		expect(isValidIpAddress("192.0.2.10")).toBe(true);
		expect(isValidIpAddress("2001:db8::10")).toBe(true);
		expect(isValidIpAddress("999.0.2.10")).toBe(false);
		expect(isValidIpAddress("2001:db8::gg")).toBe(false);
	});

	it("validates CIDR prefix bounds", () => {
		expect(isIpRange("192.0.2.0/24")).toBe(true);
		expect(isIpRange("192.0.2.0/33")).toBe(false);
		expect(isIpRange("2001:db8::/129")).toBe(false);
		expect(isIpRange("192.0.2.1/junk")).toBe(false);
	});

	it("matches IPv4 and IPv6 networks", () => {
		expect(ipMatchesRange("192.0.2.9", "192.0.2.0/24")).toBe(true);
		expect(ipMatchesRange("192.0.3.9", "192.0.2.0/24")).toBe(false);
		expect(ipMatchesRange("2001:db8::9", "2001:db8::/32")).toBe(true);
		expect(ipMatchesRange("2001:db9::9", "2001:db8::/32")).toBe(false);
		expect(ipMatchesRange("127.0.0.4", "loopback")).toBe(true);
		expect(ipMatchesRange("::1", "loopback")).toBe(true);
	});
});
