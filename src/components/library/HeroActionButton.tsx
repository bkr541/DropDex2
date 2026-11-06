import type { ReactNode } from 'react';
import { ControlButton } from '../ui/controls/ControlButton';

interface HeroActionButtonProps {
  /** What the button does. Both are primary actions and look the same. */
  variant: 'import' | 'resume';
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
  className?: string;
}

/** The Library hero's full-width action: the shared primary button. */
export function HeroActionButton({ variant, onClick, children, className }: HeroActionButtonProps) {
  return (
    <ControlButton variant="primary" onClick={onClick} className={`!w-full text-[10px] ${className ?? ''}`} data-action={variant}>
      {children}
    </ControlButton>
  );
}
