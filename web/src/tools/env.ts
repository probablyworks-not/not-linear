import { readApiKeys } from '../lib/api-keys';
import { useAppStore } from '../state/app-store';

// What the tool runners need from the app: the stored keys and the SearXNG URL. Read at the
// moment a tool runs (not at import), so a key added in Settings mid-session is used by the
// next call. Tests swap it for fixed values.

export interface ToolEnv {
  apiKeys: Record<string, string>;
  searxngUrl?: string;
}

const live = (): ToolEnv => ({ apiKeys: readApiKeys(), searxngUrl: useAppStore.getState().prefs.searxngUrl });

let factory: () => ToolEnv = live;
export const toolEnv = (): ToolEnv => factory();
export function setToolEnvForTests(f: (() => ToolEnv) | null): void { factory = f ?? live; }
