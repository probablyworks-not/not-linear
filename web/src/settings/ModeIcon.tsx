import { Cpu, Code, MessageSquare, Sparkles, Swords, Telescope, Users } from 'lucide-react';

// Legacy stores Tabler class names in the mode data, and a custom mode saved by
// either app carries one. lucide has no 1:1 set, so map the ones that exist and
// fall back to the sparkle every custom mode gets anyway.
const ICON_SIZE = 14;
export function ModeIcon({ name }: { name: string }) {
  switch (name) {
    case 'ti-message-2': return <MessageSquare size={ICON_SIZE} className="flex-none text-text-2" aria-hidden />;
    case 'ti-telescope': return <Telescope size={ICON_SIZE} className="flex-none text-text-2" aria-hidden />;
    case 'ti-code': return <Code size={ICON_SIZE} className="flex-none text-text-2" aria-hidden />;
    case 'ti-users': return <Users size={ICON_SIZE} className="flex-none text-text-2" aria-hidden />;
    case 'ti-cpu': return <Cpu size={ICON_SIZE} className="flex-none text-text-2" aria-hidden />;
    case 'ti-sword': return <Swords size={ICON_SIZE} className="flex-none text-text-2" aria-hidden />;
    default: return <Sparkles size={ICON_SIZE} className="flex-none text-text-2" aria-hidden />;
  }
}
