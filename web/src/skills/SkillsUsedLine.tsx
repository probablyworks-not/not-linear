import { Sparkles } from 'lucide-react';
import { flags } from '../flags';
import { useChatStore } from '../chat/chat-store';

const WHY = { picked: 'picked', always: 'always on', pinned: 'pinned', match: 'auto' } as const;

/** What the last reply was given. Makes automatic selection visible, so it can be tested and tuned. */
export function SkillsUsedLine({ skillsKey }: { skillsKey: string }) {
  const used = useChatStore(s => s.skillsUsed[skillsKey]);
  if (!flags.skills || !used) return null;
  return (
    <div className="flex flex-wrap items-center gap-1 text-xs text-text-3" data-testid="skills-used">
      <Sparkles size={11} aria-hidden />
      {used.length === 0
        ? <span>Last reply: no skills matched</span>
        : <>
            <span>Last reply used:</span>
            {used.map(u => (
              <span key={u.name} className="rounded border border-rule-2 px-1.5 py-px text-text-2" title={u.reason === 'match' ? `score ${u.score.toFixed(1)}` : undefined}>
                {u.name} · {WHY[u.reason]}
              </span>
            ))}
          </>}
    </div>
  );
}
