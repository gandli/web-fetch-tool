import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { buildCard, escapeHtml } from "../../src/telegram/card.ts";
import { extractFirstUrl } from "../../src/telegram/webhook.ts";
import { BotApi } from "../../src/telegram/bot-api.ts";
import { authenticate, extractToken, hashToken, issueToken, safeEqual, tokenPrefix } from "../../src/auth/tokens.ts";
import { tokenRepo } from "../../src/db/repositories.ts";
import { PgliteDb } from "../../src/db/pglite.ts";
import { migrate } from "../../src/db/migrate.ts";
import { MIGRATIONS } from "../helpers/app.ts";

describe("telegram card", () => {
  test("escapes html and builds source/archive buttons", () => {
    const card = buildCard({
      title: "<b>Hello & welcome</b>",
      url: "https://example.com/a",
      summary: "A summary",
      tags: ["ai", "web tools"],
      archiveUrl: "https://telegra.ph/x",
      image: "https://cdn.test/a.jpg",
      siteName: "Example",
      platform: "web",
    });
    expect(card.text).toContain("&lt;b&gt;Hello &amp; welcome&lt;/b&gt;");
    expect(card.text).toContain("#ai #web_tools");
    expect(card.usePhoto).toBe(true);
    expect(card.keyboard.inline_keyboard[0]!.map((b) => b.text)).toEqual(["打开原文", "存档快照"]);
  });

  test("truncates long captions and omits the archive button", () => {
    const card = buildCard({
      title: "T",
      url: "https://example.com",
      summary: "长".repeat(3000),
      tags: null,
      archiveUrl: null,
      image: null,
      siteName: null,
      platform: "web",
    });
    expect(card.caption.length).toBeLessThanOrEqual(1024);
    expect(card.usePhoto).toBe(false);
    expect(card.keyboard.inline_keyboard[0]).toHaveLength(1);
  });

  test("escapeHtml covers the three risky characters", () => {
    expect(escapeHtml("<a & b>")).toBe("&lt;a &amp; b&gt;");
  });
});

describe("telegram url extraction", () => {
  test("finds the first url and trims punctuation", () => {
    expect(extractFirstUrl("看这个 https://example.com/a?b=1。 很好")).toBe("https://example.com/a?b=1");
    expect(extractFirstUrl("(https://example.com/x)")).toBe("https://example.com/x");
    expect(extractFirstUrl("no url here")).toBeNull();
  });
});

describe("telegram bot api", () => {
  test("posts to the configured base and reports failures", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const bot = new BotApi("123:ABC", "http://bot.test", (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
    }) as unknown as typeof fetch);

    await bot.sendMessage(42, "hello", { parseMode: "HTML" });
    expect(calls[0]!.url).toBe("http://bot.test/bot123:ABC/sendMessage");
    expect(calls[0]!.body.chat_id).toBe(42);
    expect(calls[0]!.body.parse_mode).toBe("HTML");

    const failing = new BotApi("123:ABC", "http://bot.test", (async () =>
      new Response(JSON.stringify({ ok: false, description: "blocked" }), { status: 200 })) as unknown as typeof fetch);
    await expect(failing.sendMessage(1, "x")).rejects.toMatchObject({ code: "internal" });

    const unconfigured = new BotApi(undefined, "http://bot.test");
    await expect(unconfigured.sendMessage(1, "x")).rejects.toMatchObject({ code: "telegram_not_configured" });
  });
});

describe("api tokens", () => {
  test("issues prefixed tokens and hashes deterministically", () => {
    const issued = issueToken();
    expect(issued.token.startsWith("wft_")).toBe(true);
    expect(issued.prefix).toBe(tokenPrefix(issued.token));
    expect(issued.hash).toBe(hashToken(issued.token));
    expect(issued.hash).toHaveLength(64);
    expect(safeEqual(issued.hash, hashToken(issued.token))).toBe(true);
    expect(safeEqual(issued.hash, hashToken("other"))).toBe(false);
  });

  test("extracts bearer and api key headers", () => {
    expect(extractToken(new Headers({ authorization: "Bearer abc" }))).toBe("abc");
    expect(extractToken(new Headers({ authorization: "bearer abc" }))).toBe("abc");
    expect(extractToken(new Headers({ "x-api-key": "xyz" }))).toBe("xyz");
    expect(extractToken(new Headers())).toBeNull();
  });

  test("authenticates scopes against the database", async () => {
    const db = new PgliteDb();
    await migrate(db, MIGRATIONS);
    const issued = issueToken();
    await tokenRepo.create(db, {
      id: randomUUID(),
      name: "unit",
      prefix: issued.prefix,
      hash: issued.hash,
      scopes: ["fetch"],
    });

    const headers = new Headers({ authorization: `Bearer ${issued.token}` });
    const auth = await authenticate(db, headers, "fetch", { required: true });
    expect(auth?.token.name).toBe("unit");

    await expect(authenticate(db, headers, "ai", { required: true })).rejects.toMatchObject({ code: "forbidden" });
    await expect(authenticate(db, new Headers(), "fetch", { required: true })).rejects.toMatchObject({
      code: "unauthorized",
    });
    await expect(authenticate(db, new Headers(), "fetch", { required: false })).resolves.toBeNull();
    await db.close();
  });
});
