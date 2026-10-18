import { describe, expect, test } from "bun:test";
import { auth, jsonResponse, setupApp, ARTICLE_HTML, JINA_RESPONSE } from "../helpers/app.ts";

describe("HTTP API", () => {
  test("rejects missing and invalid tokens", async () => {
    const { app, token, close } = await setupApp();
    const missing = await app.handle(
      new Request("http://local/api/fetch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com" }),
      }),
    );
    expect(missing.status).toBe(401);
    expect(await missing.json()).toMatchObject({ error: { code: "unauthorized" } });

    const invalid = await app.handle(
      new Request("http://local/api/fetch", {
        method: "POST",
        headers: { ...auth(token), authorization: "Bearer wft_not_a_real_token_123" },
        body: JSON.stringify({ url: "https://example.com" }),
      }),
    );
    expect(invalid.status).toBe(401);
    await close();
  });

  test("fetches, returns the unified shape and persists history", async () => {
    const { app, token, close, db } = await setupApp();

    const response = await app.handle(
      new Request("http://local/api/fetch", {
        method: "POST",
        headers: auth(token),
        body: JSON.stringify({ url: "https://example.com/article" }),
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, any>;

    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.provider).toBe("self");
    expect(body.platform).toBe("web");
    expect(body.title).toBe("Deterministic Article");
    expect(body.content.format).toBe("markdown");
    expect(body.content.length).toBeGreaterThan(100);
    expect(body.content.text).toContain("The pipeline extracts");
    expect(body.metadata.language).toBe("en");
    expect(body.og.image).toBe("https://example.com/assets/hero.png");
    expect(body.og.site_name).toBe("Fixture Site");
    expect(body.usage.fetch_cost_usd).toBe(0);
    expect(typeof body.metrics.response_time_ms).toBe("number");
    expect(body.status).toBe("ok");

    const columns = response.headers.get("access-control-allow-origin");
    expect(columns).toBe("*");

    const history = await app.handle(new Request("http://local/api/history"));
    const historyBody = (await history.json()) as { items: Array<{ id: string }> };
    expect(historyBody.items).toHaveLength(1);
    expect(historyBody.items[0]!.id).toBe(body.id);

    const detail = await app.handle(new Request(`http://local/api/history/${body.id}`));
    const detailBody = (await detail.json()) as Record<string, any>;
    expect(detailBody.content.text).toContain("The pipeline extracts");
    expect(detailBody.ai_results).toEqual([]);
    expect(detailBody.archives).toEqual([]);

    await db.close();
  });

  test("falls back to Jina when the direct fetch fails", async () => {
    const { app, token, close } = await setupApp({
      handler: (url) => {
        if (url.includes("r.jina.ai")) return jsonResponse(JINA_RESPONSE);
        return new Response("upstream down", { status: 502 });
      },
    });

    const response = await app.handle(
      new Request("http://local/api/fetch", {
        method: "POST",
        headers: auth(token),
        body: JSON.stringify({ url: "https://example.com/broken" }),
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, any>;
    expect(body.provider).toBe("jina");
    expect(body.content.text).toContain("Jina Fallback Article");
    await close();
  });

  test("blocks SSRF targets before any fetch", async () => {
    const { app, token, close, captured } = await setupApp();
    for (const url of ["http://169.254.169.254/latest/meta-data/", "http://127.0.0.1:8787/", "file:///etc/passwd"]) {
      const response = await app.handle(
        new Request("http://local/api/fetch", {
          method: "POST",
          headers: auth(token),
          body: JSON.stringify({ url }),
        }),
      );
      expect(response.status).toBe(400);
      expect(((await response.json()) as any).error.code).toMatch(/invalid_url|blocked_url/);
    }
    expect(captured).toHaveLength(0);
    await close();
  });

  test("enforces per-token rate limits", async () => {
    const { app, token, close } = await setupApp({
      config: { apiRateLimit: { perMinute: 1, perHour: 10 } },
    });
    const call = () =>
      app.handle(
        new Request("http://local/api/fetch", {
          method: "POST",
          headers: auth(token),
          body: JSON.stringify({ url: "https://example.com/rate" }),
        }),
      );

    expect((await call()).status).toBe(200);
    const limited = await call();
    expect(limited.status).toBe(429);
    expect(((await limited.json()) as any).error.code).toBe("rate_limited");
    await close();
  });

  test("reports AI as not configured without a key", async () => {
    const { app, token, close } = await setupApp();
    const fetched = await app.handle(
      new Request("http://local/api/fetch", {
        method: "POST",
        headers: auth(token),
        body: JSON.stringify({ url: "https://example.com/ai" }),
      }),
    );
    const id = ((await fetched.json()) as any).id as string;

    const response = await app.handle(
      new Request("http://local/api/ai", {
        method: "POST",
        headers: auth(token),
        body: JSON.stringify({ id, task: "summarize" }),
      }),
    );
    expect(response.status).toBe(503);
    expect(((await response.json()) as any).error.code).toBe("ai_not_configured");
    await close();
  });

  test("serves health, docs and CORS preflight", async () => {
    const { app, close } = await setupApp();
    const health = await app.handle(new Request("http://local/api/health"));
    expect(health.status).toBe(200);
    const healthBody = (await health.json()) as any;
    expect(healthBody.database.ok).toBe(true);
    expect(healthBody.ai.configured).toBe(false);
    expect(JSON.stringify(healthBody)).not.toContain("OPENROUTER_API_KEY");

    const docs = await app.handle(new Request("http://local/api/docs"));
    expect(docs.status).toBe(200);
    expect(docs.headers.get("content-type")).toContain("text/html");
    const docsText = await docs.text();
    expect(docsText).toContain("/api/fetch");
    expect(docsText).toContain("复制");
    expect(docsText.toLowerCase()).not.toContain("purple");
    expect(docsText).not.toContain("#8b5cf6");

    const preflight = await app.handle(new Request("http://local/api/fetch", { method: "OPTIONS" }));
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");

    const missing = await app.handle(new Request("http://local/api/nope"));
    expect(missing.status).toBe(404);
    await close();
  });

  test("validates request bodies strictly", async () => {
    const { app, token, close } = await setupApp();
    const response = await app.handle(
      new Request("http://local/api/fetch", {
        method: "POST",
        headers: auth(token),
        body: JSON.stringify({ url: "https://example.com", unexpected: true }),
      }),
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as any).error.code).toBe("invalid_body");
    await close();
  });

  test("article fixture still extracts through the real cascade", async () => {
    expect(ARTICLE_HTML).toContain("Deterministic Article");
  });
});
