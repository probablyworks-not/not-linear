// After a reply is rendered, give each link we named ourselves the page's own
// title — "The internet is having a very bad cybersecurity day" rather than
// "techcrunch.com". Runs on settled markup only (like mermaid and highlight.js),
// one request at a time, and leaves the link as it is when there is no title.

import { fetchLinkTitle } from './link-title';

export async function nameLinksIn(el: Element): Promise<void> {
  const links = Array.from(el.querySelectorAll<HTMLAnchorElement>('a[data-site]:not([data-named])'));
  for (const a of links) {
    a.setAttribute('data-named', '1');
    const url = a.getAttribute('href');
    if (!url) continue;
    const title = await fetchLinkTitle(url);
    if (title && a.isConnected) a.textContent = title;
  }
}
