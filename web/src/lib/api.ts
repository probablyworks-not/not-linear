// Backend reads for TanStack Query. P3 needs only this plumbing; the three
// consumers (/CHANGELOG.md, scan_project) arrive in P4.
//
// The header is required by every /__notlinear_* endpoint (ADR-035) and is
// harmless elsewhere. Same-origin only: the app is served from the Python
// server, never from Vite's own port.
export const LOCAL_HEADER = { 'X-Notlinear-Local': '1' } as const;

export async function getText(path: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(path, { signal, headers: LOCAL_HEADER });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.text();
}

export async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', ...LOCAL_HEADER },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return (await res.json()) as T;
}
