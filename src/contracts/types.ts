export type Platform =
  | "web"
  | "x"
  | "wechat"
  | "xiaohongshu"
  | "weibo"
  | "zhihu"
  | "github";

export type FetchStatus = "ok" | "partial" | "failed";

export interface OgInfo {
  image: string | null;
  title: string | null;
  description: string | null;
  site_name: string | null;
}

export interface ContentInfo {
  format: "markdown";
  text: string;
  length: number;
}

export interface MetadataInfo {
  author: string | null;
  published_at: string | null;
  language: string | null;
}

export interface UsageInfo {
  fetch_cost_usd: number;
  ai_cost_usd?: number;
}

export interface MetricsInfo {
  response_time_ms: number;
  upstream_latency_ms: number;
}

/** Module 8 public contract. Extra fields are documented (`id`, `created_at`). */
export interface UnifiedResult {
  id: string;
  created_at: string;
  provider: string;
  url: string;
  title: string;
  platform: Platform;
  content: ContentInfo;
  metadata: MetadataInfo;
  og: OgInfo;
  usage: UsageInfo;
  metrics: MetricsInfo;
  status: FetchStatus;
}

export interface FetchAttempt {
  engine: string;
  status: "ok" | "failed" | "skipped" | "timeout";
  upstream_latency_ms: number;
  error_code?: string;
}

export interface ExtractedContent {
  markdown: string;
  text: string;
  title: string | null;
  author: string | null;
  publishedAt: string | null;
  language: string | null;
  images: string[];
  siteName: string | null;
  extractor: "trafilatura" | "defuddle" | "readability" | "native" | "jina";
  rawHtml?: string;
  debug: {
    precision_length: number;
    recall_length: number;
    chosen: string;
    notes: string[];
  };
}

export interface FetchOutcome {
  platform: Platform;
  provider: string;
  finalUrl: string;
  upstreamLatencyMs: number;
  costUsd: number;
  attempts: FetchAttempt[];
  extracted: ExtractedContent;
  og: OgInfo;
}

export interface ArchiveResult {
  channel: string;
  status: "ok" | "failed" | "skipped";
  url: string | null;
  externalId: string | null;
  errorCode?: string;
}

export interface AiTaskResult {
  kind: string;
  model: string;
  content: unknown;
  costUsd: number;
}
