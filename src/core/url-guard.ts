import { lookup } from "node:dns/promises";
import { AppError } from "../contracts/errors.ts";

export type ResolveHost = (hostname: string) => Promise<string[]>;

export const defaultResolveHost: ResolveHost = async (hostname) => {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((r) => r.address);
};

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
  "instance-data.ec2.internal",
]);

export interface ValidatedUrl {
  url: URL;
  addresses: string[];
}

function parseIPv4(value: string): number[] | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const nums: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    nums.push(n);
  }
  return nums;
}

export function isBlockedIPv4(value: string): boolean {
  const nums = parseIPv4(value);
  if (!nums) return false;
  const [a, b] = nums;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT (Alibaba metadata)
  if (a === 192 && b === 0 && nums[2] === 0) return true; // IETF protocol assignments
  if (a === 192 && b === 0 && nums[2] === 2) return true; // TEST-NET-1
  if (a === 198 && b === 51 && nums[2] === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && nums[2] === 113) return true; // TEST-NET-3
  // 198.18.0.0/15 is the benchmarking range. Some corporate/sandbox resolvers
  // transparently answer it for every hostname, so blocking it would break all
  // fetching in those environments; it cannot reach a private service by itself.
  if (a >= 224 && a <= 239) return true; // multicast
  if (a >= 240) return true; // reserved + broadcast
  return false;
}

export function isBlockedIPv6(value: string): boolean {
  const raw = value.replace(/^\[|\]$/g, "").toLowerCase().split("%")[0];
  if (raw === "::" || raw === "::1") return true;
  if (raw.startsWith("::ffff:")) {
    const mapped = raw.slice("::ffff:".length);
    if (parseIPv4(mapped)) return isBlockedIPv4(mapped);
    return true;
  }
  if (raw.startsWith("fc") || raw.startsWith("fd")) return true; // unique local (incl. fd00:ec2::254)
  if (/^fe[89ab]/.test(raw)) return true; // link-local
  if (raw.startsWith("ff")) return true; // multicast
  if (raw.startsWith("fec0")) return true; // deprecated site-local
  if (raw.startsWith("2001:db8")) return true; // documentation
  if (raw.startsWith("64:ff9b")) return false; // NAT64 is routable
  return false;
}

export function isIPLike(value: string): boolean {
  if (parseIPv4(value)) return true;
  if (value.startsWith("[") && value.endsWith("]")) return true;
  return value.includes(":") && /^[0-9a-f:.]+$/i.test(value) && value.includes(":");
}

/** Synchronous structural checks that need no DNS. */
export function inspectUrl(raw: string): URL {
  if (typeof raw !== "string") throw new AppError("invalid_url", "url is not a string");
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 2048) throw new AppError("invalid_url", `url length ${trimmed.length}`);

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new AppError("invalid_url", "url parse failed");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new AppError("invalid_url", `protocol ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new AppError("blocked_url", "url contains credentials");
  }

  const explicitPort = url.port;
  if (explicitPort) {
    const expected = url.protocol === "http:" ? "80" : "443";
    if (explicitPort !== expected) throw new AppError("blocked_url", `port ${explicitPort}`);
  }

  const hostname = url.hostname.replace(/\.$/, "").toLowerCase();
  if (!hostname) throw new AppError("invalid_url", "empty hostname");
  if (hostname.includes("%")) throw new AppError("blocked_url", "zone id hostname");
  if (BLOCKED_HOSTNAMES.has(hostname)) throw new AppError("blocked_url", `hostname ${hostname}`);
  if (/\.(local|localhost|internal|home\.arpa|intranet)$/.test(hostname)) {
    throw new AppError("blocked_url", `hostname suffix ${hostname}`);
  }

  const isIpv6 = hostname.startsWith("[");
  if (isIpv6) {
    if (isBlockedIPv6(hostname)) throw new AppError("blocked_url", `ipv6 ${hostname}`);
  } else if (parseIPv4(hostname)) {
    if (isBlockedIPv4(hostname)) throw new AppError("blocked_url", `ipv4 ${hostname}`);
  } else {
    if (!hostname.includes(".")) throw new AppError("blocked_url", `single-label host ${hostname}`);
    if (/^\d+$/.test(hostname.split(".").pop() ?? "")) {
      // "127.1" style wildcard forms are not valid for URL, but guard anyway.
      throw new AppError("blocked_url", `numeric tld ${hostname}`);
    }
  }

  return url;
}

/**
 * Full validation: structural checks plus DNS resolution. Every resolved
 * address must be public, otherwise a redirect/DNS trick could reach internal
 * services. Residual risk: DNS rebinding between resolution and connection.
 */
export async function validatePublicUrl(raw: string, resolveHost: ResolveHost = defaultResolveHost): Promise<ValidatedUrl> {
  const url = inspectUrl(raw);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (isIPLike(url.hostname)) return { url, addresses: [hostname] };

  let addresses: string[];
  try {
    addresses = await resolveHost(hostname);
  } catch (error) {
    throw new AppError("blocked_url", `dns failure for ${hostname}: ${(error as Error).message}`);
  }
  if (!addresses.length) throw new AppError("blocked_url", `no dns records for ${hostname}`);
  for (const address of addresses) {
    const blocked = address.includes(":") ? isBlockedIPv6(address) : isBlockedIPv4(address);
    if (blocked) throw new AppError("blocked_url", `hostname ${hostname} resolves to internal ${address}`);
  }
  return { url, addresses };
}
