import { AppError } from "../contracts/errors.ts";
import type { AppConfig } from "../config.ts";
import { httpRequest } from "../core/fetch/http.ts";
import { buildMessages, parseOutput, TASK_MAX_TOKENS } from "./prompts.ts";
import type { AiProvider, AiRequest, AiResponse } from "./types.ts";

interface OpenRouterChoice {
  message?: { content?: string | null };
  finish_reason?: string;
}

interface OpenRouterResponse {
  model?: string;
  choices?: OpenRouterChoice[];
  usage?: { cost?: number; total_tokens?: number };
  error?: { message?: string; code?: number };
}

export interface OpenRouterOptions {
  apiKey: string;
  freeModel: string;
  qualityModel?: string;
  fallbackModels: string[];
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * OpenRouter provider. Free models come first, paid quality mode is opt-in, and
 * the model fallback list is handled server-side by OpenRouter.
 */
export class OpenRouterProvider implements AiProvider {
  readonly available: boolean;
  readonly defaultModel: string;
  private readonly options: OpenRouterOptions;

  constructor(options: OpenRouterOptions) {
    this.options = options;
    this.available = Boolean(options.apiKey);
    this.defaultModel = options.freeModel;
  }

  private models(quality: boolean | undefined): string[] {
    const ordered = [
      quality && this.options.qualityModel ? this.options.qualityModel : this.options.freeModel,
      this.options.freeModel,
      ...this.options.fallbackModels,
    ];
    return [...new Set(ordered.filter(Boolean))];
  }

  async run(request: AiRequest): Promise<AiResponse> {
    if (!this.available) throw new AppError("ai_not_configured", "OPENROUTER_API_KEY is empty");

    const models = this.models(request.quality);
    const body = {
      models,
      route: "fallback",
      messages: buildMessages(request),
      temperature: request.task === "analyze" || request.task === "tags" ? 0.2 : 0.5,
      max_tokens: TASK_MAX_TOKENS[request.task],
      usage: { include: true },
    };

    let response;
    try {
      response = await httpRequest("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        fetchImpl: this.options.fetchImpl,
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          "content-type": "application/json",
          "http-referer": "http://localhost",
          "x-title": "web-fetch-tool",
          accept: "application/json",
        },
        body: JSON.stringify(body),
        timeoutMs: this.options.timeoutMs ?? 30000,
        maxBytes: 4 * 1024 * 1024,
        followRedirects: true,
      });
    } catch (error) {
      throw new AppError("ai_failed", error instanceof Error ? error.message : String(error));
    }

    if (response.status === 429) throw new AppError("ai_rate_limited", "openrouter 429");
    if (response.status >= 400) {
      throw new AppError("ai_failed", `openrouter status ${response.status}: ${response.text.slice(0, 300)}`);
    }

    let parsed: OpenRouterResponse;
    try {
      parsed = JSON.parse(response.text) as OpenRouterResponse;
    } catch {
      throw new AppError("ai_failed", "openrouter returned invalid json");
    }
    if (parsed.error) throw new AppError("ai_failed", `openrouter error: ${parsed.error.message ?? "unknown"}`);

    const raw = parsed.choices?.[0]?.message?.content;
    if (!raw || !raw.trim()) throw new AppError("ai_failed", "openrouter returned empty content");

    return {
      kind: request.task,
      model: parsed.model ?? models[0]!,
      content: parseOutput(request.task, raw),
      costUsd: typeof parsed.usage?.cost === "number" ? parsed.usage.cost : 0,
    };
  }
}

export function createAiProvider(config: AppConfig, fetchImpl?: typeof fetch): OpenRouterProvider {
  return new OpenRouterProvider({
    apiKey: config.openrouterApiKey ?? "",
    freeModel: config.openrouterModelFree,
    qualityModel: config.openrouterModelQuality,
    fallbackModels: config.openrouterModelFallbacks,
    fetchImpl,
  });
}
