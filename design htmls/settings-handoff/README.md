# notlinear — Settings page: build spec

Reference: `Settings.dc.html` (open in a browser; needs `support.js` and `uploads/mind-garden-icons.html` beside it). It is a visual + behavioral prototype. Rebuild it in the app's real frontend (`frontend/views/…`) using the app's own state, storage and components. Don't ship the prototype code.

## Layout
- Full-height two-pane. **Left rail** 240px (`#F8F8F7`, right border `#ECECEA`): title "Settings", 7 tab buttons, user chip pinned at bottom.
- **Right pane**: header (title + subtitle, optional page actions, back button), 1px divider, scrollable content.
- Tab button: 38px high, 9px radius, icon + label + count (mono 10px, `#AAA`). Active = white bg, weight 600, `0 1px 3px rgba(0,0,0,.08), 0 0 0 1px #ECECEA`.
- Content max-width 1000px (Product updates 760px), padding `28px 36px 40px`.
- Tabs and counts:
  1. Appearance
  2. Models & keys (count = providers with a key set)
  3. Skills (count = skills)
  4. Integrations (count = connected apps + running MCP servers)
  5. Modes (count = modes)
  6. Product updates (no count)
  7. Runtime logs (count = events)

## Design tokens
- Font: Space Grotesk (UI), Space Mono (labels, code, numbers). Base 14px.
- Ink `#1A1A1A`; muted `#666 / #8A8A8A / #999 / #AAA`; borders `#E0E0DE` (inputs), `#E9E9E7` (cards), `#F0F0EE` (row dividers); surface `#F3F3F2`, `#FAFAF9`.
- Primary button: `#1A1A1A` bg, white text, 34px high, 9px radius. Secondary: white, 1px `#E0E0DE`.
- Destructive: text `#C0453A`, border `#F0D4D0`.
- Status: green pill bg `#EAF6EF` / text `#2F7A55` / dot `#3BA676`; neutral pill `#F3F3F2` / `#999` / dot `#BBB`.
- Toggle: 34×20, knob 16, on `#1A1A1A`, off `#DADAD8`, 140ms.
- Input focus: border `#1A1A1A`.
- Section label: Space Mono 10px, uppercase, 0.12em tracking, `#AAA`.
- Icons: Mind Garden set (`mind-garden.js` / `renderIconSvg`), stroke 2.6 on 64 viewBox. Sidebar: Sun, Key, Sprout, Bridge, Thought, SpringBud, Lantern. Log kinds: Brain (llm), Trowel (tool), Thorn (error). Release: Sunflower (latest), Seed (older). Other small UI glyphs in the prototype use Tabler (`ti ti-*`) and can map to the app's existing icons.

---

## 1. Appearance
Grid of 3 theme cards: **Dark**, **Grey**, **Light** (miniature preview: sidebar block, 3 text lines, composer bar).
- States: selected (1.5px `#1A1A1A` border, 3px soft ring, filled check icon) / unselected (`#E4E4E2`, empty circle).
- Behavior: click applies theme immediately and persists to local preference. Default Light.

## 2. Models & keys
Two groups, **Models** (Anthropic, OpenAI, DeepSeek, Google) and **Search & tools** (Serper, Firecrawl, SearXNG). Cards in an auto-fit grid (min 270px). Each card: colored initial logo, name, subtitle, status pill.
- States per card:
  - **Collapsed** (default).
  - **Expanded + connected**: masked key (`sk-a••••••••qwAA`, first 4 + last 4), **Remove** button.
  - **Expanded + not set**: password input "Paste API key…", **Connect** button, note "Stored locally. Never leaves your device except to {provider}."
  - Pill: **Connected** (green) / **Not set** (neutral). Open card gets `#1A1A1A` border.
- Behavior: only one card open at a time; click header toggles. Connect with empty input does nothing; otherwise stores key and shows masked. Remove deletes the key. SearXNG takes a URL, not a key (adjust placeholder and validation). Keys are stored on-device only; never render the full key after save.
- Needed: validation/test of a key (spinner, error "Invalid key", success), per-provider default model.

## 3. Skills
Header actions: **Import**, **New skill**. Page-level toggle **Pick automatically** (router may choose skills per message).
- **List view**: card grid (min 280px). Card = icon by group (Foundation / Meta / Custom), name (ellipsis), enable toggle, 3-line description, tag (`Built-in` / `Custom`), optional **Always on** pin, arrow. Disabled skill = 55% opacity.
- **Detail view** (full-page overlay, breadcrumb "Skills / {name}", **All skills** back button):
  - Editable name (slug: lowercased, spaces→`-`, must be unique, empty/duplicate rejected), tag, **Export**, **Delete** (custom only, destructive).
  - **What it does** (description) and **When to use it** (trigger sentence) textareas.
  - **Keywords**: chips with remove ×; add on Enter.
  - **Instructions**: markdown editor, mono, resizable, live stats "N lines · N chars".
  - Footer bar: **Always on** toggle (added to every message), **Auto-select** toggle (router may pick), **Priority** stepper (min 0).
