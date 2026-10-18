import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { AppError } from "../contracts/errors.ts";
import type { Db } from "../db/db.ts";
import { tokenRepo, type TokenRow } from "../db/repositories.ts";

export const TOKEN_PREFIX_LENGTH = 12;

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function tokenPrefix(token: string): string {
  return token.slice(0, TOKEN_PREFIX_LENGTH);
}

export function issueToken(): { token: string; prefix: string; hash: string } {
  const token = `wft_${randomBytes(24).toString("base64url")}`;
  return { token, prefix: tokenPrefix(token), hash: hashToken(token) };
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function extractToken(headers: Headers): string | null {
  const authorization = headers.get("authorization");
  if (authorization) {
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (match?.[1]) return match[1].trim();
  }
  const apiKey = headers.get("x-api-key");
  return apiKey?.trim() || null;
}

export interface AuthContext {
  token: TokenRow;
  scopes: string[];
}

/** Validates a bearer token and enforces the required scope. */
export async function authenticate(
  db: Db,
  headers: Headers,
  requiredScope: "fetch" | "ai" | "read",
  options: { required: boolean },
): Promise<AuthContext | null> {
  const raw = extractToken(headers);
  if (!raw) {
    if (!options.required) return null;
    throw new AppError("unauthorized", "missing token");
  }
  if (raw.length < 16) throw new AppError("unauthorized", "token too short");

  const candidates = await tokenRepo.findByPrefix(db, tokenPrefix(raw));
  const hash = hashToken(raw);
  const token = candidates.find((candidate) => safeEqual(candidate.token_hash, hash));
  if (!token) throw new AppError("unauthorized", "token not found");

  const scopes = token.scopes ?? [];
  if (!scopes.includes(requiredScope) && !scopes.includes("*")) {
    throw new AppError("forbidden", `token missing scope ${requiredScope}, has ${scopes.join(",")}`);
  }

  await tokenRepo.touch(db, token.id).catch(() => {});
  return { token, scopes };
}
