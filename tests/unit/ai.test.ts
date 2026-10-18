import { describe, expect, test } from "bun:test";
import { buildMessages, parseOutput } from "../../src/ai/prompts.ts";
import { OpenRouterProvider } from "../../src/ai/openrouter.ts";
import { AppError } from "../../src/contracts/errors.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("prompt building", () => {
  test("wraps untrusted content and names the target language", () => {
    const messages = buildMessages({
      task: "summarize",
      text: "Some article body",
      title: "A title",
      language: "zh",
      summaryLength: "short",
    });
    expect(messages[0]!.content).toContain("untrusted data");
    expect(messages[0]!.content).toContain("简体中文");
    expect(messages[1]!.content).toContain("<article>");
    expect(messages[1]!.content).toContain("A title");
  });

  test("truncates oversized input", () => {
    const messages = buildMessages({ task: "tags", text: "x".repeat(20000), language: "en" });
    expect(messages[1]!.content.length).toBeLessThan(14000);
  });
});

describe("output parsing", () => {
  test("parses tags and titles", () => {
    expect(parseOutput("tags", "前端, 抓取、Markdown;测试")).toEqual(["前端", "抓取", "Markdown", "测试"]);
    expect(parseOutput("titles", "1. 标题一\n2. 标题二\n3. 标题三\n4. 多余")).toEqual(["标题一", "标题二", "标题三"]);
  });

  test("parses analyze cards and tolerates fences or invalid json", () => {
    const parsed = parseOutput("analyze", '```json\n{"key_points":["a"],"entities":[],"data_points":[],"open_questions":[]}\n```');
    expect(parsed).toMatchObject({ key_points: ["a"] });
    expect(parseOutput("analyze", "not json")).toEqual({ raw: "not json" });
  });

  test("keeps plain text for summarize and translate", () => {
    expect(parseOutput("summarize", "  一句摘要。 ")).toBe("一句摘要。");
  });
});

describe("OpenRouter provider", () => {
  test("is unavailable without a key", async () => {
    const provider = new OpenRouterProvider({
      apiKey: "",
      freeModel: "free-model:free",
      fallbackModels: [],
    });
    expect(provider.available).toBe(false);
    await expect(provider.run({ task: "tags", text: "hello" })).rejects.toBeInstanceOf(AppError);
  });

  test("sends free models first and reports model/cost", async () => {
    let body: Record<string, unknown> = {};
    const provider = new OpenRouterProvider({
      apiKey: "key",
      freeModel: "free:free",
      qualityModel: "paid/model",
      fallbackModels: ["second:free"],
      fetchImpl: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        body = JSON.parse(String(init?.body));
        return jsonResponse({
          model: "free:free",
          choices: [{ message: { content: "结果" } }],
          usage: { cost: 0.0012 },
        });
      }) as unknown as typeof fetch,
    });

    const result = await provider.run({ task: "summarize", text: "hello world", language: "zh" });
    expect(result.model).toBe("free:free");
    expect(result.content).toBe("结果");
    expect(result.costUsd).toBeGreaterThan(0);
    expect(body.models).toEqual(["free:free", "second:free"]);
  });

  test("prefers the quality model when requested", async () => {
    let body: Record<string, unknown> = {};
    const provider = new OpenRouterProvider({
      apiKey: "key",
      freeModel: "free:free",
      qualityModel: "paid/model",
      fallbackModels: ["second:free"],
      fetchImpl: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        body = JSON.parse(String(init?.body));
        return jsonResponse({ model: "paid/model", choices: [{ message: { content: "x" } }] });
      }) as unknown as typeof fetch,
    });
    await provider.run({ task: "titles", text: "hello", quality: true });
    expect(body.models).toEqual(["paid/model", "free:free", "second:free"]);
  });

  test("maps 429 to ai_rate_limited and other failures to ai_failed", async () => {
    const limited = new OpenRouterProvider({
      apiKey: "key",
      freeModel: "free:free",
      fallbackModels: [],
      fetchImpl: (async () => new Response("rate", { status: 429 })) as unknown as typeof fetch,
    });
    await expect(limited.run({ task: "tags", text: "x" })).rejects.toMatchObject({ code: "ai_rate_limited" });

    const broken = new OpenRouterProvider({
      apiKey: "key",
      freeModel: "free:free",
      fallbackModels: [],
      fetchImpl: (async () => new Response("boom", { status: 500 })) as unknown as typeof fetch,
    });
    await expect(broken.run({ task: "tags", text: "x" })).rejects.toMatchObject({ code: "ai_failed" });
  });
});
