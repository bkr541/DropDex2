import type { ReactNode } from 'react';

/** One fact about a USB or a library file, drawn as the About tab draws its contents: the label on the left, the value on the right. */
export function UsbStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="profile-usb-stat flex flex-wrap items-center justify-between gap-x-4 gap-y-1" data-testid="usb-stat">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-mono text-xs">{value}</dd>
    </div>
  );
}

export function UsbStats({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={`profile-usb-stats${className ? ` ${className}` : ''}`}>{children}</dl>;
}
