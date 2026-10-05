// URL handling for media, bookmark and embed blocks, ported from notes.js (classifyMediaUrl,
// humanFileSize, EMBED_ALLOWLIST). One addition: an iframe only ever loads from a fixed list of
// hosts, even when a note already stores some other `embedSrc` (a hand-edited or imported note).

export interface MediaInfo { kind: 'youtube' | 'vimeo' | 'video' | 'audio' | 'unrecognized'; embedSrc?: string }

export function classifyMediaUrl(url: string): MediaInfo {
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/);
  if (yt) return { kind: 'youtube', embedSrc: `https://www.youtube.com/embed/${yt[1]}` };
  const vm = url.match(/vimeo\.com\/(\d+)/);
  if (vm) return { kind: 'vimeo', embedSrc: `https://player.vimeo.com/video/${vm[1]}` };
  if (/\.(mp4|webm|mov)(\?.*)?$/i.test(url)) return { kind: 'video' };
  if (/\.(mp3|wav|ogg)(\?.*)?$/i.test(url)) return { kind: 'audio' };
  return { kind: 'unrecognized' };
}

export function humanFileSize(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${i === 0 ? n : n.toFixed(1)} ${units[i]}`;
}

const EMBEDS: { test: RegExp; embed(u: string): string }[] = [
  { test: /figma\.com\/(file|proto)\//, embed: u => `https://www.figma.com/embed?embed_host=notlinear&url=${encodeURIComponent(u)}` },
  {
    test: /codepen\.io\/[\w-]+\/pen\/[\w-]+/,
    embed: u => { const m = u.match(/codepen\.io\/([\w-]+)\/pen\/([\w-]+)/); return `https://codepen.io/${m?.[1]}/embed/${m?.[2]}?default-tab=result`; },
  },
  {
    test: /google\.[a-z.]+\/maps\//,
    embed: u => { const m = u.match(/[?&]q=([^&]+)/); return `https://maps.google.com/maps?q=${m ? m[1] : encodeURIComponent(u)}&output=embed`; },
  },
];

/** The iframe URL for a pasted link, or null when it is not one of the supported sites. */
export function transformEmbedUrl(url: string): string | null {
  const hit = EMBEDS.find(e => e.test.test(url));
  return hit ? hit.embed(url) : null;
}

const FRAME_HOSTS = new Set(['www.youtube.com', 'player.vimeo.com', 'www.figma.com', 'codepen.io', 'maps.google.com']);

export function isAllowedFrameSrc(src: unknown): src is string {
  if (typeof src !== 'string') return false;
  try {
    const u = new URL(src);
    return u.protocol === 'https:' && FRAME_HOSTS.has(u.hostname);
  } catch { return false; }
}

export const isHttpUrl = (s: string): boolean => /^https?:\/\//i.test(s.trim());

/** The `data` prop of a pure-data block, as an object (never throws). */
export function readData(data: unknown): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(typeof data === 'string' ? data : '{}');
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch { return {}; }
}
