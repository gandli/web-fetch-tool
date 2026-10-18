import { describe, expect, test } from "bun:test";
import {
  inspectUrl,
  isBlockedIPv4,
  isBlockedIPv6,
  validatePublicUrl,
  type ResolveHost,
} from "../../src/core/url-guard.ts";
import { AppError } from "../../src/contracts/errors.ts";

function codeOf(fn: () => unknown): string {
  try {
    fn();
    return "ok";
  } catch (error) {
    return error instanceof AppError ? error.code : "unknown";
  }
}

describe("structural URL checks", () => {
  test("accepts plain public http/https urls", () => {
    expect(inspectUrl("https://example.com/a?b=1").hostname).toBe("example.com");
    expect(inspectUrl("http://example.com").protocol).toBe("http:");
  });

  test("rejects unsupported protocols", () => {
    for (const url of ["file:///etc/passwd", "ftp://example.com", "javascript:alert(1)", "data:text/html,x"]) {
      expect(codeOf(() => inspectUrl(url))).toBe("invalid_url");
    }
  });

  test("rejects credentials, odd ports and local names", () => {
    expect(codeOf(() => inspectUrl("http://user:pass@example.com"))).toBe("blocked_url");
    expect(codeOf(() => inspectUrl("http://example.com:8080"))).toBe("blocked_url");
    expect(codeOf(() => inspectUrl("http://localhost"))).toBe("blocked_url");
    expect(codeOf(() => inspectUrl("http://router.local"))).toBe("blocked_url");
    expect(codeOf(() => inspectUrl("http://intranet"))).toBe("blocked_url");
  });

  test("rejects private literal addresses", () => {
    for (const url of [
      "http://127.0.0.1/",
      "http://10.1.2.3/",
      "http://172.16.0.1/",
      "http://192.168.1.1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://100.100.100.200/",
      "http://[::1]/",
      "http://[fd00:ec2::254]/",
      "http://[fe80::1]/",
    ]) {
      expect(codeOf(() => inspectUrl(url))).toBe("blocked_url");
    }
  });

  test("blocks IPv4/IPv6 ranges by value", () => {
    expect(isBlockedIPv4("127.0.0.1")).toBe(true);
    expect(isBlockedIPv4("169.254.169.254")).toBe(true);
    expect(isBlockedIPv4("8.8.8.8")).toBe(false);
    expect(isBlockedIPv4("198.18.2.109")).toBe(false);
    expect(isBlockedIPv6("::1")).toBe(true);
    expect(isBlockedIPv6("::ffff:192.168.0.1")).toBe(true);
    expect(isBlockedIPv6("2606:4700::1111")).toBe(false);
  });
});

describe("DNS-aware validation", () => {
  test("accepts public resolutions", async () => {
    const resolve: ResolveHost = async () => ["93.184.216.34"];
    const result = await validatePublicUrl("https://example.com", resolve);
    expect(result.addresses).toEqual(["93.184.216.34"]);
  });

  test("rejects hostnames resolving to private addresses", async () => {
    const resolve: ResolveHost = async () => ["10.0.0.5"];
    await expect(validatePublicUrl("https://internal.example.com", resolve)).rejects.toMatchObject({
      code: "blocked_url",
    });
  });

  test("rejects mixed public/private answers", async () => {
    const resolve: ResolveHost = async () => ["93.184.216.34", "169.254.169.254"];
    await expect(validatePublicUrl("https://rebind.example.com", resolve)).rejects.toMatchObject({
      code: "blocked_url",
    });
  });

  test("rejects DNS failures and empty answers", async () => {
    await expect(
      validatePublicUrl("https://missing.example.com", async () => {
        throw new Error("ENOTFOUND");
      }),
    ).rejects.toMatchObject({ code: "blocked_url" });
    await expect(validatePublicUrl("https://empty.example.com", async () => [])).rejects.toMatchObject({
      code: "blocked_url",
    });
  });
});
