import { cn } from '../../../lib/utils';
import { camelotKeyColor, formatCamelotCode } from './camelotKey';

/** Camelot key pill with a colored bar, as shown in the Cue Points track table. */
export function KeyBadge({ camelotKey, className }: { camelotKey: string | null | undefined; className?: string }) {
  const label = formatCamelotCode(camelotKey);
  if (!label) return <span className={cn('text-xs text-muted-foreground', className)}>—</span>;
  const color = camelotKeyColor(label);
  return (
    <span
      className={cn('inline-flex items-center rounded-[5px] bg-white/[0.05] py-1 pl-[3px] pr-2 font-mono text-[13px] font-bold', className)}
      style={{ color }}
    >
      <span className="mr-1.5 h-[14px] w-[3px] shrink-0 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}
