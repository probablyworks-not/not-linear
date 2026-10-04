import { TOOL_SPECS, type ToolContext } from '../providers/tool-specs';
import type { ToolName } from '../providers/types';

// What Settings shows next to the API keys: which of the model's tools are
// live right now and, if not, what turns them on. Availability itself comes
// from the registry (`spec.available`), not from a second copy of the rules
// here — only the human wording lives in this file.
const LABEL: Record<ToolName, { label: string; needs: string | null }> = {
  wikipedia_search: { label: 'Wikipedia search', needs: null },
  fetch_url: { label: 'Fetch a web page', needs: null },
  web_search: { label: 'Web search (SearXNG)', needs: 'a SearXNG URL' },
  serper_search: { label: 'Web search (Serper)', needs: 'a Serper key' },
  firecrawl_scrape: { label: 'Web scrape (Firecrawl)', needs: 'a Firecrawl key' },
};

export interface ToolStatus { name: ToolName; label: string; on: boolean; needs: string | null }

export function toolStatuses(ctx: ToolContext): ToolStatus[] {
  return TOOL_SPECS.map(spec => {
    const meta = LABEL[spec.name];
    const on = spec.available(ctx);
    return { name: spec.name, label: meta.label, on, needs: on ? null : meta.needs };
  });
}
