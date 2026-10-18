import { describe, expect, test } from "bun:test";
import { DOMParser } from "linkedom";
import { detectPlatform, parseGithubRepo, parseXStatus } from "../../src/core/platform.ts";
import { extractOg } from "../../src/core/og.ts";
import { extractArticle } from "../../src/core/extract/cascade.ts";
import { htmlToMarkdown, normalizeMarkdown } from "../../src/core/extract/markdown.ts";
import { detectLanguage } from "../../src/core/extract/language.ts";
import type { ExtractorOutput } from "../../src/core/extract/precision.ts";

function doc(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html") as unknown as Document;
}

describe("platform detection", () => {
  test("routes X status urls and rejects other X pages", () => {
    expect(detectPlatform("https://x.com/jack/status/20").platform).toBe("x");
    expect(detectPlatform("https://twitter.com/jack/statuses/20").platform).toBe("x");
    expect(detectPlatform("https://x.com/i/web/status/20").platform).toBe("x");
    expect(() => detectPlatform("https://x.com/home")).toThrow();
  });

  test("parses X status handles and ids", () => {
    expect(parseXStatus(new URL("https://x.com/jack/status/20"))).toEqual({ handle: "jack", id: "20" });
    expect(parseXStatus(new URL("https://x.com/i/web/status/20"))).toEqual({ handle: null, id: "20" });
  });

  test("routes WeChat, GitHub and experimental platforms", () => {
    expect(detectPlatform("https://mp.weixin.qq.com/s/abc").platform).toBe("wechat");
    expect(detectPlatform("https://github.com/cloudflare/workers-sdk").platform).toBe("github");
    expect(detectPlatform("https://github.com/cloudflare/workers-sdk/tree/main").platform).toBe("github");
    expect(detectPlatform("https://www.xiaohongshu.com/explore/1").platform).toBe("xiaohongshu");
    expect(detectPlatform("https://m.weibo.cn/detail/1").platform).toBe("weibo");
    expect(detectPlatform("https://zhuanlan.zhihu.com/p/1").platform).toBe("zhihu");
    expect(detectPlatform("https://example.com/post").platform).toBe("web");
  });

  test("marks experimental platforms", () => {
    expect(detectPlatform("https://www.xiaohongshu.com/explore/1").experimental).toBe(true);
    expect(detectPlatform("https://weibo.com/1/abc").experimental).toBe(true);
    expect(detectPlatform("https://www.zhihu.com/question/1").experimental).toBe(true);
    expect(detectPlatform("https://example.com").experimental).toBe(false);
  });

  test("parses GitHub owner/repo and rejects non-repo pages", () => {
    expect(parseGithubRepo(new URL("https://github.com/owner/repo"))).toEqual({ owner: "owner", repo: "repo" });
    expect(parseGithubRepo(new URL("https://github.com/owner/repo.git"))).toEqual({ owner: "owner", repo: "repo" });
    expect(() => detectPlatform("https://github.com/owner")).toThrow();
    expect(() => detectPlatform("https://github.com/orgs/cloudflare")).toThrow();
  });
});

describe("OG extraction", () => {
  test("prefers og:image and resolves relative urls", () => {
    const result = extractOg(
      doc(`<html><head>
        <meta property="og:image" content="/img/hero.png">
        <meta property="og:title" content="OG Title">
        <meta property="og:description" content="OG Description">
        <meta property="og:site_name" content="Site">
      </head><body></body></html>`),
      "https://example.com/posts/1",
    );
    expect(result.og.image).toBe("https://example.com/img/hero.png");
    expect(result.og.title).toBe("OG Title");
    expect(result.og.description).toBe("OG Description");
    expect(result.og.site_name).toBe("Site");
  });

  test("falls back to twitter:image then a content image", () => {
    const twitter = extractOg(
      doc(`<html><head><meta name="twitter:image" content="https://cdn.test/t.jpg"></head><body></body></html>`),
      "https://example.com",
    );
    expect(twitter.og.image).toBe("https://cdn.test/t.jpg");

    const contentImage = extractOg(
      doc(`<html><head></head><body><article>
        <img src="/pixel.gif" width="1" height="1">
        <img src="https://cdn.test/big.jpg" width="800" height="450" alt="big">
      </article></body></html>`),
      "https://example.com",
    );
    expect(contentImage.og.image).toBe("https://cdn.test/big.jpg");
  });

  test("falls back to favicon, then placeholder", () => {
    const favicon = extractOg(doc(`<html><head></head><body></body></html>`), "https://example.com/x");
    expect(favicon.og.image).toBe("https://example.com/favicon.ico");

    const placeholder = extractOg(doc(`<html><head></head><body></body></html>`), "", {
      placeholder: "https://placeholder.test/p.svg",
    });
    expect(placeholder.og.image).toBe("https://placeholder.test/p.svg");
  });
});

