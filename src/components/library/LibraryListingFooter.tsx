import type { ReactNode } from 'react';

export function LibraryListingFooter({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-t border-[var(--color-border-subtle)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between md:px-5">
      <div className="space-y-0.5 text-xs text-muted-foreground">{children}</div>
      {action}
    </div>
  );
}
