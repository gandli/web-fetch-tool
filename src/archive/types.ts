import type { AppConfig } from "../config.ts";
import type { Db } from "../db/db.ts";

export interface ArchiveInput {
  url: string;
  title: string;
  markdown: string;
  platform: string;
}

export interface ArchiveSaveResult {
  url: string;
  externalId: string | null;
}

export interface ArchiveContext {
  config: AppConfig;
  db: Db;
  fetchImpl: typeof fetch;
}

export interface ArchiveAdapter {
  readonly channel: string;
  isConfigured(ctx: ArchiveContext): boolean;
  save(input: ArchiveInput, ctx: ArchiveContext): Promise<ArchiveSaveResult>;
}
