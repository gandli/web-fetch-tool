const CJK = /[\u3400-\u4dbf\u4e00-\u9fff]/g;
const KANA = /[\u3040-\u30ff]/g;
const HANGUL = /[\uac00-\ud7af]/g;
const CYRILLIC = /[\u0400-\u04ff]/g;
const ARABIC = /[\u0600-\u06ff]/g;
const LATIN = /[A-Za-z]/g;

function count(text: string, pattern: RegExp): number {
  return (text.match(pattern) ?? []).length;
}

/**
 * Dependency-free language heuristic. Good enough to tag records and to pick a
 * default translation target; it is not a linguistically precise classifier.
 */
export function detectLanguage(text: string, hint?: string | null): string | null {
  const normalized = (hint ?? "").trim().toLowerCase();
  if (normalized && /^[a-z]{2}(-[a-z]{2})?$/.test(normalized)) return normalized.slice(0, 2);

  const sample = text.slice(0, 8000);
  if (!sample.trim()) return null;

  const kana = count(sample, KANA);
  const han = count(sample, CJK);
  const hangul = count(sample, HANGUL);
  if (kana > Math.max(han * 0.2, 8)) return "ja";
  if (hangul > Math.max(han * 0.2, 8)) return "ko";
  if (han > 8) return "zh";
  if (count(sample, CYRILLIC) > 20) return "ru";
  if (count(sample, ARABIC) > 20) return "ar";
  if (count(sample, LATIN) > 20) return "en";
  return null;
}
