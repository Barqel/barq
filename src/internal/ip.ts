import { isIP } from "node:net";

export type IpMatcher = (ip: string) => boolean;

function ipv4ToNumber(bytes: Uint8Array): number {
  return (
    ((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>> 0
  );
}

export function compileTrustProxy(
  trust:
    | boolean
    | string
    | readonly string[]
    | ((ip: string) => boolean)
    | undefined,
): IpMatcher {
  if (!trust) return () => false;
  if (trust === true) return () => true;
  if (typeof trust === "function") return trust;

  const ranges = typeof trust === "string" ? [trust] : trust;
  if (ranges.length === 0) return () => false;

  const matchers: IpMatcher[] = [];

  for (const range of ranges) {
    if (range === "loopback") {
      matchers.push((ip) => {
        const addr = parseIpAddress(ip);
        if (addr === null) return false;
        if (addr.length === 4) return addr[0] === 127;
        return addr.slice(0, 15).every((b) => b === 0) && addr[15] === 1;
      });
      continue;
    }

    const slash = range.indexOf("/");
    const netText = slash === -1 ? range : range.slice(0, slash);
    const netBytes = parseIpAddress(netText);
    if (!netBytes) continue;

    const bits =
      slash === -1 ? netBytes.length * 8 : Number(range.slice(slash + 1));
    if (netBytes.length === 4) {
      const netNum = ipv4ToNumber(netBytes);
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      const expected = (netNum & mask) >>> 0;
      matchers.push((ip) => {
        const addr = parseIpAddress(ip);
        if (addr?.length !== 4) return false;
        return (ipv4ToNumber(addr) & mask) >>> 0 === expected;
      });
    } else {
      matchers.push((ip) => ipMatchesRange(ip, range));
    }
  }

  return (ip: string) => matchers.some((m) => m(ip));
}

export function isIpRange(value: string): boolean {
  if (value === "loopback") return true;
  const slash = value.indexOf("/");
  if (slash !== value.lastIndexOf("/")) return false;
  const address = slash === -1 ? value : value.slice(0, slash);
  const bytes = parseIpAddress(address);
  if (bytes === null) return false;
  if (slash === -1) return true;
  const bitsText = value.slice(slash + 1);
  if (!/^\d+$/.test(bitsText)) return false;
  const bits = Number(bitsText);
  return Number.isInteger(bits) && bits >= 0 && bits <= bytes.length * 8;
}

export function ipMatchesRange(ip: string, range: string): boolean {
  const address = parseIpAddress(ip);
  if (address === null) return false;
  if (range === "loopback") {
    if (address.length === 4) return address[0] === 127;
    return (
      address.slice(0, 15).every((byte) => byte === 0) && address[15] === 1
    );
  }

  const slash = range.indexOf("/");
  const networkText = slash === -1 ? range : range.slice(0, slash);
  const network = parseIpAddress(networkText);
  if (network === null || address.length !== network.length) return false;
  const bits =
    slash === -1 ? network.length * 8 : Number(range.slice(slash + 1));
  if (!Number.isInteger(bits) || bits < 0 || bits > network.length * 8) {
    return false;
  }

  const fullBytes = Math.floor(bits / 8);
  for (let i = 0; i < fullBytes; i++) {
    if (address[i] !== network[i]) return false;
  }
  const remainingBits = bits % 8;
  if (remainingBits === 0) return true;
  const mask = (0xff << (8 - remainingBits)) & 0xff;
  return (address[fullBytes]! & mask) === (network[fullBytes]! & mask);
}

export function isValidIpAddress(value: string): boolean {
  return parseIpAddress(value) !== null;
}

function parseIpAddress(value: string): Uint8Array | null {
  const version = isIP(value);
  if (version === 4) {
    const bytes = value.split(".").map(Number);
    if (bytes.length !== 4) return null;
    return Uint8Array.from(bytes);
  }
  if (version !== 6) return null;

  let address = value.toLowerCase();
  if (address.includes(".")) {
    const separator = address.lastIndexOf(":");
    const ipv4 = address
      .slice(separator + 1)
      .split(".")
      .map(Number);
    if (separator === -1 || ipv4.length !== 4) return null;
    const high = ((ipv4[0]! << 8) | ipv4[1]!).toString(16);
    const low = ((ipv4[2]! << 8) | ipv4[3]!).toString(16);
    address = `${address.slice(0, separator + 1)}${high}:${low}`;
  }

  const halves = address.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if (
    (halves.length === 1 && missing !== 0) ||
    (halves.length === 2 && missing < 1)
  ) {
    return null;
  }
  const groups = [
    ...left,
    ...new Array(halves.length === 2 ? missing : 0).fill("0"),
    ...right,
  ];
  if (
    groups.length !== 8 ||
    groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))
  ) {
    return null;
  }

  const bytes = new Uint8Array(16);
  for (let i = 0; i < groups.length; i++) {
    const group = Number.parseInt(groups[i]!, 16);
    bytes[i * 2] = group >>> 8;
    bytes[i * 2 + 1] = group & 0xff;
  }
  return bytes;
}
