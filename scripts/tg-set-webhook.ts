import { loadConfig } from "../src/config.ts";
import { BotApi } from "../src/telegram/bot-api.ts";

function arg(name: string, fallback = ""): string {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 && process.argv[index + 1] ? process.argv[index + 1]! : fallback;
}

const config = loadConfig();
if (!config.telegramBotToken) {
  console.error("TELEGRAM_BOT_TOKEN is required");
  process.exit(1);
}
if (!config.telegramWebhookSecret) {
  console.error("TELEGRAM_WEBHOOK_SECRET is required");
  process.exit(1);
}

const webhookUrl = arg("url", `${config.publicBaseUrl}/telegram/webhook`);
const bot = new BotApi(config.telegramBotToken, config.telegramApiBase);

const me = await bot.getMe();
console.log(`bot: @${me.username ?? me.id}`);
await bot.setWebhook(webhookUrl, config.telegramWebhookSecret);
console.log(`webhook registered: ${webhookUrl}`);
console.log("send a URL to the bot to verify the full chain.");
