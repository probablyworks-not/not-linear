import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { Trash2 } from 'lucide-react';
import { useUiStore } from '../state/ui-store';
import { ESC_PRIORITY, useEscLayer } from '../lib/keyboard';

// The shared destructive-action confirmation. Copy is asserted by smoke step 3,
// so it comes from the request verbatim (see confirm-copy.ts for the strings).
// Escape is routed through the shared priority chain (lib/keyboard.ts) rather
// than Radix's own handler, so a confirm that opens over another surface is
// closed first by the same rule legacy applies.
export function ConfirmDialog() {
  const confirm = useUiStore(s => s.confirm);
  const resolve = useUiStore(s => s.resolveConfirm);

  useEscLayer('confirm', ESC_PRIORITY.confirm, confirm !== null, () => resolve(false));

  return (
    <AlertDialog.Root open={confirm !== null} onOpenChange={open => { if (!open) resolve(false); }}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-[360] bg-scrim backdrop-blur-[2px]" />
        <AlertDialog.Content
          onEscapeKeyDown={e => e.preventDefault()}
          className="fixed left-1/2 top-1/2 z-[361] w-[min(420px,calc(100vw-36px))] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[10px] border border-rule-2 bg-surface shadow-lg"
        >
          {confirm && (
            <>
              <div className="flex gap-3 px-[18px] pb-2.5 pt-[18px]">
                <div aria-hidden className="grid h-[34px] w-[34px] flex-none place-items-center rounded-lg bg-danger-soft text-danger">
                  <Trash2 size={16} />
                </div>
                <div className="min-w-0 flex-1">
                  <AlertDialog.Title className="m-0 mb-1 text-base font-semibold leading-tight text-text">{confirm.heading}</AlertDialog.Title>
                  <AlertDialog.Description className="m-0 text-sm leading-normal text-text-2">
                    {confirm.before + ' '}
                    <span className="inline-block max-w-full overflow-hidden text-ellipsis whitespace-nowrap align-bottom text-text">{`"${confirm.name}"`}</span>
                    {confirm.after}
                  </AlertDialog.Description>
                </div>
              </div>
              <div className="flex justify-end gap-2 px-[18px] pb-[18px] pt-3.5">
                <AlertDialog.Cancel className="h-[34px] rounded-[7px] border border-rule-2 bg-bg-2 px-[13px] text-sm font-medium text-text-2 hover:bg-bg-3 hover:text-text">
                  Cancel
                </AlertDialog.Cancel>
                <AlertDialog.Action
                  onClick={() => resolve(true)}
                  className="h-[34px] rounded-[7px] border border-danger-border bg-danger-strong px-[13px] text-sm font-medium text-danger-on hover:bg-danger-border"
                >
                  {confirm.actionLabel}
                </AlertDialog.Action>
              </div>
            </>
          )}
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
