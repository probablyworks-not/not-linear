// Pricing and the per-thread usage bucket, from app.js:1695-1800 (claude and
// deepseek only; openai and gemini arrive with their providers).

const DEEPSEEK = { inMiss: 0.14 / 1e6, inHit: 0.0028 / 1e6, out: 0.28 / 1e6 };

function claudePricing(model: string): { in: number; out: number } {
  if (model.includes('haiku')) return { in: 1 / 1e6, out: 5 / 1e6 };
  if (model.includes('opus')) return { in: 5 / 1e6, out: 25 / 1e6 };
  return { in: 3 / 1e6, out: 15 / 1e6 };
}

export interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  cacheHitTokens?: number;
  provider: 'anthropic' | 'deepseek';
  model: string;
}

export function responseCost(u: TurnUsage): number {
  if (!u.inputTokens && !u.outputTokens) return 0;
  if (u.provider === 'deepseek') {
    const hit = u.cacheHitTokens || 0;
    return Math.max(0, u.inputTokens - hit) * DEEPSEEK.inMiss + hit * DEEPSEEK.inHit + u.outputTokens * DEEPSEEK.out;
  }
  const p = claudePricing(u.model);
  return u.inputTokens * p.in + u.outputTokens * p.out;
}

/** The fields addUsageToBucket writes on a thread. */
export interface UsageBucket {
  tokenIn?: number;
  tokenCacheHit?: number;
  tokenOut?: number;
  cost?: number;
  provider?: string;
  model?: string;
}

export function addUsageToBucket(bucket: UsageBucket, u: TurnUsage): void {
  bucket.tokenIn = (bucket.tokenIn || 0) + u.inputTokens;
  bucket.tokenCacheHit = (bucket.tokenCacheHit || 0) + (u.cacheHitTokens || 0);
  bucket.tokenOut = (bucket.tokenOut || 0) + u.outputTokens;
  bucket.cost = (bucket.cost || 0) + responseCost(u);
  bucket.provider = u.provider;
  bucket.model = u.model;
}

export function fmtTokenCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(n >= 10_000 ? 0 : 1) + 'k';
  return String(n);
}

export function fmtUsd(cost: number): string {
  const n = Number(cost || 0);
  if (n === 0) return '$0.00000';
  return '$' + (n < 0.001 ? n.toFixed(5) : n.toFixed(4));
}

/** app.js fmtUsage: "1.2k tok · $0.0042 · 30% cached", or null before any usage. */
export function formatUsage(b: UsageBucket): string | null {
  const tIn = b.tokenIn || 0;
  const tOut = b.tokenOut || 0;
  if (!tIn && !tOut) return null;
  const cost = b.cost || 0;
  const usd = fmtUsd(cost);
  const hit = b.tokenCacheHit || 0;
  const cached = hit > 0 && tIn > 0 ? ` · ${Math.round(hit / tIn * 100)}% cached` : '';
  return `${fmtTokenCount(tIn + tOut)} tok · ${usd}${cached}`;
}
