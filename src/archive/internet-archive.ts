import { AppError } from "../contracts/errors.ts";
import { httpRequest } from "../core/fetch/http.ts";
import type { ArchiveAdapter, ArchiveContext, ArchiveInput, ArchiveSaveResult } from "./types.ts";

const BLOCKED = ["x.com", "twitter.com", "mobile.x.com", "mobile.twitter.com"];

function isBlockedHost(hostname: string): boolean {
  const host = hostname.replace(/^www\./, "").toLowerCase();
  return BLOCKED.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
}

/**
 * Internet Archive Save Page Now. Keyless, but X/Twitter is on the SPN block
 * list, so those platforms are skipped explicitly.
 */
export const internetArchiveAdapter: ArchiveAdapter = {
  channel: "internet-archive",
  isConfigured: () => true,
  async save(input: ArchiveInput, ctx: ArchiveContext): Promise<ArchiveSaveResult> {
    const target = new URL(input.url);
    if (isBlockedHost(target.hostname)) {
      throw new AppError("archive_not_configured", `SPN blocks ${target.hostname}`);
    }

    const response = await httpRequest(`https://web.archive.org/save/${input.url}`, {
      fetchImpl: ctx.fetchImpl,
      headers: { accept: "text/html,application/xhtml+xml" },
      timeoutMs: 30000,
      maxBytes: 2 * 1024 * 1024,
      followRedirects: true,
    });

    if (response.status === 429) throw new AppError("archive_rate_limited", "save page now 429");
    if (response.status >= 400) {
      throw new AppError("archive_failed", `save page now status ${response.status}`);
    }
    const finalUrl = response.finalUrl || `https://web.archive.org/web/*/${input.url}`;
    return { url: finalUrl, externalId: null };
  },
};
