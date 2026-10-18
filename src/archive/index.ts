import { randomUUID } from "node:crypto";
import { isAppError } from "../contracts/errors.ts";
import type { ArchiveResult } from "../contracts/types.ts";
import type { Db } from "../db/db.ts";
import { archiveRepo } from "../db/repositories.ts";
import { telegraphAdapter } from "./telegraph.ts";
import { internetArchiveAdapter } from "./internet-archive.ts";
import type { ArchiveAdapter, ArchiveContext, ArchiveInput } from "./types.ts";

const ADAPTERS: Record<string, ArchiveAdapter> = {
  telegraph: telegraphAdapter,
  "internet-archive": internetArchiveAdapter,
};

export function archiveChannelNames(): string[] {
  return Object.keys(ADAPTERS);
}

export function getArchiveAdapter(channel: string): ArchiveAdapter | undefined {
  return ADAPTERS[channel];
}

/**
 * Runs every requested archive channel independently: one failing channel never
 * blocks the others, and every attempt (ok/failed/skipped) is persisted.
 */
export async function runArchive(
  channels: string[],
  input: ArchiveInput,
  ctx: ArchiveContext,
  fetchId: string,
): Promise<ArchiveResult[]> {
  const unique = [...new Set(channels.map((c) => c.trim()).filter(Boolean))];
  const results: ArchiveResult[] = [];

  for (const channel of unique) {
    const adapter = ADAPTERS[channel];
    let result: ArchiveResult;

    if (!adapter || !adapter.isConfigured(ctx)) {
      result = {
        channel,
        status: "skipped",
        url: null,
        externalId: null,
        errorCode: "archive_not_configured",
      };
    } else {
      try {
        const saved = await adapter.save(input, ctx);
        result = { channel, status: "ok", url: saved.url, externalId: saved.externalId };
      } catch (error) {
        const code = isAppError(error) ? error.code : "archive_failed";
        result = {
          channel,
          // A channel that refuses by policy (e.g. Save Page Now blocks X) is
          // "skipped", not a failure of the archive feature.
          status: code === "archive_not_configured" ? "skipped" : "failed",
          url: null,
          externalId: null,
          errorCode: code,
        };
      }
    }

    results.push(result);
    await archiveRepo
      .insert(ctx.db, {
        id: randomUUID(),
        fetchId,
        channel,
        status: result.status,
        url: result.url,
        externalId: result.externalId,
        errorCode: result.errorCode ?? null,
      })
      .catch(() => {});
  }

  return results;
}

export type { ArchiveAdapter, ArchiveContext, ArchiveInput } from "./types.ts";
