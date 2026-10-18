import { AppError } from "../contracts/errors.ts";
import { httpRequest } from "../core/fetch/http.ts";

export interface InlineKeyboardButton {
  text: string;
  url?: string;
  callback_data?: string;
}

export interface SendOptions {
  parseMode?: "HTML" | "MarkdownV2";
  replyMarkup?: { inline_keyboard: InlineKeyboardButton[][] };
  disablePreview?: boolean;
}

interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

export class BotApi {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch | undefined;

  constructor(token: string | undefined, baseUrl: string, fetchImpl?: typeof fetch) {
    this.token = token ?? "";
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.fetchImpl = fetchImpl;
  }

  get configured(): boolean {
    return this.token.length > 0;
  }

  private async call<T>(method: string, payload: Record<string, unknown>): Promise<T> {
    if (!this.configured) throw new AppError("telegram_not_configured", "TELEGRAM_BOT_TOKEN is empty");
    const response = await httpRequest(`${this.baseUrl}/bot${this.token}/${method}`, {
      method: "POST",
      fetchImpl: this.fetchImpl,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      timeoutMs: 15000,
      maxBytes: 1024 * 1024,
      followRedirects: true,
    });

    let parsed: TelegramResponse<T>;
    try {
      parsed = JSON.parse(response.text) as TelegramResponse<T>;
    } catch {
      throw new AppError("internal", `telegram ${method} invalid json`);
    }
    if (!parsed.ok) {
      throw new AppError("internal", `telegram ${method} failed: ${parsed.description ?? response.status}`);
    }
    return parsed.result as T;
  }

  async sendMessage(chatId: string | number, text: string, options: SendOptions = {}): Promise<void> {
    await this.call("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: options.parseMode ?? "HTML",
      link_preview_options: { is_disabled: options.disablePreview ?? true },
      ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
    });
  }

  async sendPhoto(
    chatId: string | number,
    photo: string,
    caption: string,
    options: SendOptions = {},
  ): Promise<void> {
    await this.call("sendPhoto", {
      chat_id: chatId,
      photo,
      caption,
      parse_mode: options.parseMode ?? "HTML",
      ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
    });
  }

  async sendChatAction(chatId: string | number, action = "typing"): Promise<void> {
    await this.call("sendChatAction", { chat_id: chatId, action });
  }

  async setWebhook(url: string, secretToken?: string): Promise<void> {
    await this.call("setWebhook", {
      url,
      secret_token: secretToken,
      allowed_updates: ["message"],
      drop_pending_updates: true,
    });
  }

  async getMe(): Promise<{ id: number; username?: string }> {
    return this.call("getMe", {});
  }
}
