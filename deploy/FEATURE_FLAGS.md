# Feature flag inventory

All currently available flags default on. projectMemory and designs retain their existing off defaults. The canonical defaults are backend/cloud/features.json; React and Python resolve the same dependencies. Admin configuration is scoped by NOTLINEAR_ENV, audited and revision-checked. Desktop can use NOTLINEAR_FLAGS_JSON without changing local DB formats.

| Controls | Surfaces / dependencies |
| --- | --- |
| chat, branches, highlights | Sidebar threads/recents, chat/branch navigation, Project chat cards/menu, selection actions, map/highlights/annotation controls, generation handlers, cloud records |
| notesV2 | Sidebar Notes, open/restored tabs, Project Notes card/drill-in/add menu, Notes actions, context and chat-to-Notes; cloud Notes records |
| canvas, sketch | Sidebar Canvas, Project Canvas card/drill-in, open/restored tabs, Canvas Sketch menu/placements, workspace generation |
| projects | Sidebar/grid/panel, project creation/navigation, move-to-project controls; does not disable independent content |
| artifacts, attachments | Project cards/drill-ins, artifact save controls, file pickers/paste, context, R2 upload/download APIs; existing content retained |
| settings, models, integrations, skills, modes, changelog, logs | Settings navigation/panels; General account and admin recovery remain accessible; provider/tool controls flagged individually |
| apiAnthropic, apiOpenai, apiDeepseek, apiGemini, apiCustom | Provider cards, composer options, request dispatch, credential storage and server proxy gates |
| subscriptionClaude, subscriptionChatgpt | Subscription options; actual hosted support is an additional capability gate, not established by enabling a flag |
| research, toolSerper, toolFirecrawl, toolSearxng, toolGithub | Offered tool schemas, tool execution and credential-backed proxy operations |
| voice, contextRanking, linkedFolders | Provider/settings/composer controls; cloud folders upload selected files instead of reading server paths |
| clarify, chatNotes, projectMemory, designs | Existing experimental/subfeature behavior; chatNotes requires both chat and notesV2; ranking/folders require attachments |

Configuration refresh occurs before workspace startup, on focus and every 60 seconds. Unchanged values do not interrupt work. Disabling a relevant feature cancels active chat/branch streams and preserves local partial output; disabled cloud APIs reject new work. Server provider streams also recheck their flag while streaming. Re-enabling uses existing records. No flag deletes content.

Tests explicitly exercise Notes removal in the sidebar, Projects, creation menus and re-enabling; Settings sections; admin visibility/authorization; direct disabled API calls. Other combinations must be covered during staging acceptance before enabling a new deployment configuration.
