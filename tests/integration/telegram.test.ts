import { describe, expect, test } from "bun:test";
import { setupApp, ARTICLE_HTML, JINA_RESPONSE, jsonResponse } from "../helpers/app.ts";
import type { App } from "../../src/app.ts";
import type { TelegramUpdate } from "../../src/telegram/webhook.ts";

const CHAT = { id: 424242, title: "test chat", type: "private" };
let counter = 1000;

function update(text: string, chat = CHAT): TelegramUpdate {
  counter += 1;
  return {
    update_id: counter,
    message: { message_id: counter, chat, from: { is_bot: false }, text },
  } as TelegramUpdate;
}

async function post(app: App, payload: TelegramUpdate, secret = "webhook-secret"): Promise<Response> {
  return app.handle(
    new Request("http://local/telegram/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret },
      body: JSON.stringify(payload),
    }),
  );
}

function setup() {
  const botCalls: Array<{ method: string; payload: Record<string, any> }> = [];
  const promise = setupApp({
    handler: (url, init) => {
      if (url.startsWith("http://bot.test")) {
        const method = new URL(url).pathname.split("/").pop() ?? "unknown";
        botCalls.push({ method, payload: JSON.parse(String(init?.body ?? "{}")) });
        return jsonResponse({ ok: true, result: { message_id: botCalls.length } });
      }
      if (url.includes("r.jina.ai")) return jsonResponse(JINA_RESPONSE);
      return new Response(ARTICLE_HTML, { status: 200, headers: { "content-type": "text/html" } });
    },
  });
  return { botCalls, promise };
}

describe("telegram webhook", () => {
  test("rejects a wrong webhook secret", async () => {
    const { promise, botCalls } = setup();
    const { app, close } = await promise;
    const response = await post(app, update("/start"), "wrong");
    expect(response.status).toBe(401);
    expect(botCalls).toHaveLength(0);
    await close();
  });

  test("refuses to fetch before binding, then completes the card flow", async () => {
    const { promise, botCalls } = setup();
    const { app, close } = await promise;

    await post(app, update("/start"));
    await app.drainBackground();
    expect(botCalls.at(-1)!.payload.text).toContain("/bind");

    const preBind = await post(app, update("https://example.com/pre"));
    expect(preBind.status).toBe(200);
    await app.drainBackground();
    expect(botCalls.at(-1)!.payload.text).toContain("尚未绑定");

    await post(app, update("/bind wrong-code"));
    await app.drainBackground();
    expect(botCalls.at(-1)!.payload.text).toContain("绑定码不正确");

    await post(app, update("/bind bind-code-123"));
    await app.drainBackground();
    expect(botCalls.at(-1)!.payload.text).toContain("绑定成功");

    const before = botCalls.length;
    await post(app, update("https://example.com/article with text"));
    await app.drainBackground();
    const card = botCalls.slice(before).find((call) => call.method === "sendPhoto" || call.method === "sendMessage")!;
    expect(card).toBeDefined();
    const text = String(card.payload.caption ?? card.payload.text);
    expect(text).toContain("Deterministic Article");
    expect(text).toContain("Fixture Site");
    expect(JSON.stringify(card.payload.reply_markup)).toContain("打开原文");

    const duplicateUpdate = update("https://example.com/dup");
    await post(app, duplicateUpdate);
    await app.drainBackground();
    const afterFirst = botCalls.length;
    await post(app, duplicateUpdate);
    await app.drainBackground();
    expect(botCalls.length).toBe(afterFirst);

    await close();
  });

  test("uses a fallback summary when AI is unavailable and keeps settings working", async () => {
    const { promise, botCalls } = setup();
    const { app, close } = await promise;

    await post(app, update("/bind bind-code-123"));
    await app.drainBackground();
    await post(app, update("/summary long"));
    await app.drainBackground();
    expect(botCalls.at(-1)!.payload.text).toContain("摘要长度已设置为 long");

    await post(app, update("/lang en"));
    await app.drainBackground();
    expect(botCalls.at(-1)!.payload.text).toContain("en");

    await post(app, update("/translate on"));
    await app.drainBackground();
    expect(botCalls.at(-1)!.payload.text).toContain("翻译已开启");

    await post(app, update("/archive off"));
    await app.drainBackground();
    expect(botCalls.at(-1)!.payload.text).toContain("存档已关闭");

    await post(app, update("/badcommand"));
    await app.drainBackground();
    expect(botCalls.at(-1)!.payload.text).toContain("未识别的指令");

    await post(app, update("/help"));
    await app.drainBackground();
    expect(botCalls.at(-1)!.payload.text).toContain("/summary short|medium|long");

    await post(app, update("https://example.com/final"));
    await app.drainBackground();
    const last = botCalls.at(-1)!;
    const text = String(last.payload.caption ?? last.payload.text);
    expect(text).toContain("Deterministic Article");
    expect(last.payload.reply_markup).toBeDefined();

    await close();
  });

  test("ignores updates without text and bot senders", async () => {
    const { promise, botCalls } = setup();
    const { app, close } = await promise;
    const empty = await post(app, { update_id: 9999 } as TelegramUpdate);
    expect(empty.status).toBe(200);
    const fromBot = await post(app, {
      update_id: 9998,
      message: { message_id: 1, chat: CHAT, from: { is_bot: true }, text: "https://example.com" },
    } as TelegramUpdate);
    expect(fromBot.status).toBe(200);
    await app.drainBackground();
    expect(botCalls).toHaveLength(0);
    await close();
  });
});
