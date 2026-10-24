import { FilePlus, FolderPlus, GitBranch, Plus } from 'lucide-react';
import { useState } from 'react';
import { FloatingMenu, MENU_ITEM } from './ComposerMenus';
import { ESC_PRIORITY } from '../lib/keyboard';
import { addFilesTo } from '../attachments/attach-actions';
import { useAttachments } from '../attachments/attachments-store';
import { useUiStore } from '../state/ui-store';
import { toast } from '../ui/toast';

/** The `+` under a composer: add files, add a folder, or attach a branch's transcript as context. */
export function AttachChip({ attachKey }: { attachKey: string }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const close = (): void => setAnchor(null);
  return (
    <>
      <button
        type="button" className="chip branch-attach-btn" title="Add files or folder" aria-label="Add files or folder" aria-haspopup="menu" aria-expanded={!!anchor}
        // Read the element now; inside the updater React has already reset currentTarget.
        onClick={e => { const el = e.currentTarget; setAnchor(prev => (prev ? null : el)); }}
      >
        <Plus size={14} />
      </button>
      {anchor && (
        <FloatingMenu anchor={anchor} label="Add to this message" onClose={close} escId="attachMenu" escPriority={ESC_PRIORITY.attachMenu}>
          {/* The picker must open from the click itself, not after an await (BUGS.md #021). */}
          <button type="button" role="menuitem" className={MENU_ITEM} onClick={() => { close(); void addFilesTo(attachKey, false); }}>
            <FilePlus size={14} className="w-4 flex-none text-text-2" /><span>Add files</span>
          </button>
          <button type="button" role="menuitem" className={MENU_ITEM} onClick={() => { close(); void addFilesTo(attachKey, true); }}>
            <FolderPlus size={14} className="w-4 flex-none text-text-2" /><span>Add folder</span>
          </button>
          <button
            type="button" role="menuitem" className={MENU_ITEM}
            onClick={() => { close(); useAttachments.getState().setPicker(attachKey); toast('Click a branch to add it as context — click again to remove'); useUiStore.getState().setCtxOpen(true); }}
          >
            <GitBranch size={14} className="w-4 flex-none text-text-2" /><span>Attach branch</span>
          </button>
        </FloatingMenu>
      )}
    </>
  );
}
