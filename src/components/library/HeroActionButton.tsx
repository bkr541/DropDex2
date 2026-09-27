import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface HeroActionButtonProps {
  variant: 'import' | 'resume';
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
  className?: string;
}

export function HeroActionButton({ variant, onClick, children, className }: HeroActionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-[10px] font-bold uppercase tracking-widest transition-all',
        variant === 'import' && [
          'border border-blue-500 text-blue-400 bg-transparent',
          'hover:bg-blue-500/10 hover:border-blue-400',
        ],
        variant === 'resume' && [
          'border border-amber-400/40 bg-amber-400/20 text-amber-300',
          'hover:bg-amber-400/30 hover:border-amber-400/60',
        ],
        className,
      )}
    >
      {children}
    </button>
  );
}
