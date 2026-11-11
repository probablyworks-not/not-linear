// The page's own name for a link, fetched through the local server — the
// browser cannot CORS-fetch an arbitrary site, but `/__notlinear_link_preview`
// already does exactly this for bookmark blocks, so link labelling reuses it.

import { postJson } from './api';
import { linkLabel } from './link-text';

const MAX_TITLE = 90;

/** Drop the site's own name off the end of a title ("… | TechCrunch") and cap the length. */
function tidyTitle(title: string, url: string): string {
  const host = linkLabel(url).toLowerCase().replace(/[^a-z0-9]/g, '');
  const parts = title.replace(/\s+/g, ' ').trim().split(/\s+[|–—]\s+|\s+-\s+/);
  while (parts.length > 1) {
    const tail = parts[parts.length - 1]!.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (tail.length > 0 && tail.length <= 24 && host.includes(tail)) parts.pop();
    else break;
  }
  const out = parts.join(' | ').trim();
  return out.length > MAX_TITLE ? `${out.slice(0, MAX_TITLE - 1).trimEnd()}…` : out;
}

const pending = new Map<string, Promise<string | null>>();

/**
 * The article's name, or null when the page has none, the fetch fails, or the
 * title says no more than the site name already does. Cached per URL for the
 * session, so pasting the same link twice costs one request.
 */
export function fetchLinkTitle(url: string): Promise<string | null> {
  const hit = pending.get(url);
  if (hit) return hit;
  const p = postJson<{ ok?: boolean; title?: string }>('/__notlinear_link_preview', { url }, AbortSignal.timeout(8000))
    .then(r => {
      const raw = r.ok === true && typeof r.title === 'string' ? r.title.trim() : '';
      if (!raw) return null;
      const title = tidyTitle(raw, url);
      return title && title.toLowerCase() !== linkLabel(url).toLowerCase() ? title : null;
    })
    .catch(() => null);
  pending.set(url, p);
  return p;
}
