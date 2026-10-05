import { esc } from '../lib/markdown';
import { fmtTokenCount, fmtUsd, responseCost, type TurnUsage } from './usage';
import { modelLabelFromId } from './models';
import type { TokenUsage } from '../providers/types';

// The collapsible usage line under a reply: `<details class="llm-meta">`. It is part of what is
// SAVED (unlike the Copy/Download row), so legacy shows it on a reply React wrote and the other
// way round. The context disclosure is the full brief the model was sent, for debugging and
// transparency; it is built the way app.js:1801-1857 does, with base64 and documents elided.

export interface ResponseMeta {
  usage: TokenUsage;
  provider: 'anthropic' | 'deepseek';
  model: string;
  thinking?: boolean;
}

function contextValueForDisplay(value: unknown, key = ''): unknown {
  if (value == null) return value;
  if (typeof value === 'string') {
    if ((key === 'data' || key === 'base64') && value.length > 120) return `[base64 omitted: ${fmtTokenCount(value.length)} chars]`;
    return value;
  }
  if (Array.isArray(value)) return value.map(item => contextValueForDisplay(item));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = contextValueForDisplay(v, k);
    return out;
  }
  return value;
}

function contentToContextText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((block: Record<string, unknown> | null) => {
      if (!block || typeof block !== 'object') return String(block ?? '');
      if (block.type === 'text') return String(block.text || '');
      if (block.type === 'document') return `[document: ${(block.source as { media_type?: string } | undefined)?.media_type || 'document'}; source data omitted]`;
      if (block.type === 'tool_use') return `[tool_use: ${block.name || 'tool'}]\n${JSON.stringify(contextValueForDisplay(block.input || {}), null, 2)}`;
      if (block.type === 'tool_result') return `[tool_result: ${block.tool_use_id || 'tool'}]\n${contentToContextText(block.content)}`;
      if (block.type === 'thinking') return '[reasoning block included in provider context; text hidden]';
      return JSON.stringify(contextValueForDisplay(block), null, 2);
    }).filter(Boolean).join('\n\n');
  }
  if (content && typeof content === 'object') return JSON.stringify(contextValueForDisplay(content), null, 2);
  return String(content ?? '');
}

function messageToContextText(message: Record<string, unknown>, index: number): string {
  const role = String(message?.role || 'message').toUpperCase();
  let body = contentToContextText(message?.content);
  const calls = message?.tool_calls as unknown[] | undefined;
  if (calls?.length) body += `\n\n[tool_calls]\n${JSON.stringify(contextValueForDisplay(calls), null, 2)}`;
  if (message?.tool_call_id) body = `[tool_call_id: ${message.tool_call_id}]\n${body}`;
  return `${index + 1}. ${role}\n${body || '[empty]'}`;
}

export function usageContextText(usage: TokenUsage): string {
  const ctx = usage.context;
  if (!ctx) return 'Context was not captured for this response.';
  const sections: string[] = [];
  if (ctx.system) sections.push(`SYSTEM\n${ctx.system}`);
  if (ctx.tools?.length) sections.push(`TOOLS\n${ctx.tools.join(', ')}`);
  if (ctx.messages?.length) sections.push(`MESSAGES\n${(ctx.messages as Array<Record<string, unknown>>).map(messageToContextText).join('\n\n')}`);
  if ((usage.requestCount ?? 0) > 1) sections.push(`NOTE\nToken totals include ${usage.requestCount} provider requests from tool-use rounds. The messages above are the final request context.`);
  return sections.join('\n\n---\n\n') || 'Context was empty.';
}

/** app.js:1861 setResponseMeta, as the markup it produces. */
export function responseMetaHTML(meta: ResponseMeta): string {
  const { usage } = meta;
  const turn: TurnUsage = { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cacheHitTokens: usage.cacheHitTokens, provider: meta.provider, model: meta.model };
  const total = (usage.inputTokens || 0) + (usage.outputTokens || 0);
  const cost = responseCost(turn);
  const modelName = modelLabelFromId(meta.model, meta.thinking);
  const cache = usage.cacheHitTokens || 0;
  const requestNote = (usage.requestCount ?? 0) > 1 ? ` · ${usage.requestCount} req` : '';
  const cacheNote = cache ? ` · ${fmtTokenCount(cache)} cached` : '';
  return `<details class="llm-meta">
      <summary>
        <span class="llm-summary-main"><i class="ti ti-receipt"></i><span>${esc(modelName)} · ${fmtTokenCount(total)} tokens${requestNote}${cacheNote}</span></span>
        <span class="llm-summary-cost">${esc(fmtUsd(cost))}</span>
        <i class="ti ti-chevron-down llm-chevron"></i>
      </summary>
      <div class="llm-meta-body">
        <div class="llm-usage-grid">
          <div class="llm-usage-cell"><span class="lab">Model</span><span class="val" title="${esc(meta.model || modelName)}">${esc(modelName)}</span></div>
          <div class="llm-usage-cell"><span class="lab">Input</span><span class="val">${esc(fmtTokenCount(usage.inputTokens || 0))}</span></div>
          <div class="llm-usage-cell"><span class="lab">Output</span><span class="val">${esc(fmtTokenCount(usage.outputTokens || 0))}</span></div>
          <div class="llm-usage-cell"><span class="lab">Cost</span><span class="val">${esc(fmtUsd(cost))}</span></div>
          ${cache ? `<div class="llm-usage-cell"><span class="lab">Cache hit</span><span class="val">${esc(fmtTokenCount(cache))}</span></div>` : ''}
        </div>
        <div class="llm-context-title">Context sent to model</div>
        <pre class="llm-context">${esc(usageContextText(usage))}</pre>
      </div>
    </details>`;
}
