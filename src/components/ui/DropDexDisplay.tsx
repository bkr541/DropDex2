import {
  useEffect,
  useState,
  type ButtonHTMLAttributes,
  type ElementType,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { cn } from '../../lib/utils';
import './dropdex-display.css';
import { MusicAdd, UserAvatar } from '@carbon/icons-react';

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

export interface StatTileProps {
  label: string;
  value?: ReactNode;
  trend?: ReactNode;
  caption?: ReactNode;
  chartValues?: number[];
  className?: string;
}

export function StatTile({
  label,
  value,
  trend,
  caption,
  chartValues = [],
  className,
}: StatTileProps) {
  const finiteValues = chartValues.map((item) => Number.isFinite(item) ? Math.max(0, item) : 0);
  const max = Math.max(...finiteValues, 1);

  return (
    <SurfaceCard className={cn('dd-stat-tile', className)}>
      <p className="dd-stat-tile__label">{label}</p>
      <div className="dd-stat-tile__headline">
        <strong title={typeof value === 'string' ? value : undefined}>{value === '' || value == null ? '—' : value}</strong>
        {trend != null && <span>{trend}</span>}
      </div>
      {finiteValues.length > 0 && (
        <div className="dd-stat-tile__chart" aria-hidden="true">
          {finiteValues.map((item, index) => (
            <i
              key={`${item}-${index}`}
              className={index === finiteValues.length - 1 ? 'dd-stat-tile__bar--accent' : undefined}
              style={{ height: `${Math.max(10, (item / max) * 100)}%` }}
            />
          ))}
        </div>
      )}
      {caption != null && <p className="dd-stat-tile__caption">{caption}</p>}
    </SurfaceCard>
  );
}

export interface PlaylistCardItem {
  id: string | number;
  title: string;
  artist?: string;
  meta?: ReactNode;
}

export interface PlaylistCardProps {
  title: string;
  subtitle?: string;
  metadata?: ReactNode;
  artwork?: ReactNode;
  items: PlaylistCardItem[];
  actionLabel: string;
  onAction: () => void;
  className?: string;
}

export function PlaylistCard({
  title,
  subtitle,
  metadata,
  artwork,
  items,
  actionLabel,
  onAction,
  className,
}: PlaylistCardProps) {
  return (
    <SurfaceCard className={cn('dd-playlist-card', className)}>
      <div className="dd-playlist-card__body">
        <div className={cn('dd-playlist-card__heading', artwork && 'dd-playlist-card__heading--with-artwork')}>
          {artwork != null && <div className="dd-playlist-card__artwork">{artwork}</div>}
          <div className="dd-playlist-card__title-wrap">
            <strong className="dd-playlist-card__title" title={title}>{title}</strong>
            {subtitle && <span className="dd-playlist-card__subtitle" title={subtitle}>{subtitle}</span>}
          </div>
          {metadata != null && <div className="dd-playlist-card__metadata">{metadata}</div>}
        </div>
        <div className="dd-playlist-card__items">
          {items.map((item, index) => (
            <div className="dd-playlist-card__item" key={item.id}>
              <span className="dd-playlist-card__index">{index + 1}</span>
              <span className="dd-playlist-card__copy">
                <strong title={item.title}>{item.title}</strong>
                {item.artist && <small title={item.artist}>{item.artist}</small>}
              </span>
              {item.meta != null && <span className="dd-playlist-card__item-meta">{item.meta}</span>}
            </div>
          ))}
        </div>
      </div>
      <button
        type="button"
        className="dd-playlist-card__action"
        onClick={onAction}
        aria-label={actionLabel}
      >
        <span>{actionLabel}</span>
        <span aria-hidden="true">›</span>
      </button>
    </SurfaceCard>
  );
}

export type ArtworkAspect = 'square' | 'video' | 'portrait';
export type ArtworkFit = 'cover' | 'contain';

export interface ArtworkProps {
  src?: string | null;
  alt: string;
  aspect?: ArtworkAspect;
  fit?: ArtworkFit;
  fallbackTitle?: string;
  fallbackDescription?: string;
  fallbackIcon?: ReactNode;
  overlay?: ReactNode;
  className?: string;
  imageClassName?: string;
}

export function Artwork({
  src,
  alt,
  aspect = 'square',
  fit = 'cover',
  fallbackTitle,
  fallbackDescription,
  fallbackIcon,
  overlay,
  className,
  imageClassName,
}: ArtworkProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  const canRenderImage = Boolean(src) && !failed;

  return (
    <div
      className={cn('dd-artwork', `dd-artwork--${aspect}`, className)}
      data-artwork-state={canRenderImage ? 'image' : 'fallback'}
    >
      {canRenderImage ? (
        <img
          src={src ?? undefined}
          alt={alt}
          className={cn('dd-artwork__image', `dd-artwork__image--${fit}`, imageClassName)}
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="dd-artwork__fallback" role="img" aria-label={alt}>
          <span className="dd-artwork__fallback-icon" aria-hidden="true">
            {fallbackIcon ?? <MusicAdd size={30} />}
          </span>
          {fallbackTitle && <strong>{fallbackTitle}</strong>}
          {fallbackDescription && <small>{fallbackDescription}</small>}
        </div>
      )}
      {overlay != null && <div className="dd-artwork__overlay">{overlay}</div>}
    </div>
  );
}

export type AvatarSize = 'sm' | 'md' | 'lg';
export type AvatarRing = 'none' | 'blue' | 'spectrum';

export interface AvatarProps {
  src?: string | null;
  alt?: string;
  initials?: string;
  icon?: ReactNode;
  size?: AvatarSize;
  ring?: AvatarRing;
  className?: string;
}

export function Avatar({
  src,
  alt,
  initials,
  icon,
  size = 'md',
  ring = 'none',
  className,
}: AvatarProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  const canRenderImage = Boolean(src) && !failed;
  const fallbackLabel = alt || (initials ? `Avatar for ${initials}` : 'User avatar');

  return (
    <span
      className={cn('dd-avatar', `dd-avatar--${size}`, `dd-avatar--ring-${ring}`, className)}
      data-avatar-state={canRenderImage ? 'image' : initials ? 'initials' : 'icon'}
    >
      <span className="dd-avatar__inner">
        {canRenderImage ? (
          <img src={src ?? undefined} alt={alt ?? ''} onError={() => setFailed(true)} />
        ) : (
          <span className="dd-avatar__fallback" role="img" aria-label={fallbackLabel}>
            {initials
              ? <strong>{initials}</strong>
              : <span aria-hidden="true">{icon ?? <UserAvatar />}</span>}
          </span>
        )}
      </span>
    </span>
  );
}

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

export type DividerVariant = 'solid' | 'dotted' | 'dashed' | 'accent';

export function Divider({
  variant = 'solid',
  className,
}: {
  variant?: DividerVariant;
  className?: string;
}) {
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      className={cn('dd-divider', `dd-divider--${variant}`, className)}
    />
  );
}

