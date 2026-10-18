import type { OgInfo } from "../../contracts/types.ts";

/** A provider-neutral document returned by any fetch channel. */
export interface RawDocument {
  provider: string;
  finalUrl: string;
  html?: string;
  markdown?: string;
  title?: string | null;
  author?: string | null;
  publishedAt?: string | null;
  images?: string[];
  language?: string | null;
  ogOverride?: Partial<OgInfo>;
  latencyMs: number;
  costUsd: number;
  notes?: string[];
}

export function firstLine(text: string, max = 120): string | null {
  const line = text
    .split("\n")
    .map((l) => l.replace(/^#+\s*/, "").trim())
    .find((l) => l.length > 0);
  if (!line) return null;
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}
