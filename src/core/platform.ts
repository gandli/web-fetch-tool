import { AppError } from "../contracts/errors.ts";
import type { Platform } from "../contracts/types.ts";

export interface PlatformRoute {
  platform: Platform;
  /** Channel used for the first attempt. */
  channel: "web" | "x" | "wechat" | "github" | "browser-render";
  /** True when this platform is detected but not implemented in this milestone. */
  experimental: boolean;
  /** Echo of the matched rule for tests/telemetry. */
  matchedBy: string;
}

function hostnameOf(url: URL): string {
  return url.hostname.replace(/^www\./i, "").toLowerCase();
}

function isGithubRepoPath(pathname: string): boolean {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length < 2) return false;
  const [owner, repo] = segments;
  if (!owner || !repo) return false;
  if (["orgs", "users", "topics", "settings", "marketplace", "sponsors", "features", "pricing", "login", "about"].includes(owner)) {
    return false;
  }
  // Repo pages, tree/blob/issues and friends all belong to the same repository.
  return segments.length <= 6 && repo.length > 0;
}

export function detectPlatform(input: string | URL): PlatformRoute {
  const url = input instanceof URL ? input : new URL(input);
  const host = hostnameOf(url);
  const path = url.pathname;

  if (host === "x.com" || host === "twitter.com" || host === "mobile.twitter.com" || host === "mobile.x.com") {
    if (/\/status(?:es)?\/\d+/.test(path) || /^\/i\/web\/status\/\d+/.test(path)) {
      return { platform: "x", channel: "x", experimental: false, matchedBy: "x-status" };
    }
    throw new AppError("platform_unsupported", `x url without status: ${path}`);
  }

  if (host === "mp.weixin.qq.com") {
    return { platform: "wechat", channel: "wechat", experimental: false, matchedBy: "wechat-host" };
  }

  if (host === "github.com" || host === "www.github.com") {
    if (isGithubRepoPath(path)) {
      return { platform: "github", channel: "github", experimental: false, matchedBy: "github-repo" };
    }
    throw new AppError("platform_unsupported", `github url without repo: ${path}`);
  }

  if (host === "xiaohongshu.com" || host.endsWith(".xiaohongshu.com") || host === "xhslink.com") {
    return { platform: "xiaohongshu", channel: "browser-render", experimental: true, matchedBy: "xiaohongshu-host" };
  }

  if (host === "weibo.com" || host === "weibo.cn" || host === "m.weibo.cn" || host.endsWith(".weibo.com")) {
    return { platform: "weibo", channel: "browser-render", experimental: true, matchedBy: "weibo-host" };
  }

  if (host === "zhihu.com" || host.endsWith(".zhihu.com")) {
    return { platform: "zhihu", channel: "browser-render", experimental: true, matchedBy: "zhihu-host" };
  }

  return { platform: "web", channel: "web", experimental: false, matchedBy: "default" };
}

/** Extract the status id from an X/Twitter URL. */
export function parseXStatus(url: URL): { handle: string | null; id: string } {
  const match = url.pathname.match(/\/status(?:es)?\/(\d+)/) ?? url.pathname.match(/^\/i\/web\/status\/(\d+)/);
  if (!match) throw new AppError("invalid_url", `x status id missing in ${url.pathname}`);
  const segments = url.pathname.split("/").filter(Boolean);
  const handle = segments[0] && !["i", "status", "statuses"].includes(segments[0]) ? segments[0] : null;
  return { handle, id: match[1]! };
}

/** Extract owner/repo from a GitHub URL. */
export function parseGithubRepo(url: URL): { owner: string; repo: string } {
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length < 2) throw new AppError("invalid_url", "github repo path incomplete");
  return { owner: segments[0]!, repo: segments[1]!.replace(/\.git$/, "") };
}
