import { AppError } from "../../contracts/errors.ts";
import { parseGithubRepo } from "../platform.ts";
import { httpRequest, fetchJson } from "./http.ts";
import type { RawDocument } from "./common.ts";
import type { FetcherContext } from "./self.ts";

interface GithubRepo {
  full_name: string;
  description: string | null;
  html_url: string;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  language: string | null;
  topics?: string[];
  license?: { spdx_id?: string | null; name?: string | null } | null;
  owner?: { login?: string; avatar_url?: string };
  created_at?: string;
  pushed_at?: string;
  homepage?: string | null;
  archived?: boolean;
}

function headers(ctx: FetcherContext): Record<string, string> {
  const base: Record<string, string> = {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
  };
  if (ctx.config.githubToken) base.authorization = `Bearer ${ctx.config.githubToken}`;
  return base;
}

function buildMarkdown(repo: GithubRepo, readme: string, ogImage: string | null): string {
  const parts: string[] = [];
  parts.push(`# ${repo.full_name}`);
  if (repo.description) parts.push(`\n> ${repo.description}`);
  const meta: string[] = [];
  meta.push(`⭐ ${repo.stargazers_count}`);
  meta.push(`🍴 ${repo.forks_count}`);
  if (repo.language) meta.push(`语言：${repo.language}`);
  if (repo.license?.spdx_id) meta.push(`协议：${repo.license.spdx_id}`);
  if (repo.topics?.length) meta.push(`标签：${repo.topics.slice(0, 8).join(" / ")}`);
  if (repo.homepage) meta.push(`主页：${repo.homepage}`);
  parts.push(`\n${meta.join(" · ")}`);
  if (ogImage) parts.push(`\n![${repo.full_name}](${ogImage})`);
  if (readme.trim()) {
    parts.push("\n---\n");
    parts.push(readme.trim());
  }
  return parts.join("\n");
}

/**
 * GitHub repositories are fetched through the REST API (keyless, rate limited).
 * The README doubles as the article body; DeepWiki-style services are optional
 * because they rate limit aggressively and need browser-grade requests.
 */
export async function githubFetch(url: URL, ctx: FetcherContext): Promise<RawDocument> {
  const { owner, repo } = parseGithubRepo(url);
  const api = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const startedAt = Date.now();

  let repository: GithubRepo;
  try {
    const { data } = await fetchJson<GithubRepo>(api, {
      fetchImpl: ctx.fetchImpl,
      headers: headers(ctx),
      timeoutMs: ctx.config.httpTimeoutMs,
      maxBytes: 2 * 1024 * 1024,
    });
    repository = data;
  } catch (error) {
    const message = (error as Error).message;
    if (/status 403|status 429/.test(message)) {
      throw new AppError("provider_unavailable", `github api rate limited: ${message}`);
    }
    throw new AppError("fetch_failed", `github repo request failed: ${message}`);
  }

  let readme = "";
  try {
    const result = await httpRequest(`${api}/readme`, {
      fetchImpl: ctx.fetchImpl,
      headers: { ...headers(ctx), accept: "application/vnd.github.raw+json" },
      timeoutMs: ctx.config.httpTimeoutMs,
      maxBytes: 2 * 1024 * 1024,
      followRedirects: true,
    });
    if (result.status === 200) readme = result.text;
  } catch {
    readme = "";
  }

  const ogImage = `https://opengraph.githubassets.com/1/${owner}/${repo}`;
  const markdown = buildMarkdown(repository, readme, ogImage);
  return {
    provider: "github-api",
    finalUrl: repository.html_url ?? url.toString(),
    markdown,
    title: repository.full_name,
    author: repository.owner?.login ? `${repository.owner.login} (GitHub)` : null,
    publishedAt: repository.pushed_at ?? null,
    images: [ogImage, repository.owner?.avatar_url ?? ""].filter(Boolean),
    language: /[\u4e00-\u9fff]/.test(readme) ? "zh" : "en",
    ogOverride: {
      image: ogImage,
      title: repository.full_name,
      description: repository.description ?? null,
      site_name: "GitHub",
    },
    latencyMs: Date.now() - startedAt,
    costUsd: 0,
    notes: ["github rest api", `readme ${readme.length} chars`],
  };
}
