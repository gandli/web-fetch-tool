import { createApp } from "../src/app.ts";
import { migrate } from "../src/db/migrate.ts";
import { PgliteDb } from "../src/db/pglite.ts";
import { loadConfig, type AppConfig } from "../src/config.ts";
import { createAiProvider } from "../src/ai/openrouter.ts";

/**
 * End-to-end Telegram verification without a real bot token:
 * a local fake Bot API captures every outgoing call, and the real webhook route,
 * binding flow, pipeline, AI degradation and card rendering all run.
 */
const args = process.argv.slice(2);
const url = args.find((arg) => arg.startsWith("http")) ?? "https://example.com";
const withArchive = args.includes("--archive");
const withAi = args.includes("--ai");

const calls: Array<{ method: string; payload: Record<string, unknown> }> = [];
const fakeBot = Bun.serve({
  port: 8799,
  hostname: "127.0.0.1",
  async fetch(request) {
    const path = new URL(request.url).pathname;
    const method = path.split("/").pop() ?? "unknown";
    const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (method !== "sendChatAction") calls.push({ method, payload });
    return Response.json({ ok: true, result: { message_id: calls.length } });
  },
});

const base = loadConfig();
const config: AppConfig = {
  ...base,
  telegramBotToken: "123456:SIMULATION",
  telegramApiBase: "http://127.0.0.1:8799",
  telegramWebhookSecret: "sim-webhook-secret",
  telegramBindCode: "sim-bind-code",
  telegramAllowedChatIds: [],
  telegraphEnabled: withArchive,
  archiveDefaultChannels: withArchive ? ["telegraph"] : [],
  openrouterApiKey: withAi ? base.openrouterApiKey : undefined,
  dbDriver: "pglite",
};

const db = new PgliteDb();
await migrate(db, `${import.meta.dir}/../migrations`);

const app = createApp({
  config,
  db,
  aiProvider: createAiProvider(config),
});

async function send(update: Record<string, unknown>): Promise<void> {
  const response = await app.handle(
    new Request("http://127.0.0.1/telegram/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": "sim-webhook-secret",
      },
      body: JSON.stringify(update),
    }),
  );
  if (response.status !== 200) console.log("webhook status", response.status, await response.text());
  await app.drainBackground();
}

let updateId = 1000;
const chat = { id: 424242, title: "sim chat", type: "private" };
function update(text: string) {
  updateId += 1;
  return { update_id: updateId, message: { message_id: updateId, chat, from: { is_bot: false }, text } };
}

console.log("1) /start before binding");
await send(update("/start"));
console.log("2) message before binding");
await send(update(url));
console.log("3) /bind with wrong code");
await send(update("/bind nope"));
console.log("4) /bind with correct code");
await send(update("/bind sim-bind-code"));
console.log("5) /settings");
await send(update("/settings"));
console.log("6) fetch a URL");
const duplicated = update(url);
await send(duplicated);
console.log("7) duplicate update_id (must be ignored)");
await send(duplicated);
console.log("8) /summary long + /translate on");
await send(update("/summary long"));
await send(update("/translate on"));

console.log("\n== captured bot calls");
for (const call of calls) {
  const text = (call.payload.text ?? call.payload.caption ?? "") as string;
  console.log(`\n[${call.method}]`);
  console.log(text.slice(0, 700));
  if (call.payload.reply_markup) console.log("keyboard:", JSON.stringify(call.payload.reply_markup));
}

await db.close();
fakeBot.stop();
process.exit(0);
