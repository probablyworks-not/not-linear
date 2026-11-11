import { Fragment } from 'react';
import { useNotesStore } from './notes-store';
import { openNote, openNotesIndex } from './open-note';

const Sep = () => <span className="text-text-3">/</span>;
const link = 'rounded-sm text-text-2 hover:text-text hover:underline';

/** Notes / each ancestor page / this page. Every segment but the last opens that page. */
export function NoteBreadcrumbs({ noteId }: { noteId: string }) {
  const notes = useNotesStore(s => s.notes);
  const chain: { id: string; title: string }[] = [];
  const seen = new Set<string>();
  let cursor = notes.find(n => n.id === noteId);
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    chain.unshift({ id: cursor.id, title: typeof cursor.title === 'string' && cursor.title ? cursor.title : 'Untitled' });
    const parent: unknown = cursor.parent;
    cursor = typeof parent === 'string' ? notes.find(n => n.id === parent) : undefined;
  }
  const here = chain.pop();

  return (
    <span className="flex min-w-0 items-center gap-2 truncate">
      <button type="button" className={link} onClick={openNotesIndex}>Notes</button>
      {chain.map(c => (
        <Fragment key={c.id}>
          <Sep />
          <button type="button" className={link} onClick={() => openNote(c.id)}>{c.title}</button>
        </Fragment>
      ))}
      {here && (
        <>
          <Sep />
          <span className="truncate text-text">{here.title}</span>
        </>
      )}
    </span>
  );
}
