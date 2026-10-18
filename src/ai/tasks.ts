import { AppError } from "../contracts/errors.ts";
import type { AiProvider, AiRequest, AiResponse, SummaryLength } from "./types.ts";

export async function runAiTask(provider: AiProvider, request: AiRequest): Promise<AiResponse> {
  if (!provider.available) throw new AppError("ai_not_configured", "ai provider unavailable");
  if (!request.text.trim()) throw new AppError("content_empty", "ai input is empty");
  return provider.run(request);
}

/** Convenience wrapper used by the Telegram bot. */
export async function summarize(
  provider: AiProvider,
  text: string,
  options: { title?: string | null; language?: string; summaryLength?: SummaryLength; quality?: boolean } = {},
): Promise<string> {
  const response = await runAiTask(provider, {
    task: "summarize",
    text,
    title: options.title,
    language: options.language,
    summaryLength: options.summaryLength ?? "medium",
    quality: options.quality,
  });
  return typeof response.content === "string" ? response.content : JSON.stringify(response.content);
}
