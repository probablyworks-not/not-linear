export function ShowMoreButton({ expanded, hidden, onToggle }: { expanded: boolean; hidden: number; onToggle: () => void }) {
  return (
    <button
      type="button" onClick={onToggle} aria-expanded={expanded}
      className="ml-2 mt-0.5 rounded-md px-2 py-1 text-left text-xs text-text-3 hover:bg-bg-2 hover:text-text-2"
    >
      {expanded ? 'Show less' : `Show ${hidden} more`}
    </button>
  );
}
