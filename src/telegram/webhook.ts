import { randomUUID } from "node:crypto";
import { AppError, isAppError, toAppError } from "../contracts/errors.ts";
import type { AiProvider } from "../ai/types.ts";
import { runAiTask } from "../ai/tasks.ts";
import type { AppConfig } from "../config.ts";
import type { Db } from "../db/db.ts";
import { aiRepo, telegramRepo } from "../db/repositories.ts";
import { executeFetch } from "../services/fetch-service.ts";
import { runArchive } from "../archive/index.ts";
import { BotApi } from "./bot-api.ts";
import { buildCard } from "./card.ts";
import { enforceChatRateLimit, handleCommand } from "./commands.ts";
import type { ResolveHost } from "../core/url-guard.ts";
import type { ResultCache } from "../core/dedupe.ts";

export interface TelegramChat {
  id: number | string;
  title?: string;
  type?: string;
}

export interface TelegramMessage {
  message_id: number;
  chat: TelegramChat;
  from?: { is_bot?: boolean; first_name?: string; username?: string };
  text?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
}

export interface TelegramDeps {
  config: AppConfig;
  db: Db;
  aiProvider: AiProvider;
  fetchImpl?: typeof fetch;
  resolveHost?: ResolveHost;
  cache?: ResultCache<unknown>;
  botFactory?: (config: AppConfig, fetchImpl?: typeof fetch) => BotApi;
}

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/i;

export function extractFirstUrl(text: string): string | null {
  const match = URL_PATTERN.exec(text);
  if (!match) return null;
  return match[0].replace(/[)\].,，。；;!?！？、》」』]+$/g, "");
}

function parseCommand(text: string): { name: string; args: string[] } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;
  const [head, ...rest] = trimmed.split(/\s+/);
  const name = head!.slice(1).split("@")[0]!.toLowerCase();
  if (!name) return null;
  return { name, args: rest };
}

function botFor(deps: TelegramDeps): BotApi {
  if (deps.botFactory) return deps.botFactory(deps.config, deps.fetchImpl);
  return new BotApi(deps.config.telegramBotToken, deps.config.telegramApiBase, deps.fetchImpl);
}

