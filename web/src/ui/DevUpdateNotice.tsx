import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, EyeOff, RefreshCw } from 'lucide-react';

// Local-deploy notice. .claude/hooks/deploy-local.sh writes dist/deploy.json
// after each rebuild. If its id differs from the one this page booted with,
// offer a refresh. When the file is absent (plain builds, vite dev) this renders nothing.
type ItemType = 'fix' | 'feature' | 'change';
interface DeployItem { type: ItemType; text: string }
interface DeployInfo { id: string; items: DeployItem[] }

const LABELS: Record<ItemType, string> = { fix: 'Fixed', feature: 'New', change: 'Improved' };

const INFO_URL = `${import.meta.env.BASE_URL}deploy.json`;
const POLL_MS = 5000;
const PREVIEW_COUNT = 3;

async function fetchInfo(): Promise<DeployInfo | null> {
  try {
    const res = await fetch(INFO_URL, { cache: 'no-store' });
    if (!res.ok) return null;
    const info = (await res.json()) as Partial<DeployInfo>;
    if (typeof info.id !== 'string') return null;
    const items = Array.isArray(info.items) ? info.items.filter((i) => i && i.text && i.type in LABELS) : [];
    return { id: info.id, items };
  } catch {
    return null; // missing file, HTML fallback from the dev server, or mid-build
  }
}

export function DevUpdateNotice() {
  const baseline = useRef<string | null>(null);
  const [info, setInfo] = useState<DeployInfo | null>(null);
  const [hiddenId, setHiddenId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const check = async (): Promise<void> => {
      const next = await fetchInfo();
      if (!next) return;
      if (baseline.current === null) { baseline.current = next.id; return; }
      if (next.id !== baseline.current) setInfo((prev) => (prev?.id === next.id ? prev : next));
    };
    void check();
    const timer = window.setInterval(() => { void check(); }, POLL_MS);
    const onFocus = (): void => { void check(); };
    window.addEventListener('focus', onFocus);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, []);

  if (!info) return null;

  // Hidden: a small pill bottom-left brings the card back. A newer deploy re-shows the card.
  if (info.id === hiddenId) {
    return (
      <button
        type="button"
        data-testid="dev-update-pill"
        onClick={() => setHiddenId(null)}
        className="fixed bottom-4 left-4 z-50 inline-flex h-8 items-center gap-1.5 rounded-full border border-rule-2 bg-surface-2 px-3 text-[12px] text-text-2 shadow-lg hover:text-text"
      >
        <RefreshCw size={12} />
        {info.items.length > 0 ? `${info.items.length} updates` : 'Updated'}
      </button>
    );
  }

  const shown = expanded ? info.items : info.items.slice(0, PREVIEW_COUNT);
  const hidden = info.items.length - PREVIEW_COUNT;

  return (
    <div
      role="status"
      data-testid="dev-update-notice"
      className="fixed bottom-4 right-4 z-50 w-[340px] max-w-[calc(100vw-32px)] rounded-xl border border-rule-2 bg-surface-2 p-3 text-text shadow-lg"
    >
      <div className="flex items-center gap-2">
        <span className="flex-1 text-[13px] font-medium">
          {info.items.length > 0 ? "What's new" : 'New changes available'}
        </span>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="h-7 rounded-md bg-text px-3 text-[13px] font-medium text-bg"
        >
          Refresh
        </button>
        <button
          type="button"
          aria-label="Hide"
          title="Hide"
          onClick={() => setHiddenId(info.id)}
          className="grid h-7 w-7 place-items-center rounded-md text-text-3 hover:bg-bg-3 hover:text-text"
        >
          <EyeOff size={14} />
        </button>
      </div>
      {shown.length > 0 && (
        <ul className={`mt-2 list-disc space-y-1 pl-5 text-[13px] text-text-2 ${expanded ? 'max-h-48 overflow-y-auto' : ''}`}>
          {shown.map((item) => (
            <li key={`${item.type}:${item.text}`}>
              <span className="text-text-3">{LABELS[item.type]} · </span>{item.text}
            </li>
          ))}
        </ul>
      )}
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 inline-flex items-center gap-1 text-[12px] text-text-3 hover:text-text"
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {expanded ? 'Show less' : `Show all (+${hidden} more)`}
        </button>
      )}
    </div>
  );
}
