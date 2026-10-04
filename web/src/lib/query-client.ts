import { QueryClient } from '@tanstack/react-query';

// ADR-041 boundary: TanStack Query is for BACKEND-DERIVED reads only —
// /CHANGELOG.md, scan_project, feedback_list. Anything that lives in IndexedDB
// is local state and goes through the Zustand store and db/chat-repo.ts. A
// query cache in front of Dexie is two sources of truth for one row, and the
// legacy app is a third writer; do not do it.
export const queryClient = new QueryClient({
  defaultOptions: {
    // A local single-user server: retrying a 403 or a refused connection just
    // delays the error message the user needs.
    queries: { retry: false, refetchOnWindowFocus: false, staleTime: 30_000 },
  },
});
