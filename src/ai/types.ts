export type AiTask = "translate" | "summarize" | "titles" | "tags" | "analyze";
export type SummaryLength = "short" | "medium" | "long";

export interface AiRequest {
  task: AiTask;
  text: string;
  title?: string | null;
  language?: string;
  summaryLength?: SummaryLength;
  quality?: boolean;
}

export interface AiResponse {
  kind: AiTask;
  model: string;
  content: string | string[] | Record<string, unknown>;
  costUsd: number;
}

export interface AiProvider {
  readonly available: boolean;
  readonly defaultModel: string;
  run(request: AiRequest): Promise<AiResponse>;
}

export const LANGUAGE_NAMES: Record<string, string> = {
  zh: "简体中文",
  "zh-tw": "繁体中文",
  en: "English",
  ja: "日本語",
  ko: "한국어",
  ru: "Русский",
  ar: "العربية",
  fr: "Français",
  de: "Deutsch",
  es: "Español",
  pt: "Português",
  it: "Italiano",
};

export function languageName(code: string | undefined): string {
  if (!code) return "简体中文";
  return LANGUAGE_NAMES[code.toLowerCase()] ?? code;
}
