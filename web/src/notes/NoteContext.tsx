import { createContext, useContext } from 'react';

/** The page the editor is showing. Blocks such as a page link need it to create a subpage. */
export const NoteContext = createContext<{ noteId: string; startBranch?(): void } | null>(null);

export const useNoteId = (): string | null => useContext(NoteContext)?.noteId ?? null;

export const useStartBranch = (): (() => void) | undefined => useContext(NoteContext)?.startBranch;
