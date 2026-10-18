import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { setupApp } from "../helpers/app.ts";
import { fetchRepo } from "../../src/db/repositories.ts";
import type { Db } from "../../src/db/db.ts";

const MARKDOWN_BODY =
  "Markdown is a lightweight markup language. This pipeline converts cleaned HTML into Markdown, keeps tables and code fences, and strips navigation and ads. ".repeat(4);

async function seed(
  db: Db,
  input: { title: string; content: string; platform?: string; provider?: string; url?: string },
): Promise<void> {
  await fetchRepo.insert(db, {
    id: randomUUID(),
    url: input.url ?? `https://example.com/${encodeURIComponent(input.title)}`,
    normalizedUrl: input.url ?? "https://example.com/seed",
    platform: input.platform ?? "web",
    engine: "auto",
    provider: input.provider ?? "self",
    title: input.title,
    contentMarkdown: input.content,
    contentLength: input.content.length,
    rawHtml: null,
    metadata: { author: "Fixture Author", published_at: null, language: "en" },
    og: { image: null, title: input.title, description: null, site_name: "Fixture" },
    usage: { fetch_cost_usd: 0 },
    metrics: { response_time_ms: 1, upstream_latency_ms: 1 },
    status: "ok",
    errorCode: null,
    fetchAttempts: [],
    extractDebug: {},
  });
}

async function seedCorpus(db: Db): Promise<void> {
  await seed(db, {
    title: "Understanding Markdown Pipelines",
    content: MARKDOWN_BODY,
    url: "https://example.com/markdown-pipeline",
  });
  await seed(db, {
    title: "Telegram bot integration",
    content: "A Telegram bot accepts a link, fetches it, summarizes it and archives a snapshot. Telegram webhook retries are idempotent.",
    url: "https://example.com/telegram-bot",
  });
  await seed(db, {
    title: "微信公众号文章抓取",
    content: "这是一个关于网页抓取与正文净化的中文示例，正文会被转换成 markdown 输出，并保留配图与作者信息。".repeat(3),
    platform: "wechat",
    provider: "wechat-native",
    url: "https://mp.weixin.qq.com/s/example",
  });
}

function searchUrl(query: string, extra = ""): string {
  return `http://local/api/search?q=${encodeURIComponent(query)}${extra}`;
}

describe("full-text search API", () => {
  test("ranks a title match above body matches (fts mode)", async () => {
    const { app, db, close } = await setupApp();
    await seedCorpus(db);

    const response = await app.handle(new Request(searchUrl("markdown")));
    expect(response.status).toBe(200);
    const body = (await response.json()) as any;

    expect(body.mode).toBe("fts");
    expect(body.fallback).toBe(false);
    expect(body.total).toBe(2);
    expect(body.items).toHaveLength(2);
    expect(body.items[0].title).toBe("Understanding Markdown Pipelines");
    expect(body.items[0].score).toBeGreaterThan(body.items[1].score);
    expect(body.items[0].snippet.toLowerCase()).toContain("markdown");
    expect(body.items[0].og.site_name).toBe("Fixture");
    expect(typeof body.took_ms).toBe("number");
    await close();
  });

  test("supports CJK queries through the substring path", async () => {
    const { app, db, close } = await setupApp();
    await seedCorpus(db);

    const response = await app.handle(new Request(searchUrl("网页抓取")));
    expect(response.status).toBe(200);
    const body = (await response.json()) as any;

    expect(body.mode).toBe("substring");
    expect(body.total).toBe(1);
    expect(body.items[0].title).toBe("微信公众号文章抓取");
    expect(body.items[0].platform).toBe("wechat");
    expect(body.items[0].snippet).toContain("网页抓取");
    await close();
  });

  test("treats LIKE wildcards literally and handles no results", async () => {
    const { app, db, close } = await setupApp();
    await seedCorpus(db);

    const wildcard = await app.handle(new Request(searchUrl("%")));
    const wildcardBody = (await wildcard.json()) as any;
    expect(wildcardBody.total).toBe(0);
    expect(wildcardBody.items).toEqual([]);

    const missing = await app.handle(new Request(searchUrl("nonexistenttopic")));
    const missingBody = (await missing.json()) as any;
    expect(missingBody.total).toBe(0);
    expect(missingBody.fallback).toBe(true);
    await close();
  });

  test("filters by platform and paginates with next_offset", async () => {
    const { app, db, close } = await setupApp();
    await seedCorpus(db);

    const filtered = await app.handle(new Request(searchUrl("markdown", "&platform=wechat")));
    const filteredBody = (await filtered.json()) as any;
    expect(filteredBody.total).toBe(1);
    expect(filteredBody.items[0].platform).toBe("wechat");

    const page = await app.handle(new Request(searchUrl("markdown", "&limit=1")));
    const pageBody = (await page.json()) as any;
    expect(pageBody.items).toHaveLength(1);
    expect(pageBody.total).toBe(2);
    expect(pageBody.next_offset).toBe(1);

    const second = await app.handle(new Request(searchUrl("markdown", "&limit=1&offset=1")));
    const secondBody = (await second.json()) as any;
    expect(secondBody.items).toHaveLength(1);
    expect(secondBody.items[0].id).not.toBe(pageBody.items[0].id);
    await close();
  });

  test("supports recent sort and validates input", async () => {
    const { app, db, close } = await setupApp();
    await seedCorpus(db);

    const recent = await app.handle(new Request(searchUrl("markdown", "&sort=recent")));
    const recentBody = (await recent.json()) as any;
    expect(recentBody.items).toHaveLength(2);
    expect(new Date(recentBody.items[0].created_at).getTime())
      .toBeGreaterThanOrEqual(new Date(recentBody.items[1].created_at).getTime());

    const missingQuery = await app.handle(new Request("http://local/api/search"));
    expect(missingQuery.status).toBe(400);
    expect(((await missingQuery.json()) as any).error.code).toBe("invalid_body");

    const badLimit = await app.handle(new Request(searchUrl("markdown", "&limit=999")));
    expect(badLimit.status).toBe(400);
    await close();
  });
});
