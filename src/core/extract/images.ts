const SKIP = /(sprite|icon|logo|avatar|emoji|badge|pixel|tracker|beacon|blank|transparent|1x1)/i;

function toAbsolute(raw: string | null, baseUrl: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith("data:") || trimmed.startsWith("blob:")) return null;
  try {
    const url = new URL(trimmed, baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Extract usable image URLs from a container element, deduplicated and bounded. */
export function extractImages(container: Element | Document | null, baseUrl: string, limit = 20): string[] {
  if (!container) return [];
  const images: string[] = [];
  const seen = new Set<string>();
  for (const image of Array.from(container.querySelectorAll("img"))) {
    const raw =
      image.getAttribute("src") ??
      image.getAttribute("data-src") ??
      image.getAttribute("data-original") ??
      image.getAttribute("data-actualsrc");
    const url = toAbsolute(raw, baseUrl);
    if (!url || seen.has(url) || SKIP.test(url)) continue;
    if (/\.svg(\?|$)/i.test(url)) continue;
    const width = Number.parseInt(image.getAttribute("width")?.replace(/\D/g, "") ?? "", 10);
    if (Number.isFinite(width) && width > 0 && width < 120) continue;
    seen.add(url);
    images.push(url);
    if (images.length >= limit) break;
  }
  return images;
}
