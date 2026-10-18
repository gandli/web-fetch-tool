/**
 * Errors carry an internal detail (logs only) and a short public message
 * (safe to return to any channel). Nothing technical ever reaches a client.
 */
export type ErrorCode =
  | "invalid_url"
  | "blocked_url"
  | "unsupported_content"
  | "too_many_redirects"
  | "fetch_failed"
  | "provider_unavailable"
  | "fetch_timeout"
  | "content_empty"
  | "platform_experimental"
  | "platform_unsupported"
  | "ai_not_configured"
  | "ai_failed"
  | "ai_rate_limited"
  | "archive_not_configured"
  | "archive_failed"
  | "archive_rate_limited"
  | "unauthorized"
  | "forbidden"
  | "rate_limited"
  | "not_found"
  | "invalid_body"
  | "telegram_not_configured"
  | "telegram_not_bound"
  | "telegram_forbidden"
  | "internal";

const PUBLIC_MESSAGES: Record<ErrorCode, string> = {
  invalid_url: "链接格式不正确，请提供以 http/https 开头的网址。",
  blocked_url: "该链接不允许访问。",
  unsupported_content: "暂不支持该类型的内容。",
  too_many_redirects: "链接跳转次数过多，已停止访问。",
  fetch_failed: "页面获取失败，请稍后重试。",
  provider_unavailable: "当前抓取服务暂时不可用，请稍后重试。",
  fetch_timeout: "页面获取超时，请稍后重试。",
  content_empty: "没有从该页面读取到正文内容。",
  platform_experimental: "该平台暂为实验性支持，尚未开放。",
  platform_unsupported: "暂不支持该平台。",
  ai_not_configured: "AI 功能尚未启用。",
  ai_failed: "AI 处理失败，请稍后重试。",
  ai_rate_limited: "AI 处理请求较多，请稍后再试。",
  archive_not_configured: "该存档渠道尚未配置。",
  archive_failed: "存档失败，请稍后重试。",
  archive_rate_limited: "存档请求较多，请稍后再试。",
  unauthorized: "缺少或无效的访问令牌。",
  forbidden: "当前令牌没有该操作的权限。",
  rate_limited: "请求过于频繁，请稍后再试。",
  not_found: "没有找到对应记录。",
  invalid_body: "请求参数不正确。",
  telegram_not_configured: "机器人尚未配置完成。",
  telegram_not_bound: "当前对话尚未绑定，请先完成绑定。",
  telegram_forbidden: "当前对话无权使用该功能。",
  internal: "服务暂时不可用，请稍后重试。",
};

const STATUS: Partial<Record<ErrorCode, number>> = {
  invalid_url: 400,
  blocked_url: 400,
  unsupported_content: 415,
  invalid_body: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  rate_limited: 429,
  ai_rate_limited: 429,
  archive_rate_limited: 429,
  fetch_timeout: 504,
  platform_experimental: 422,
  platform_unsupported: 422,
  ai_not_configured: 503,
  archive_not_configured: 503,
  telegram_not_configured: 503,
  content_empty: 422,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly publicMessage: string;
  readonly detail: string | undefined;

  constructor(code: ErrorCode, detail?: string, publicMessage?: string) {
    super(detail ?? code);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS[code] ?? 502;
    this.publicMessage = publicMessage ?? PUBLIC_MESSAGES[code];
    this.detail = detail;
  }
}

export function publicMessage(code: ErrorCode): string {
  return PUBLIC_MESSAGES[code] ?? PUBLIC_MESSAGES.internal;
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

export function toAppError(value: unknown): AppError {
  if (isAppError(value)) return value;
  const detail = value instanceof Error ? value.message : String(value);
  return new AppError("internal", detail);
}
