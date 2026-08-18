import type { KeyboardEvent } from 'react';

export function getNextNavigationIndex(key: string, current: number, length: number): number | null {
  if (length <= 0) return null;
  if (key === 'ArrowRight' || key === 'ArrowDown') return (current + 1) % length;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (current - 1 + length) % length;
  if (key === 'Home') return 0;
  if (key === 'End') return length - 1;
  return null;
}

export function focusNavigationPeer(
  event: KeyboardEvent<HTMLButtonElement>,
  selector: string,
  index: number,
) {
  const parent = event.currentTarget.parentElement;
  const peers = parent ? Array.from(parent.querySelectorAll<HTMLButtonElement>(selector)) : [];
  peers[index]?.focus();
}
