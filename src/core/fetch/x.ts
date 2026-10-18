import { AppError } from "../../contracts/errors.ts";
import { parseXStatus } from "../platform.ts";
import { fetchJson } from "./http.ts";
import type { RawDocument } from "./common.ts";
import type { FetcherContext } from "./self.ts";

interface FxPhoto {
  url?: string;
  width?: number;
  height?: number;
}

interface FxTweet {
  url?: string;
  id?: string;
  text?: string;
  created_at?: string;
  author?: { name?: string; screen_name?: string; avatar_url?: string };
  media?: { photos?: FxPhoto[]; videos?: Array<{ url?: string }> };
  quote?: { text?: string; author?: { name?: string; screen_name?: string } };
}

interface FxResponse {
  code?: number;
  message?: string;
  tweet?: FxTweet;
}

interface VxResponse {
  tweetID?: string;
  text?: string;
  date?: string;
  user_name?: string;
  user_screen_name?: string;
  mediaURLs?: string[];
  hasMedia?: boolean;
}

function buildMarkdown(tweet: {
  text: string;
  authorName: string;
  screenName: string;
  date: string | null;
  images: string[];
  quote?: string;
}): string {
  const parts: string[] = [];
  parts.push(tweet.text.trim());
  if (tweet.quote) parts.push(`\n> 引用：${tweet.quote.replace(/\n+/g, " ")}`);
  for (const image of tweet.images) parts.push(`\n![图片](${image})`);
  parts.push("");
  parts.push("---");
  parts.push(`[${tweet.authorName} (@${tweet.screenName})](https://x.com/${tweet.screenName})${tweet.date ? ` · ${tweet.date}` : ""}`);
  return parts.join("\n");
}

async function viaFx(url: URL, ctx: FetcherContext): Promise<RawDocument> {
  const { handle, id } = parseXStatus(url);
  const endpoint = `https://api.fxtwitter.com/${handle ?? "i"}/status/${id}`;
  const { data, latencyMs } = await fetchJson<FxResponse>(endpoint, {
    fetchImpl: ctx.fetchImpl,
    timeoutMs: ctx.config.httpTimeoutMs,
    maxBytes: 2 * 1024 * 1024,
  });
  const tweet = data.tweet;
  if (!tweet?.text) throw new AppError("fetch_failed", `fxtwitter: ${data.message ?? "no tweet"}`);

  const images = (tweet.media?.photos ?? []).map((p) => p.url).filter((u): u is string => Boolean(u));
  const authorName = tweet.author?.name ?? "X";
  const screenName = tweet.author?.screen_name ?? (handle ?? "i");
  const markdown = buildMarkdown({
    text: tweet.text,
    authorName,
    screenName,
    date: tweet.created_at ?? null,
    images,
    quote: tweet.quote?.text,
  });

  return {
    provider: "fxtwitter",
    finalUrl: tweet.url ?? url.toString(),
    markdown,
    title: tweet.text.trim().length > 90 ? `${tweet.text.trim().slice(0, 89)}…` : tweet.text.trim(),
    author: `${authorName} (@${screenName})`,
    publishedAt: tweet.created_at ?? null,
    images,
    latencyMs,
    costUsd: 0,
    ogOverride: {
      image: images[0] ?? null,
      description: tweet.text.trim().slice(0, 180),
      site_name: "X",
    },
    notes: ["x via fxtwitter"],
  };
}

async function viaVx(url: URL, ctx: FetcherContext): Promise<RawDocument> {
  const { handle, id } = parseXStatus(url);
  const endpoint = `https://api.vxtwitter.com/${handle ?? "i"}/status/${id}`;
  const { data, latencyMs } = await fetchJson<VxResponse>(endpoint, {
    fetchImpl: ctx.fetchImpl,
    timeoutMs: ctx.config.httpTimeoutMs,
    maxBytes: 2 * 1024 * 1024,
  });
  if (!data.text) throw new AppError("fetch_failed", "vxtwitter: no text");

  const images = (data.mediaURLs ?? []).filter(Boolean);
  const screenName = data.user_screen_name ?? handle ?? "i";
  const authorName = data.user_name ?? "X";
  return {
    provider: "vxtwitter",
    finalUrl: url.toString(),
    markdown: buildMarkdown({
      text: data.text,
      authorName,
      screenName,
      date: data.date ?? null,
      images,
    }),
    title: data.text.trim().length > 90 ? `${data.text.trim().slice(0, 89)}…` : data.text.trim(),
    author: `${authorName} (@${screenName})`,
    publishedAt: data.date ?? null,
    images,
    latencyMs,
    costUsd: 0,
    ogOverride: { image: images[0] ?? null, site_name: "X" },
    notes: ["x via vxtwitter"],
  };
}

/** X posts through FxEmbed-style APIs: keyless and structured, no extraction needed. */
export async function xFetch(url: URL, ctx: FetcherContext): Promise<RawDocument> {
  try {
    return await viaFx(url, ctx);
  } catch (primaryError) {
    try {
      return await viaVx(url, ctx);
    } catch (fallbackError) {
      throw new AppError(
        "provider_unavailable",
        `x providers failed: ${(primaryError as Error).message} / ${(fallbackError as Error).message}`,
      );
    }
  }
}
