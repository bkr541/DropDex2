import { NavArrowLeft, NavArrowRight } from 'iconoir-react/regular';
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
        <NavArrowLeft aria-hidden="true" width={18} height={18} />
      </button>
      {items.map((item, index) => (
        <span key={`${item}-${index}`} className="dd-breadcrumb__part">
          {index > 0 && <NavArrowRight width={13} height={13} aria-hidden="true" />}
          <span aria-current={index === items.length - 1 ? 'page' : undefined}>{item}</span>
        </span>
      ))}
    </nav>
  );
}
