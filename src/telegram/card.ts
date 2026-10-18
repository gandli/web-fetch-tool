import type { InlineKeyboardButton } from "./bot-api.ts";

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface CardInput {
  title: string;
  url: string;
  summary: string | null;
  tags: string[] | null;
  archiveUrl: string | null;
  image: string | null;
  siteName: string | null;
  platform: string;
}

export interface CardOutput {
  text: string;
  caption: string;
  keyboard: { inline_keyboard: InlineKeyboardButton[][] };
  usePhoto: boolean;
}

const CAPTION_LIMIT = 1024;
const TEXT_LIMIT = 4000;

function truncateAtSentence(text: string, max: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const cut = Math.max(slice.lastIndexOf("。"), slice.lastIndexOf(". "), slice.lastIndexOf("\n"), slice.lastIndexOf("；"));
  return cut > max * 0.6 ? slice.slice(0, cut + 1).trim() : `${slice.trim()}…`;
}

/** Builds the Telegram card: title, summary, tags, source and archive buttons. */
export function buildCard(input: CardInput): CardOutput {
  const title = escapeHtml(input.title.trim() || input.url);
  const summary = input.summary ? truncateAtSentence(escapeHtml(input.summary.trim()), 700) : null;
  const tagLine =
    input.tags && input.tags.length
      ? input.tags
          .slice(0, 8)
          .map((tag) => `#${escapeHtml(tag.replace(/\s+/g, "_"))}`)
          .join(" ")
      : null;
  const source = input.siteName ? `<i>${escapeHtml(input.siteName)}</i>` : `<i>${escapeHtml(input.platform)}</i>`;

  const parts = [`<b>${title}</b>`];
  if (summary) parts.push(summary);
  if (tagLine) parts.push(tagLine);
  parts.push(source);
  const text = truncateAtSentence(parts.join("\n\n"), TEXT_LIMIT);
  const caption = truncateAtSentence(text, CAPTION_LIMIT - 10);

  const buttons: InlineKeyboardButton[] = [{ text: "打开原文", url: input.url }];
  if (input.archiveUrl) buttons.push({ text: "存档快照", url: input.archiveUrl });

  return {
    text,
    caption,
    keyboard: { inline_keyboard: [buttons] },
    usePhoto: Boolean(input.image),
  };
}
