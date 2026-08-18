import type { ElementType, ReactNode } from 'react';
import { cn } from '../../../lib/utils';
import '../dropdex-display.css';

export type TypographyVariant =
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'h5'
  | 'body'
  | 'muted'
  | 'small-muted'
  | 'mono'
  | 'brand';

export type BrandTone = 'primary' | 'secondary' | 'success' | 'warning' | 'danger';

export interface TypographyProps {
  variant?: TypographyVariant;
  tone?: BrandTone;
  gradient?: boolean;
  as?: ElementType;
  className?: string;
  children: ReactNode;
}

const DEFAULT_TYPOGRAPHY_TAGS: Record<TypographyVariant, ElementType> = {
  h1: 'h1',
  h2: 'h2',
  h3: 'h3',
  h4: 'h4',
  h5: 'h5',
  body: 'p',
  muted: 'p',
  'small-muted': 'p',
  mono: 'code',
  brand: 'span',
};

export function Typography({
  variant = 'body',
  tone = 'primary',
  gradient = false,
  as,
  className,
  children,
}: TypographyProps) {
  const Tag = as ?? DEFAULT_TYPOGRAPHY_TAGS[variant];
  return (
    <Tag
      className={cn(
        'dd-type',
        `dd-type--${variant}`,
        variant === 'brand' && `dd-type--brand-${tone}`,
        gradient && 'dd-type--gradient',
        className,
      )}
    >
      {children}
    </Tag>
  );
}
