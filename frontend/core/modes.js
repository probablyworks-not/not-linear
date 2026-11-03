// Conversation modes — the single registry for the composer's mode menu.
// A mode is only a system prompt: label + one-line description + instructions.
//
// Built-ins live here in code. User edits are stored as overrides only
// (appState.prefs.modeOverrides, keyed by built-in id) and user-created modes
// in appState.prefs.customModes, both inside the existing `kv:'state'` blob
// (core/store.js — no Dexie schema change). Merging at read time means future
// improvements to a built-in still reach users who never edited it, and
// "Reset to default" is just deleting the override.
import { appState } from './state.js';

export const DEFAULT_MODE_ID = 'general';
export const CUSTOM_MODE_ICON = 'ti-sparkles';

export const DEFAULT_MODES = [
  { id:'general', label:'General', icon:'ti-message-2', desc:'Balanced default', instructions:'' },
  { id:'research', label:'Research', icon:'ti-telescope', desc:'Search-heavy, cited', instructions:[
    'You are in Research mode. Be thorough and evidence-driven.',
    'Search proactively and early: for any question involving facts, current events, data, prices, people, companies, or anything you are not fully certain of, call a search tool BEFORE answering rather than relying on memory.',
    'Cross-check important claims against more than one source when feasible, and call out gaps or conflicting sources explicitly. Always include the "### References" section listing the sources you actually used.',
  ].join('\n\n') },
  { id:'coding', label:'Coding', icon:'ti-code', desc:'Code-focused, precise', instructions:[
    'You are in Coding mode. Optimize for correct, runnable, idiomatic code.',
    'Default to fenced code blocks with a language tag. Keep prose tight — explain only what is non-obvious, note key assumptions (language/runtime version) and important edge cases, and prefer complete, copy-pasteable snippets over fragments.',
    'Do not search the web unless you need current or version-specific API details, library docs, or error text you are unsure about; otherwise answer from your own knowledge.',
  ].join('\n\n') },
  { id:'pm', label:'PM', icon:'ti-users', desc:'User & business focus', instructions:[
    'For this conversation, adopt the mindset of a senior Product Manager. User needs, business value, and strategic prioritization take precedence over technical details.',
    'Frame every problem by first answering: Who is this for? What is the job to be done? What does success look like in measurable terms? What are we deliberately NOT building, and why?',
    'Evaluate proposals by impact × value ÷ effort. Surface scope creep explicitly — name it when it appears. Push back on "let\'s build X" with "what user problem does X solve?"',
    'Close substantive responses with a compact block — Impact | Effort | Open questions — each on its own line.',
  ].join('\n\n') },
  { id:'cto', label:'CTO', icon:'ti-cpu', desc:'Build & execute', instructions:[
    'For this conversation, adopt the mindset of a CTO focused on technical execution and architectural reality.',
    'For every proposal, evaluate: Can the team realistically build this? How long (gut estimate × 1.5)? Build vs buy? Which decisions are reversible and which lock us in permanently?',
    'Name the top risks explicitly — if a risk can kill the project, say so plainly. Factor in operational burden post-launch, not just build cost. Flag security surface areas.',
    'Close substantive responses with a compact block — Recommendation | Key risks | Open decisions — each on its own line.',
  ].join('\n\n') },
  { id:'critic', label:'Critic', icon:'ti-sword', desc:"Devil's advocate", instructions:[
    'For this conversation, operate as a Devil\'s Advocate. Your role is to stress-test ideas, not validate them.',
    'Start every response by steel-manning the proposal — state its strongest possible form before critiquing it.',
    'Then attack systematically: which assumptions is this built on? Which are unverified? What is the single most likely failure mode?',
    'Rank objections: Critical (cannot proceed without fixing this), Significant (needs mitigation before launch), Minor (worth noting).',
    'End with a verdict — Proceed, Revise, or Scrap — and one sentence of reasoning. Do not soften this. Validation is available everywhere; your value is finding what breaks before it breaks.',
  ].join('\n\n') },
];

// getModes: built-ins (with any user overrides applied) followed by custom
// modes. Each entry carries `builtin` and `edited` flags for the modal.
export function getModes(){
  const overrides = appState.prefs.modeOverrides || {};
  const builtins = DEFAULT_MODES.map(m => {
    const o = overrides[m.id];
    return { ...m, ...(o || {}), builtin:true, edited:!!o };
  });
  const custom = (appState.prefs.customModes || []).map(m => ({
    icon:CUSTOM_MODE_ICON, desc:'', instructions:'', ...m, builtin:false, edited:false,
  }));
  return [...builtins, ...custom];
}

// getMode: resolve an id, falling back to General for unknown/deleted ids.
export function getMode(id = appState.prefs.mode){
  const all = getModes();
  return all.find(m => m.id === id) || all[0];
}

export function hasMode(id){
  return getModes().some(m => m.id === id);
}

// modeSystemPromptParts: system-prompt paragraphs for a mode ('general' and
// empty instructions add nothing). Same string[] shape the callers always got.
export function modeSystemPromptParts(id){
  const text = (getMode(id).instructions || '').trim();
  return text ? text.split(/\n{2,}/).map(s => s.trim()).filter(Boolean) : [];
}

export function newModeId(){
  return 'custom-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// saveMode: create (no id match) or update. Built-ins store an override
// holding only the fields that differ from the default; custom modes are
// replaced wholesale. Returns the saved mode's id.
export function saveMode({ id, label, desc, instructions }){
  const prefs = appState.prefs;
  const builtin = DEFAULT_MODES.find(m => m.id === id);
  if (builtin){
    const o = {};
    if (label !== builtin.label) o.label = label;
    if (desc !== builtin.desc) o.desc = desc;
    if (instructions !== builtin.instructions) o.instructions = instructions;
    prefs.modeOverrides = { ...(prefs.modeOverrides || {}) };
    if (Object.keys(o).length) prefs.modeOverrides[id] = o;
    else delete prefs.modeOverrides[id];
    return id;
  }
  const list = [...(prefs.customModes || [])];
  const i = list.findIndex(m => m.id === id);
  if (i >= 0){
    list[i] = { id, label, desc, instructions };
    prefs.customModes = list;
    return id;
  }
  const nid = newModeId();
  prefs.customModes = [...list, { id:nid, label, desc, instructions }];
  return nid;
}

export function resetMode(id){
  const prefs = appState.prefs;
  if (!prefs.modeOverrides || !(id in prefs.modeOverrides)) return;
  prefs.modeOverrides = { ...prefs.modeOverrides };
  delete prefs.modeOverrides[id];
}

// deleteMode: custom modes only (built-ins can only be reset). If the active
// mode is deleted, selection falls back to General.
export function deleteMode(id){
  const prefs = appState.prefs;
  if (DEFAULT_MODES.some(m => m.id === id)) return;
  prefs.customModes = (prefs.customModes || []).filter(m => m.id !== id);
  if (prefs.mode === id) prefs.mode = DEFAULT_MODE_ID;
}
