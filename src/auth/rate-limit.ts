import { AppError } from "../contracts/errors.ts";
import type { Db } from "../db/db.ts";
import { rateLimitRepo, type RateLimitOutcome } from "../db/repositories.ts";

export interface LimitRule {
  limit: number;
  windowSeconds: number;
  keySuffix: string;
}

/**
 * Applies one or more DB-backed windows. The first exhausted window decides the
 * error, so a caller never gets more than its tightest budget.
 */
export async function enforceLimits(
  db: Db,
  baseKey: string,
  rules: LimitRule[],
  errorCode: "rate_limited" | "ai_rate_limited" | "archive_rate_limited" = "rate_limited",
): Promise<RateLimitOutcome[]> {
  const outcomes: RateLimitOutcome[] = [];
  for (const rule of rules) {
    const outcome = await rateLimitRepo.bump(db, `${baseKey}:${rule.keySuffix}`, rule.limit, rule.windowSeconds);
    outcomes.push(outcome);
    if (!outcome.allowed) {
      throw new AppError(errorCode, `rate limit ${rule.keySuffix} exceeded (${outcome.count}/${outcome.limit})`);
    }
  }
  return outcomes;
}

/** Non-throwing variant for the bot, which replies with a friendly message. */
export async function checkLimits(
  db: Db,
  baseKey: string,
  rules: LimitRule[],
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  for (const rule of rules) {
    const outcome = await rateLimitRepo.bump(db, `${baseKey}:${rule.keySuffix}`, rule.limit, rule.windowSeconds);
    if (!outcome.allowed) {
      const retryAt = new Date(outcome.resetAt).getTime();
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((retryAt - Date.now()) / 1000)) };
    }
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

export function apiRules(perMinute: number, perHour: number): LimitRule[] {
  return [
    { limit: perMinute, windowSeconds: 60, keySuffix: "m" },
    { limit: perHour, windowSeconds: 3600, keySuffix: "h" },
  ];
}
