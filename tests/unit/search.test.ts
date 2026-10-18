import { describe, expect, test } from "bun:test";
import {
  escapeLike,
  hasCjk,
  makeSnippet,
  normalizeQuery,
  queryTerms,
} from "../../src/search/search-query.ts";

describe("search query normalization", () => {
  test("trims and collapses whitespace", () => {
    expect(normalizeQuery("  web   scraping \n")).toBe("web scraping");
  });

  test("rejects empty and overly long queries", () => {
    expect(() => normalizeQuery("   ")).toThrow();
    expect(() => normalizeQuery("x".repeat(201))).toThrow();
  });

  test("detects CJK scripts", () => {
    expect(hasCjk("网页抓取")).toBe(true);
    expect(hasCjk("日本語")).toBe(true);
    expect(hasCjk("web scraping")).toBe(false);
  });

  test("escapes LIKE wildcards", () => {
    expect(escapeLike("100%_done")).toBe("100\\%\\_done");
    expect(escapeLike("a\\b")).toBe("a\\\\b");
  });
});

describe("query terms", () => {
  test("splits latin words and keeps CJK as one phrase", () => {
    expect(queryTerms("Markdown browser")).toEqual(["Markdown", "browser"]);
    expect(queryTerms("网页抓取")).toEqual(["网页抓取"]);
    expect(queryTerms("a")).toEqual(["a"]);
  });
});

describe("snippet building", () => {
  test("centers around the first match with ellipses", () => {
    const text = `${"前缀内容 ".repeat(40)}关键词 markdown 出现在这里 ${"后缀内容 ".repeat(40)}`;
    const snippet = makeSnippet(text, ["markdown"], 120);
    expect(snippet).toContain("markdown");
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
  });

  test("strips markdown noise and respects the length budget", () => {
    const text = `# 标题\n\n![img](https://cdn.test/a.png)\n\n[链接](https://example.com) ${"正文 ".repeat(200)}`;
    const snippet = makeSnippet(text, ["正文"], 100);
    expect(snippet).not.toContain("![img]");
    expect(snippet).not.toContain("https://cdn.test");
    expect(snippet.length).toBeLessThanOrEqual(112);
  });

  test("falls back to the head when nothing matches", () => {
    const snippet = makeSnippet("Some unrelated content that is quite short.", ["missing"]);
    expect(snippet).toBe("Some unrelated content that is quite short.");
  });
});
