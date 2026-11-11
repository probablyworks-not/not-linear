import { TOOL_SPECS, type ToolContext } from '../providers/tool-specs';
import type { ToolName } from '../providers/types';
import { flags } from '../flags';

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
  github_search_repos: { label: 'GitHub repo search', needs: 'a GitHub token' },
  github_search_issues: { label: 'GitHub issue search', needs: 'a GitHub token' },
  github_search_code: { label: 'GitHub code search', needs: 'a GitHub token' },
  github_get_issue: { label: 'GitHub issue reader', needs: 'a GitHub token' },
  github_get_file: { label: 'GitHub file reader', needs: 'a GitHub token' },
  list_project_files: { label: 'List linked project folder', needs: 'a linked project folder' },
  read_project_file: { label: 'Read linked project files', needs: 'a linked project folder' },
  create_note: { label: 'Save answers as notes when asked', needs: null },
};

export interface ToolStatus { name: ToolName; label: string; on: boolean; needs: string | null }

export function toolStatuses(ctx: ToolContext): ToolStatus[] {
  return TOOL_SPECS.map(spec => {
    const meta = LABEL[spec.name];
    const on = spec.available({ notes: flags.chatNotes, ...ctx });
    return { name: spec.name, label: meta.label, on, needs: on ? null : meta.needs };
  });
}
