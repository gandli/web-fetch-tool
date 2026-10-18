import { AppError } from "../contracts/errors.ts";
import { httpRequest } from "../core/fetch/http.ts";
import { settingsRepo } from "../db/repositories.ts";
import type { ArchiveAdapter, ArchiveContext, ArchiveInput, ArchiveSaveResult } from "./types.ts";

interface TelegraphNode {
  tag: string;
  attrs?: Record<string, string>;
  children?: Array<TelegraphNode | string>;
}

interface TelegraphAccountResponse {
  ok: boolean;
  result?: { access_token?: string };
  error?: string;
}

interface TelegraphPageResponse {
  ok: boolean;
  result?: { url?: string; path?: string };
  error?: string;
}

const MAX_NODES = 300;

function inlineText(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/<\/?[^>]+>/g, "")
    .trim();
}

/** Convert the subset of Markdown we produce into Telegraph nodes. */
export function markdownToNodes(markdown: string): TelegraphNode[] {
  const nodes: TelegraphNode[] = [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let inCode = false;
  let codeLines: string[] = [];

  const flushParagraph = () => {
    const text = inlineText(paragraph.join(" "));
    paragraph = [];
    if (text) nodes.push({ tag: "p", children: [text] });
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items
      .map((item) => inlineText(item))
      .filter(Boolean)
      .map((item) => ({ tag: "li", children: [item] }));
    if (items.length) nodes.push({ tag: list.ordered ? "ol" : "ul", children: items });
    list = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (line.trim().startsWith("```")) {
      if (inCode) {
        nodes.push({ tag: "pre", children: [codeLines.join("\n")] });
        codeLines = [];
        inCode = false;
      } else {
        flushParagraph();
        flushList();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeLines.push(rawLine);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    const image = line.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/);
    if (image) {
      flushParagraph();
      flushList();
      nodes.push({ tag: "figure", children: [{ tag: "img", attrs: { src: image[2]! } }] });
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const tag = heading[1]!.length <= 2 ? "h3" : "h4";
      nodes.push({ tag, children: [inlineText(heading[2]!)] });
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      flushParagraph();
      flushList();
      nodes.push({ tag: "hr" });
      continue;
    }

    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      flushList();
      const text = inlineText(quote[1]!);
      if (text) nodes.push({ tag: "blockquote", children: [text] });
      continue;
    }

    const ordered = line.match(/^\s*\d+[.)、]\s+(.*)$/);
    const unordered = line.match(/^\s*[-*+]\s+(.*)$/);
    if (ordered || unordered) {
      flushParagraph();
      const isOrdered = Boolean(ordered);
      if (!list || list.ordered !== isOrdered) {
        flushList();
        list = { ordered: isOrdered, items: [] };
      }
      list.items.push((ordered?.[1] ?? unordered?.[1])!);
      continue;
    }

    flushList();
    paragraph.push(line.trim());
  }

  flushParagraph();
  flushList();
  if (inCode && codeLines.length) nodes.push({ tag: "pre", children: [codeLines.join("\n")] });
  return nodes.slice(0, MAX_NODES);
}

async function getAccountToken(ctx: ArchiveContext): Promise<string> {
  const cached = await settingsRepo.get<{ token?: string }>(ctx.db, "telegraph_account");
  if (cached?.token) return cached.token;

  const response = await httpRequest(
    "https://api.telegra.ph/createAccount?short_name=web-fetch-tool&author_name=Web%20Fetch",
    { fetchImpl: ctx.fetchImpl, timeoutMs: 15000, maxBytes: 256 * 1024, followRedirects: true },
  );
  let parsed: TelegraphAccountResponse;
  try {
    parsed = JSON.parse(response.text) as TelegraphAccountResponse;
  } catch {
    throw new AppError("archive_failed", "telegraph createAccount invalid json");
  }
  const token = parsed.result?.access_token;
  if (!parsed.ok || !token) {
    throw new AppError("archive_failed", `telegraph createAccount failed: ${parsed.error ?? "unknown"}`);
  }
  await settingsRepo.set(ctx.db, "telegraph_account", { token, created_at: new Date().toISOString() });
  return token;
}

/** Telegraph: keyless public snapshot, the default archive channel. */
export const telegraphAdapter: ArchiveAdapter = {
  channel: "telegraph",
  isConfigured: (ctx) => ctx.config.telegraphEnabled,
  async save(input: ArchiveInput, ctx: ArchiveContext): Promise<ArchiveSaveResult> {
    const token = await getAccountToken(ctx);
    const content = markdownToNodes(input.markdown).slice(0, MAX_NODES);

    const response = await httpRequest("https://api.telegra.ph/createPage", {
      method: "POST",
      fetchImpl: ctx.fetchImpl,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        access_token: token,
        title: input.title.slice(0, 256) || "Untitled",
        author_name: "Web Fetch",
        content,
        return_content: false,
      }),
      timeoutMs: 20000,
      maxBytes: 512 * 1024,
      followRedirects: true,
    });

    if (response.status === 429) throw new AppError("archive_rate_limited", "telegraph 429");
    if (response.status >= 400) {
      throw new AppError("archive_failed", `telegraph status ${response.status}: ${response.text.slice(0, 200)}`);
    }

    let parsed: TelegraphPageResponse;
    try {
      parsed = JSON.parse(response.text) as TelegraphPageResponse;
    } catch {
      throw new AppError("archive_failed", "telegraph createPage invalid json");
    }
    if (!parsed.ok || !parsed.result?.url) {
      throw new AppError("archive_failed", `telegraph createPage failed: ${parsed.error ?? "unknown"}`);
    }
    return { url: parsed.result.url, externalId: parsed.result.path ?? null };
  },
};
