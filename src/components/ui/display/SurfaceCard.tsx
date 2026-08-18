import type { ElementType, ReactNode } from 'react';
import { cn } from '../../../lib/utils';
import '../dropdex-display.css';

export type SurfaceCardVariant = 'glass' | 'surface';

export interface SurfaceCardProps {
  variant?: SurfaceCardVariant;
  children: ReactNode;
  className?: string;
  as?: ElementType;
}

export function SurfaceCard({
  variant = 'surface',
  children,
  className,
  as: Tag = 'article',
}: SurfaceCardProps) {
  return (
    <Tag className={cn('dd-display-card', `dd-display-card--${variant}`, className)}>
      {children}
    </Tag>
  );
}
