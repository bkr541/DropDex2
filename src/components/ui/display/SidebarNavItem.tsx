import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../../../lib/utils';
import '../dropdex-display.css';

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