function fallbackSummary(markdown: string): string | null {
  const clean = markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/[#>*_`~\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return null;
  return clean.length > 180 ? `${clean.slice(0, 180)}…` : clean;
}

async function sendCard(
  bot: BotApi,
  chatId: string,
  card: ReturnType<typeof buildCard>,
  image: string | null,
): Promise<void> {
  const usableImage = image && /^https?:\/\//i.test(image) && !/\.svg(\?|$)/i.test(image) ? image : null;
  if (card.usePhoto && usableImage) {
    try {
      await bot.sendPhoto(chatId, usableImage, card.caption, {
        parseMode: "HTML",
        replyMarkup: card.keyboard,
      });
      return;
    } catch {
      // Fall through: an unreachable preview image must not lose the message.
    }
  }
  await bot.sendMessage(chatId, card.text, { parseMode: "HTML", replyMarkup: card.keyboard });
}

/**
 * Handles one Telegram update: idempotency, binding gate, commands, the shared
 * fetch pipeline, optional AI, optional archive, then one card reply.
 */
export async function processTelegramUpdate(update: TelegramUpdate, deps: TelegramDeps): Promise<void> {
  const message = update.message ?? update.edited_message;
  if (!message?.text) return;
  if (message.from?.is_bot) return;

  const chatId = String(message.chat.id);
  const text = message.text;
  const url = extractFirstUrl(text);

  const accepted = await telegramRepo.startLog(deps.db, {
    id: randomUUID(),
    chatId,
    updateId: update.update_id,
    url,
  });
  if (!accepted) return; // duplicate delivery

  const bot = botFor(deps);
  const binding = await telegramRepo.getBinding(deps.db, chatId).catch(() => null);

  try {
    const command = parseCommand(text);
    if (command) {
      await handleCommand(command.name, {
        db: deps.db,
        config: deps.config,
        chatId,
        binding,
        bot,
        args: command.args,
        chatTitle: message.chat.title ?? null,
      });
      await telegramRepo.finishLog(deps.db, update.update_id, { status: "ok" });
      return;
    }

    if (!binding) {
      await bot.sendMessage(chatId, "当前对话尚未绑定。请先发送 <code>/bind 绑定码</code> 完成绑定。");
      await telegramRepo.finishLog(deps.db, update.update_id, { status: "rejected", errorCode: "telegram_not_bound" });
      return;
    }

    if (!url) {
      await bot.sendMessage(chatId, "请直接发送一个以 http/https 开头的网址。");
      await telegramRepo.finishLog(deps.db, update.update_id, { status: "ok" });
      return;
    }

    await enforceChatRateLimit(deps.db, deps.config, chatId);

    await bot.sendChatAction(chatId, "typing").catch(() => {});

    const { row, unified } = await executeFetch({
      url,
      engine: "auto",
      config: deps.config,
      db: deps.db,
      fetchImpl: deps.fetchImpl,
      resolveHost: deps.resolveHost,
      cache: deps.cache as ResultCache<unknown> | undefined,
    });

    const language = binding.settings.translate
      ? binding.settings.lang
      : unified.metadata.language ?? binding.settings.lang;

    let summary: string | null = null;
    let tags: string[] | null = null;

    if (deps.aiProvider.available) {
      const [summaryResult, tagsResult] = await Promise.allSettled([
        runAiTask(deps.aiProvider, {
          task: "summarize",
          text: unified.content.text,
          title: unified.title,
          language,
          summaryLength: binding.settings.summary_length,
        }),
        runAiTask(deps.aiProvider, {
          task: "tags",
          text: unified.content.text,
          title: unified.title,
          language,
        }),
      ]);

      if (summaryResult.status === "fulfilled" && typeof summaryResult.value.content === "string") {
        summary = summaryResult.value.content;
        await aiRepo
          .insert(deps.db, {
            id: randomUUID(),
            fetchId: row.id,
            kind: "summarize",
            targetLanguage: language,
            model: summaryResult.value.model,
            content: summaryResult.value.content,
            costUsd: summaryResult.value.costUsd,
          })
          .catch(() => {});
      }
      if (tagsResult.status === "fulfilled" && Array.isArray(tagsResult.value.content)) {
        tags = tagsResult.value.content as string[];
        await aiRepo
          .insert(deps.db, {
            id: randomUUID(),
            fetchId: row.id,
            kind: "tags",
            targetLanguage: language,
            model: tagsResult.value.model,
            content: tags,
            costUsd: tagsResult.value.costUsd,
          })
          .catch(() => {});
      }
    }

    if (!summary) summary = fallbackSummary(unified.content.text);

    let archiveUrl: string | null = null;
    if (binding.settings.archive) {
      const results = await runArchive(
        deps.config.archiveDefaultChannels,
        { url: unified.url, title: unified.title, markdown: unified.content.text, platform: unified.platform },
        { config: deps.config, db: deps.db, fetchImpl: deps.fetchImpl ?? fetch },
        row.id,
      );
      archiveUrl = results.find((result) => result.status === "ok" && result.url)?.url ?? null;
    }

    const card = buildCard({
      title: unified.title,
      url: unified.url,
      summary,
      tags,
      archiveUrl,
      image: unified.og.image,
      siteName: unified.og.site_name,
      platform: unified.platform,
    });

    await sendCard(bot, chatId, card, unified.og.image);
    await telegramRepo.finishLog(deps.db, update.update_id, { status: "ok", fetchId: row.id });
  } catch (error) {
    const appError = toAppError(error);
    const messageText = appError.publicMessage;
    await bot.sendMessage(chatId, messageText).catch(() => {});
    await telegramRepo
      .finishLog(deps.db, update.update_id, { status: "failed", errorCode: appError.code })
      .catch(() => {});
    if (!isAppError(error)) console.error("[telegram] unexpected error", error);
  }
}

/** Used by scripts to verify a real bot token without receiving updates. */
export async function verifyBot(config: AppConfig, fetchImpl?: typeof fetch): Promise<{ id: number; username?: string }> {
  if (!config.telegramBotToken) throw new AppError("telegram_not_configured", "TELEGRAM_BOT_TOKEN is empty");
  const bot = new BotApi(config.telegramBotToken, config.telegramApiBase, fetchImpl);
  return bot.getMe();
}
