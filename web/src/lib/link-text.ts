// How a URL is shown to a reader anywhere in the app: the site it points at,
// not the whole address. A research answer that cites six sources should read
// as six site names, not six lines of query strings — the full URL stays in
// the href (and in the title attribute, so hovering still shows it).

/**
 * The display label for a link: the hostname with a leading `www.` removed,
 * e.g. `https://techcrunch.com/2026/10/21/some-very-long-slug/` → `techcrunch.com`.
 * Anything that doesn't parse as a URL is returned unchanged, so a malformed
 * link still shows its text rather than disappearing.
 */
export function linkLabel(url: string): string {
  const raw = String(url ?? '').trim();
  try {
    const host = new URL(raw).hostname.replace(/^www\./i, '');
    return host || raw;
  } catch {
    return raw;
  }
}

const MAX_NAME = 90;
const IDISH = /^[0-9a-f-]{8,}$|^\d+$/i;

/**
 * The article's name read straight off the URL's slug — no network, so a link
 * is readable the instant it is pasted: `…/the-internet-is-having-a-very-bad-
 * cybersecurity-day/` → `The internet is having a very bad cybersecurity day`.
 * Null unless the slug is at least three words, since a one-word path
 * (`/pricing`) says less than the site name does.
 */
export function articleName(url: string): string | null {
  let path: string;
  try { path = new URL(String(url ?? '').trim()).pathname; } catch { return null; }
  const segments = path.split('/').filter(Boolean).map(seg => {
    try { return decodeURIComponent(seg); } catch { return seg; }
  });
  for (const seg of segments.reverse()) {
    const slug = seg.replace(/\.(html?|php|aspx?|jsp)$/i, '');
    if (IDISH.test(slug)) continue;
    const words = slug.split(/[-_]+/).filter(Boolean);
    if (words.length < 3) continue;
    const name = words.join(' ').replace(/\s+/g, ' ').trim();
    const sentence = name.charAt(0).toUpperCase() + name.slice(1);
    return sentence.length > MAX_NAME ? `${sentence.slice(0, MAX_NAME - 1).trimEnd()}…` : sentence;
  }
  return null;
}

/** What a link shows when nobody has named it: the article if the URL says it, else the site. */
export function linkDisplayText(url: string): string {
  return articleName(url) ?? linkLabel(url);
}

/** True when `label` adds nothing over the URL itself, so it should be shortened too. */
export function labelIsUrl(label: string, url: string): boolean {
  const l = label.trim();
  return l === '' || l === url.trim() || l === url.trim().replace(/\/+$/, '');
}
