import { ChevronLeft, ChevronRight } from '@carbon/icons-react';
import '../dropdex-controls.css';

export function BreadcrumbControl({
  items,
  onBack,
}: {
  items: string[];
  onBack?: () => void;
}) {
  return (
    <nav className="dd-breadcrumb" aria-label="Breadcrumb">
      <button type="button" onClick={onBack} aria-label="Go back" className="dd-breadcrumb__back">
        <ChevronLeft size={18} />
      </button>
      {items.map((item, index) => (
        <span key={`${item}-${index}`} className="dd-breadcrumb__part">
          {index > 0 && <ChevronRight size={13} aria-hidden="true" />}
          <span aria-current={index === items.length - 1 ? 'page' : undefined}>{item}</span>
        </span>
      ))}
    </nav>
  );
}