export interface SidebarNavItemProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  label: string;
  icon: ReactNode;
  selected?: boolean;
  currentRoute?: boolean;
}

export function SidebarNavItem({
  label,
  icon,
  selected = false,
  currentRoute = false,
  className,
  type = 'button',
  ...props
}: SidebarNavItemProps) {
  return (
    <button
      type={type}
      aria-current={selected && currentRoute ? 'page' : undefined}
      aria-pressed={!currentRoute ? selected : undefined}
      data-selected={selected ? 'true' : 'false'}
      className={cn('dd-sidebar-nav-item', selected && 'dd-sidebar-nav-item--selected', className)}
      {...props}
    >
      <span className="dd-sidebar-nav-item__edge" aria-hidden="true" />
      <span className="dd-sidebar-nav-item__icon" aria-hidden="true">{icon}</span>
      <span className="dd-sidebar-nav-item__label">{label}</span>
    </button>
  );
}

export interface NavigationOption {
  id: string;
  label: string;
  icon?: ReactNode;
}

function getNextIndex(key: string, current: number, length: number): number | null {
  if (length <= 0) return null;
  if (key === 'ArrowRight' || key === 'ArrowDown') return (current + 1) % length;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (current - 1 + length) % length;
  if (key === 'Home') return 0;
  if (key === 'End') return length - 1;
  return null;
}

function focusPeer(event: KeyboardEvent<HTMLButtonElement>, selector: string, index: number) {
  const parent = event.currentTarget.parentElement;
  const peers = parent ? Array.from(parent.querySelectorAll<HTMLButtonElement>(selector)) : [];
  peers[index]?.focus();
}

export interface TabNavigationProps {
  value: string;
  options: NavigationOption[];
  onChange: (value: string) => void;
  variant?: 'primary' | 'filter';
  ariaLabel: string;
  className?: string;
}

export function TabNavigation({
  value,
  options,
  onChange,
  variant = 'primary',
  ariaLabel,
  className,
}: TabNavigationProps) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn('dd-tab-nav', `dd-tab-nav--${variant}`, className)}
    >
      {options.map((option, index) => {
        const selected = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className="dd-tab-nav__item"
            onClick={() => onChange(option.id)}
            onKeyDown={(event) => {
              const next = getNextIndex(event.key, index, options.length);
              if (next == null) return;
              event.preventDefault();
              onChange(options[next].id);
              focusPeer(event, '[role="tab"]', next);
            }}
          >
            {option.icon && <span aria-hidden="true">{option.icon}</span>}
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export interface ViewModeNavigationProps {
  value: string;
  options: NavigationOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  className?: string;
}

export function ViewModeNavigation({
  value,
  options,
  onChange,
  ariaLabel,
  className,
}: ViewModeNavigationProps) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn('dd-view-mode-nav', className)}
    >
      {options.map((option, index) => {
        const selected = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            className="dd-view-mode-nav__item"
            onClick={() => onChange(option.id)}
            onKeyDown={(event) => {
              const next = getNextIndex(event.key, index, options.length);
              if (next == null) return;
              event.preventDefault();
              onChange(options[next].id);
              focusPeer(event, '[role="radio"]', next);
            }}
          >
            <span className="dd-view-mode-nav__icon" aria-hidden="true">{option.icon}</span>
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
