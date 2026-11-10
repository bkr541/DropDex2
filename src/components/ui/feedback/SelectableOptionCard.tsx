import type { ReactNode } from 'react';
import { Check, Upload } from 'iconoir-react/regular';
import { cn } from '../../../lib/utils';
import '../dropdex-feedback.css';
import { toneClass } from './tones';
import type { SemanticTone } from './types';

/**
 * A choice drawn as a small card. With a `hero`, the card has a header area showing the choice itself (a colour, a swatch, a preview), and the
 * name and supporting text sit side by side underneath it, centred, with a | between them; without one it is the compact icon-and-text card.
 */
export function SelectableOptionCard({
  selected,
  title,
  description,
  meta,
  tone = 'active',
  icon,
  hero,
  heroBackground,
  horizontal = false,
  onSelect,
}: {
  selected: boolean;
  title: string;
  /** One short line. It never wraps. */
  description?: string;
  meta?: string;
  tone?: SemanticTone;
  icon?: ReactNode;
  /** The header area of the card. */
  hero?: ReactNode;
  /** A CSS background for the header area. */
  heroBackground?: string;
  /** With a hero: lay the card out as a row, a small swatch on the left and the name and text beside it. */
  horizontal?: boolean;
  onSelect: () => void;
}) {
  const radio = <span className="dd-selectable-card__radio">{selected && <Check aria-hidden="true" width={11} height={11} strokeWidth={3} />}</span>;
  return (
    <button type="button" role="radio" aria-checked={selected} onClick={onSelect}
      className={cn('dd-selectable-card', hero !== undefined && 'dd-selectable-card--hero', hero !== undefined && horizontal && 'dd-selectable-card--row', selected && 'dd-selectable-card--selected', selected && toneClass[tone])}>
      {hero !== undefined ? (
        <span className="dd-selectable-card__hero" style={heroBackground ? { background: heroBackground } : undefined}>
          {hero}
        </span>
      ) : (
        <span className="dd-selectable-card__top">
          <span className={cn('dd-selectable-card__icon', toneClass[tone])}>{icon ?? <Upload aria-hidden="true" width={22} height={22} />}</span>
          {radio}
        </span>
      )}
      {hero !== undefined ? (
        <span className="dd-selectable-card__label">
          <strong>{title}</strong>
          {description && <><i aria-hidden="true">|</i><span className="dd-selectable-card__description">{description}</span></>}
        </span>
      ) : (
        <>
          <strong>{title}</strong>
          {description && <span className="dd-selectable-card__description">{description}</span>}
          {meta && <small>{meta}</small>}
        </>
      )}
    </button>
  );
}