describe("markdown conversion", () => {
  test("keeps headings, code fences, tables and absolute images", () => {
    const markdown = htmlToMarkdown(
      `<h2>Title</h2><p>Hello <a href="/x">link</a></p>
       <pre><code>const a = 1;</code></pre>
       <table><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>
       <img src="/img/a.png" alt="a">`,
      "https://example.com/post",
    );
    expect(markdown).toContain("## Title");
    expect(markdown).toContain("```");
    expect(markdown).toContain("https://example.com/x");
    expect(markdown).toContain("https://example.com/img/a.png");
    expect(markdown).toMatch(/\|\s*A\s*\|/);
  });

  test("normalizes excessive blank lines", () => {
    expect(normalizeMarkdown("a\n\n\n\n\nb")).toBe("a\n\nb");
  });
});

describe("language heuristic", () => {
  test("detects common languages", () => {
    expect(detectLanguage("这是一段中文内容，用来测试语言识别。".repeat(3))).toBe("zh");
    expect(detectLanguage("This is an English paragraph used for language detection tests.")).toBe("en");
    expect(detectLanguage("これは日本語の文章です。".repeat(3))).toBe("ja");
    expect(detectLanguage("한국어 문장입니다. 반갑습니다.")).toBe("ko");
    expect(detectLanguage("", "zh-CN")).toBe("zh");
  });
});

function output(overrides: Partial<ExtractorOutput>): ExtractorOutput {
  return {
    markdown: "",
    text: "",
    title: null,
    author: null,
    publishedAt: null,
    language: null,
    images: [],
    extractor: "defuddle",
    length: 0,
    notes: [],
    ...overrides,
  };
}

describe("extraction cascade", () => {
  const precisionShort = output({ markdown: "short", text: "short", extractor: "defuddle", length: 100, title: "P" });
  const recallLong = output({
    markdown: "long ".repeat(100),
    text: "long",
    extractor: "readability",
    length: 300,
    title: "R",
    author: "Author R",
  });

  test("falls back to recall when precision keeps < 60%", async () => {
    const result = await extractArticle("<html></html>", "https://example.com", {
      extractors: {
        precision: async () => precisionShort,
        recall: () => recallLong,
      },
    });
    expect(result.debug.chosen).toBe("readability");
    expect(result.markdown.startsWith("long")).toBe(true);
    expect(result.debug.notes.join(" ")).toContain("used recall");
  });

  test("keeps precision when it keeps at least 60%", async () => {
    const result = await extractArticle("<html></html>", "https://example.com", {
      extractors: {
        precision: async () => output({ ...precisionShort, length: 180, markdown: "precision body" }),
        recall: () => recallLong,
      },
    });
    expect(result.debug.chosen).toBe("defuddle");
    expect(result.markdown).toBe("precision body");
  });

  test("uses the only available extractor", async () => {
    const recallOnly = await extractArticle("<html></html>", "https://example.com", {
      extractors: { precision: async () => null, recall: () => recallLong },
    });
    expect(recallOnly.extractor).toBe("readability");

    const precisionOnly = await extractArticle("<html></html>", "https://example.com", {
      extractors: { precision: async () => precisionShort, recall: () => null },
    });
    expect(precisionOnly.extractor).toBe("defuddle");
  });

  test("fails with content_empty when nothing is extracted", async () => {
    await expect(
      extractArticle("<html></html>", "https://example.com", {
        extractors: { precision: async () => null, recall: () => null },
      }),
    ).rejects.toMatchObject({ code: "content_empty" });
  });

  test("merges metadata and respects the character cap", async () => {
    const result = await extractArticle("<html></html>", "https://example.com", {
      og: { image: null, title: "OG", description: null, site_name: "OG Site" },
      maxChars: 20,
      extractors: {
        precision: async () => output({ ...precisionShort, title: null, author: null, length: 10 }),
        recall: () => recallLong,
      },
    });
    expect(result.title).toBe("R");
    expect(result.author).toBe("Author R");
    expect(result.siteName).toBe("OG Site");
    expect(result.markdown.length).toBeLessThanOrEqual(60);
    expect(result.markdown).toContain("已截断");
  });
});
