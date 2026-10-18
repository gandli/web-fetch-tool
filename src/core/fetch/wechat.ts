import { DOMParser } from "linkedom";
import { AppError } from "../../contracts/errors.ts";
import { extractOg } from "../og.ts";
import { nativeExtract } from "../extract/native.ts";
import { fetchDocument } from "./http.ts";
import type { RawDocument } from "./common.ts";
import type { FetcherContext } from "./self.ts";

/**
 * WeChat public account articles are plain server-rendered HTML: the body lives
 * in #js_content. This is a pure API channel (no browser, no login).
 */
const BLOCK_MARKERS = /环境异常|完成验证|访问过于频繁|该内容已被发布者删除|内容已被删除|链接已失效|参数错误/;

function publishTimestamp(html: string): string | null {
  const match = html.match(/var\s+ct\s*=\s*"(\d{10})"/) ?? html.match(/"create_time"\s*:\s*"(\d{10})"/);
  if (!match) return null;
  const date = new Date(Number(match[1]) * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function wechatFetch(url: string, ctx: FetcherContext): Promise<RawDocument> {
  const document = await fetchDocument(url, {
    fetchImpl: ctx.fetchImpl,
    resolveHost: ctx.resolveHost,
    timeoutMs: ctx.config.httpTimeoutMs,
    maxBytes: ctx.config.maxHtmlBytes,
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      referer: "https://mp.weixin.qq.com/",
      "sec-fetch-dest": "document",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "same-origin",
      "upgrade-insecure-requests": "1",
    },
  });

  if (BLOCK_MARKERS.test(document.text.slice(0, 20000))) {
    throw new AppError("fetch_failed", "wechat verification or removed-content page returned");
  }

  const dom = new DOMParser().parseFromString(document.text, "text/html") as unknown as Document;
  const { og } = extractOg(dom, document.finalUrl);
  const extracted = nativeExtract({
    html: document.text,
    url: document.finalUrl,
    contentSelector: "#js_content",
    titleSelector: "#activity-name",
    authorSelector: "#js_name",
    publishedSelector: "#publish_time",
    siteName: "微信公众号",
    maxChars: ctx.config.maxContentChars,
  });

  if (!extracted) {
    throw new AppError("content_empty", "wechat #js_content missing");
  }

  return {
    provider: "wechat-native",
    finalUrl: document.finalUrl,
    html: document.text,
    markdown: extracted.markdown,
    title: extracted.title ?? og.title,
    author: extracted.author,
    publishedAt: extracted.publishedAt ?? publishTimestamp(document.text),
    images: extracted.images,
    language: extracted.language,
    ogOverride: {
      image: og.image ?? extracted.images[0] ?? null,
      title: og.title ?? extracted.title,
      description: og.description,
      site_name: og.site_name ?? "微信公众号",
    },
    latencyMs: document.latencyMs,
    costUsd: 0,
    notes: ["wechat native #js_content"],
  };
}
