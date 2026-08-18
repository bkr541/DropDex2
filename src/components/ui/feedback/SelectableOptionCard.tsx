import type { ReactNode } from 'react';
import { Checkmark, Upload } from '@carbon/icons-react';
import { cn } from '../../../lib/utils';
import '../dropdex-feedback.css';
import { toneClass } from './tones';
import type { SemanticTone } from './types';

export function SelectableOptionCard({
  selected,
  title,
  description,
  meta,
  recommended,
  tone = 'active',
  icon,
  onSelect,
}: {
  selected: boolean;
  title: string;
  description?: string;
  meta?: string;
  recommended?: boolean;
  tone?: SemanticTone;
  icon?: ReactNode;
  onSelect: () => void;
}) {
  return (
    <button type="button" role="radio" aria-checked={selected} onClick={onSelect} className={cn('dd-selectable-card', selected && 'dd-selectable-card--selected', selected && toneClass[tone])}>
      <span className="dd-selectable-card__top">
        <span className={cn('dd-selectable-card__icon', toneClass[tone])}>{icon ?? <Upload size={22} />}</span>
        <span className="dd-selectable-card__radio">{selected && <Checkmark size={11} strokeWidth={3} />}</span>
      </span>
      <strong>{title}</strong>
      {description && <span>{description}</span>}
      {meta && <small>{meta}</small>}
      {recommended && <em>RECOMMENDED</em>}
    </button>
  );
}
