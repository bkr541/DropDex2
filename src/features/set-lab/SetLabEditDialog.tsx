import { Dialog } from '../../components/ui/feedback';

export function SetLabEditDialog({ title, confirmLabel, details, message, onCancel, onConfirm }: {
  title: string;
  confirmLabel: string;
  details?: string;
  message?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div onKeyDown={(event) => {
      if (event.key !== 'Tab') return;
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (event.shiftKey ? current <= 0 : current === buttons.length - 1) {
        event.preventDefault();
        (event.shiftKey ? buttons.at(-1) : buttons[0])?.focus();
      }
    }}>
      <Dialog title={title} onClose={onCancel} actions={[
        { label: 'Cancel', onClick: onCancel },
        { label: confirmLabel, variant: 'primary', onClick: onConfirm },
      ]}>
        <p>{message ?? 'Applying this change will stop playback and reset the preview to the beginning.'}</p>
        {details && <p className="mt-2 text-xs text-muted-foreground">{details}</p>}
      </Dialog>
    </div>
  );
}
