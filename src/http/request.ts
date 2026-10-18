import { AppError } from "../contracts/errors.ts";

/** Reads a JSON body with a hard byte budget (never trusts Content-Length alone). */
export async function readJson(request: Request, maxBytes: number): Promise<unknown> {
  const declared = Number.parseInt(request.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new AppError("invalid_body", `content-length ${declared} exceeds ${maxBytes}`);
  }
  const text = await request.text();
  if (text.length > maxBytes) throw new AppError("invalid_body", `body length ${text.length} exceeds ${maxBytes}`);
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("invalid_body", "body is not valid json");
  }
}

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") ?? "local";
}

export function bearerHint(headers: Headers): boolean {
  return Boolean(headers.get("authorization") || headers.get("x-api-key"));
}
