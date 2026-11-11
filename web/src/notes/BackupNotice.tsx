import { useNotesStore } from './notes-store';

/** Shown in place of editing until the server confirms a backup file exists (ADR-042). */
export function BackupNotice() {
  const running = useNotesStore(s => s.backingUp);
  const error = useNotesStore(s => s.backupError);
  const runBackup = useNotesStore(s => s.runBackup);
  return (
    <div role="status" data-testid="backup-notice" className="mb-4 rounded-lg border border-rule-2 bg-surface-2 px-4 py-3 text-sm text-text-2">
      <p className="mb-2 text-text">Back up your notes before editing here.</p>
      <p className="mb-3">
        The new editor rewrites your notes. This saves a copy of every note to a file on this computer first;
        editing unlocks once the file is written. The copy covers this app window&rsquo;s notes only.
      </p>
      <button
        type="button" disabled={running} onClick={() => { void runBackup(); }}
        className="rounded-lg border border-rule-2 bg-bg-2 px-3 py-1.5 text-sm text-text hover:bg-bg-3 disabled:opacity-60"
      >
        {running ? 'Backing up…' : 'Back up notes'}
      </button>
      {error && <p role="alert" className="mt-2 text-text-2">Couldn&rsquo;t back up: {error}. Nothing was changed.</p>}
    </div>
  );
}
