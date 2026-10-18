import { AppError } from "../contracts/errors.ts";
import type { AppConfig } from "../config.ts";
import type { Db } from "../db/db.ts";
import { telegramRepo, type TelegramBindingRow, type TelegramSettings } from "../db/repositories.ts";
import { enforceLimits, checkLimits } from "../auth/rate-limit.ts";
import { safeEqual } from "../auth/tokens.ts";
import type { BotApi } from "./bot-api.ts";
import { escapeHtml } from "./card.ts";

export interface CommandContext {
  db: Db;
  config: AppConfig;
  chatId: string;
  binding: TelegramBindingRow | null;
  bot: BotApi;
  args: string[];
  chatTitle: string | null;
}

const HELP = [
  "<b>可用指令</b>",
  "/start 查看状态",
  "/lang &lt;代码&gt; 设置语言，例如 /lang zh、/lang en",
  "/translate on|off 开关翻译",
  "/archive on|off 开关存档",
  "/summary short|medium|long 设置摘要长度",
  "/settings 查看当前设置",
  "/bind &lt;绑定码&gt; 绑定当前对话",
  "/unbind 解除绑定",
].join("\n");

function settingsText(settings: TelegramSettings): string {
  return [
    `<b>当前设置</b>`,
    `语言：${escapeHtml(settings.lang)}`,
    `翻译：${settings.translate ? "开" : "关"}`,
    `存档：${settings.archive ? "开" : "关"}`,
    `摘要长度：${settings.summary_length}`,
  ].join("\n");
}

function requireBinding(ctx: CommandContext): TelegramBindingRow {
  if (!ctx.binding) throw new AppError("telegram_not_bound", `chat ${ctx.chatId} is not bound`);
  return ctx.binding;
}

async function saveSettings(ctx: CommandContext, settings: TelegramSettings): Promise<void> {
  await telegramRepo.updateSettings(ctx.db, ctx.chatId, settings);
}

export async function handleCommand(name: string, ctx: CommandContext): Promise<void> {
  switch (name) {
    case "start": {
      if (ctx.binding) {
        await ctx.bot.sendMessage(ctx.chatId, `欢迎回来。\n\n${settingsText(ctx.binding.settings)}`);
        return;
      }
      const open = Boolean(ctx.config.telegramBindCode) || ctx.config.telegramAllowedChatIds.length > 0;
      if (!open) {
        await ctx.bot.sendMessage(ctx.chatId, "机器人尚未完成配置，暂时无法绑定。请稍后再试。");
        return;
      }
      await ctx.bot.sendMessage(
        ctx.chatId,
        "发送一个网址，我会抓取正文、生成摘要并归档。\n\n使用前请先绑定当前对话：<code>/bind 绑定码</code>",
      );
      return;
    }

    case "help":
      await ctx.bot.sendMessage(ctx.chatId, HELP);
      return;

    case "bind": {
      const code = ctx.config.telegramBindCode;
      if (!code && ctx.config.telegramAllowedChatIds.length === 0) {
        await ctx.bot.sendMessage(ctx.chatId, "绑定功能暂未开放。");
        return;
      }
      const attempt = await checkLimits(ctx.db, `tg:bind:${ctx.chatId}`, [
        { limit: 5, windowSeconds: 600, keySuffix: "attempts" },
      ]);
      if (!attempt.allowed) {
        await ctx.bot.sendMessage(ctx.chatId, "尝试次数过多，请十分钟后再试。");
        return;
      }
      const provided = (ctx.args[0] ?? "").trim();
      const allowlisted = ctx.config.telegramAllowedChatIds.includes(ctx.chatId);
      if (!allowlisted && (!code || !provided || !safeEqual(provided, code))) {
        await ctx.bot.sendMessage(ctx.chatId, "绑定码不正确。");
        return;
      }
      await telegramRepo.upsertBinding(ctx.db, {
        id: crypto.randomUUID(),
        chatId: ctx.chatId,
        title: ctx.chatTitle,
      });
      await ctx.bot.sendMessage(ctx.chatId, "绑定成功。现在可以直接发送网址了。");
      return;
    }

    case "unbind": {
      await telegramRepo.deactivate(ctx.db, ctx.chatId);
      await ctx.bot.sendMessage(ctx.chatId, "已解除绑定。");
      return;
    }

    case "lang": {
      const binding = requireBinding(ctx);
      const value = (ctx.args[0] ?? "").toLowerCase();
      if (!/^[a-z]{2}(-[a-z]{2})?$/.test(value)) {
        await ctx.bot.sendMessage(ctx.chatId, "用法：<code>/lang zh</code>，支持两位语言代码。");
        return;
      }
      await saveSettings(ctx, { ...binding.settings, lang: value });
      await ctx.bot.sendMessage(ctx.chatId, `语言已设置为 ${escapeHtml(value)}。`);
      return;
    }

    case "translate":
    case "archive": {
      const binding = requireBinding(ctx);
      const value = (ctx.args[0] ?? "").toLowerCase();
      if (value !== "on" && value !== "off") {
        await ctx.bot.sendMessage(ctx.chatId, `用法：<code>/${name} on</code> 或 <code>/${name} off</code>`);
        return;
      }
      const enabled = value === "on";
      await saveSettings(ctx, {
        ...binding.settings,
        ...(name === "translate" ? { translate: enabled } : { archive: enabled }),
      });
      await ctx.bot.sendMessage(ctx.chatId, `${name === "translate" ? "翻译" : "存档"}已${enabled ? "开启" : "关闭"}。`);
      return;
    }

    case "summary": {
      const binding = requireBinding(ctx);
      const value = (ctx.args[0] ?? "").toLowerCase();
      if (!["short", "medium", "long"].includes(value)) {
        await ctx.bot.sendMessage(ctx.chatId, "用法：<code>/summary short|medium|long</code>");
        return;
      }
      await saveSettings(ctx, { ...binding.settings, summary_length: value as TelegramSettings["summary_length"] });
      await ctx.bot.sendMessage(ctx.chatId, `摘要长度已设置为 ${value}。`);
      return;
    }

    case "settings": {
      const binding = requireBinding(ctx);
      await ctx.bot.sendMessage(ctx.chatId, settingsText(binding.settings));
      return;
    }

    default:
      await ctx.bot.sendMessage(ctx.chatId, "未识别的指令。发送 /help 查看可用指令。");
  }
}

export async function enforceChatRateLimit(db: Db, config: AppConfig, chatId: string): Promise<void> {
  await enforceLimits(db, `tg:chat:${chatId}`, [
    { limit: config.telegramRateLimit.perMinute, windowSeconds: 60, keySuffix: "m" },
    { limit: config.telegramRateLimit.perHour, windowSeconds: 3600, keySuffix: "h" },
  ]);
}
