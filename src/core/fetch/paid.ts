import { AppError } from "../../contracts/errors.ts";
import type { RawDocument } from "./common.ts";
import type { FetcherContext } from "./self.ts";

export interface PaidEngine {
  name: string;
  costPerCallUsd: number;
  isConfigured: (config: FetcherContext["config"]) => boolean;
  fetch: (url: string, ctx: FetcherContext) => Promise<RawDocument>;
}

/**
 * Paid fallback adapters. They are registered so the chain, the health endpoint
 * and the docs can describe them, but the actual vendor calls are intentionally
 * not wired in this milestone: without a key they are skipped, and that is the
 * documented graceful-degradation path.
 */
function stub(name: string, envKey: string, costPerCallUsd: number): PaidEngine {
  return {
    name,
    costPerCallUsd,
    isConfigured: (config) => Boolean((config as unknown as Record<string, unknown>)[envKey]),
    fetch: async () => {
      throw new AppError("provider_unavailable", `${name} adapter is not wired in this milestone`);
    },
  };
}

export const paidEngines: PaidEngine[] = [
  stub("firecrawl", "firecrawlApiKey", 0.001),
  stub("tavily", "tavilyApiKey", 0.001),
  stub("exa", "exaApiKey", 0.001),
  stub("tinyfish", "tinyfishApiKey", 0.001),
  stub("openrouter-web-fetch", "openrouterApiKey", 0.001),
  stub("cloudflare-browser", "cloudflareApiToken", 0.001),
  stub("ollama-cloud", "ollamaCloudApiKey", 0.001),
];

export function findPaidEngine(name: string): PaidEngine | undefined {
  return paidEngines.find((engine) => engine.name === name);
}