- Behavior: card click opens detail; toggle click must not open it. New skill creates `new-skill-N` (Custom, enabled, empty keywords, body "# New skill") and selects it. Delete returns to list. Import = file picker (markdown/JSON). Export = download `.md`.
- Empty state: no skills match / none exist.

## 4. Integrations
Segmented sub-tabs with counts: **Apps**, **MCP servers**, **Plugins**.
- **Apps** (GitHub, Reddit, Notion, Google Drive, Slack): row = icon, name, status pill, subtitle, scope list (`Read repos · Issues · …`), button. Connected: subtitle "Connected as {account}", button **Disconnect** (secondary). Not connected: offer text, button **Connect** (primary).
  - Needed: OAuth flow, connecting / error states, scope review.
- **MCP servers**: header button **Add server** reveals a dashed inline form (Name, URL-or-command mono input, **Add**). Row = server icon, name, status pill (**Running** / **Off**), command (mono, ellipsis), tool count ("11 tools", "1 tool"), enable toggle, delete. Add with empty name is ignored; empty command saves "not configured", 0 tools.
  - Needed: starting/error/crashed states, tool list per server, stdio vs HTTP detection.
- **Plugins**: row = icon, name, description, toggle (Wikipedia search, Web search, Fetch a web page, Save answers as notes). Web search depends on a Serper key; show a warning state when missing.

## 5. Modes
Master/detail. Left list (230px): icon, name, subtitle; selected = `#1A1A1A` border + `#F6F6F5`. Right panel: **Name** input, **System prompt** textarea (resizable), helper text "Added to the system prompt for every chat in this mode. Switch the active mode from the composer.", **Delete**.
- Default modes: General, Critic, Engineer, CTO. **New mode** header button adds "New mode" (Custom, empty prompt) and selects it. Deleting selects the first remaining; handle zero modes (empty state) and protect the last/default mode.

## 6. Product updates
Reads `CHANGELOG.md` when the app can access the local file. List of release cards, newest first.
- Card: header band (icon tile, version, date mono, **Latest** badge on newest; latest card has blue tint `#EEF4FD` + `#BFD3F2` border), summary paragraph, then change groups as rows (pill left, items right). Groups: **New** (green `#CDEBDA/#1F6B48`), **Improved** (blue `#CFE0F7/#2F5FA8`), **Fixed** (amber `#F7DDB8/#9A5A12`). Each item = bold title + sentence. Empty groups are hidden.
- Footnote: "Reads from CHANGELOG.md when the app can access the local file."
- Needed: parse `## x.y.z (date)` sections and bullets (`**Title.** text`, tag from Added/Changed/Fixed), loading, file-unavailable and empty states, refresh, optional "unread" dot on the tab after an update.

## 7. Runtime logs
Source: `logs.md` (JSON events). Newest first.
- Toolbar: filter segmented control **All / LLM / Tool / Error** with counts; `logs.md synced` status (green dot); icon buttons **Refresh**, **Copy** (all visible events), **Clear** (destructive).
- Row (collapsed): chevron, time (`HH:MM:SS`), kind pill (icon + `llm`/`tool`/`error`), title, meta (duration · tokens) right-aligned. Row (expanded): pretty-printed JSON, mono 12px, horizontal scroll. One row open at a time.
- Kind colors: llm blue `#EAF0FB/#2F5FA8`, tool violet `#F1EEFB/#5B4BB5`, error red `#FBEAE8/#C0453A`.
- Event shape (llm): `timestamp, id, kind, phase, startedAt, endedAt, durationMs, provider, model, inputTokens, outputTokens, requestCount, toolRounds, finishReason, outputChars`. Tool: `id, name, provider, durationMs, ok, …`. Error: `id, provider, model, status, message, retryInMs`.
- States: empty ("No events."), filter with no matches, sync pending / synced / failed, clearing (confirm before wiping `logs.md`), live append while the app runs.
- Never log API keys or full prompts.

## Global behaviors
- Back button (top right of header) leaves settings.
- All settings persist locally; changes apply immediately (no Save button).
- Destructive actions (remove key, delete skill/mode/server, clear logs) should confirm.
- Keyboard: Esc closes skill detail, then settings; Enter adds keyword; focus rings on all inputs.
- Responsive: grids reflow (`auto-fit/auto-fill`); rail may collapse to icons below ~720px (not designed yet).

## Not designed yet (ask before building)
Loading/skeleton states, error toasts, light/dark variants of every screen (prototype is light only), mobile layout, skill import conflict handling, key test UX.
