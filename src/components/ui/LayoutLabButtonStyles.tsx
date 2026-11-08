import type { ReactNode } from 'react';
import { Upload, Usb } from 'iconoir-react/regular';
import { cn } from '../../lib/utils';
import { ControlButton } from './controls/ControlButton';
import './layout-lab-buttons.css';

interface Look { id: string; title: string; concept: string }

const PRIMARY_LOOKS: Look[] = [
  { id: 'p1', title: 'Ring', concept: 'A 1.5px coral ring with a soft glow and light capitals' },
  { id: 'p2', title: 'Filled Disc', concept: 'The coral of the Audition play button as a solid gradient, white light capitals' },
  { id: 'p3', title: 'Raised Plate (in use)', concept: 'The shared primary button with a lit rim, fine grain and a hairline coral ring' },
  { id: 'p4', title: 'Underline', concept: 'No box at all: coral capitals over a single coral rule, like a section underline' },
  { id: 'p5', title: 'Sunk Well', concept: 'A recessed well with an inner shadow, coral capitals and a coral edge on the left' },
];

const SECONDARY_LOOKS: Look[] = [
  { id: 's1', title: 'Gray Outline', concept: 'A quiet gray outline on a clear background' },
  { id: 's2', title: 'Raised Plate (in use)', concept: 'The shared secondary button with the same graphite face and a silver rim' },
  { id: 's3', title: 'Hairline Underline', concept: 'Gray capitals over a hairline rule that brightens on hover' },
  { id: 's4', title: 'Sunk Well', concept: 'A recessed well with an inner shadow and gray capitals' },
  { id: 's5', title: 'Icon Disc', concept: 'The icon in its own hairline disc beside plain gray capitals' },
];

const FILLED_DISC_LOOKS: Look[] = [
  { id: 'vertical-fade', title: 'Vertical Fade', concept: 'The gradient runs from a lighter top edge to a deeper fill at the base' },
  { id: 'reverse-sweep', title: 'Reverse Sweep', concept: 'The diagonal gradient flips so the brighter end sits behind the icon' },
  { id: 'satin-sheen', title: 'Satin Sheen', concept: 'A soft highlight washes over the upper half of the diagonal gradient' },
  { id: 'deep-gradient', title: 'Deep Gradient', concept: 'A deeper starting tone gives the bright end of the gradient more contrast' },
  { id: 'soft-capsule', title: 'Soft Capsule', concept: 'Fully rounded ends frame the reference’s diagonal gradient' },
];

function Card({ n, look, children }: { n: number; look: Look; children: ReactNode }) {
  return (
    <div className="lb-card" data-testid="button-look" data-look={look.id}>
      <div className="lb-card-head"><span className="lb-number">{n}</span><strong>{look.title}</strong></div>
      <p className="lb-concept">{look.concept}</p>
      <div className="lb-stage">{children}</div>
    </div>
  );
}

function PrimaryLook({ look }: { look: Look }) {
  const label = <><Upload width={13} height={13} aria-hidden="true" /> Import Library</>;
  return look.id === 'p3' ? (
    <>
      <ControlButton variant="primary">{label}</ControlButton>
      <ControlButton variant="primary" disabled>{label}</ControlButton>
    </>
  ) : (
    <>
      <button type="button" className={cn('lb-btn', `lb-${look.id}`)}>{label}</button>
      <button type="button" className={cn('lb-btn', `lb-${look.id}`)} disabled>{label}</button>
    </>
  );
}

function SecondaryLook({ look }: { look: Look }) {
  const icon = look.id === 's5' ? <span className="lb-disc"><Usb width={12} height={12} aria-hidden="true" /></span> : <Usb width={13} height={13} aria-hidden="true" />;
  const label = <>{icon} Choose USB</>;
  return look.id === 's2' ? (
    <>
      <ControlButton variant="secondary">{label}</ControlButton>
      <ControlButton variant="secondary" disabled>{label}</ControlButton>
    </>
  ) : (
    <>
      <button type="button" className={cn('lb-btn', `lb-${look.id}`)}>{label}</button>
      <button type="button" className={cn('lb-btn', `lb-${look.id}`)} disabled>{label}</button>
    </>
  );
}

const FILLED_DISC_ROWS = [
  { variant: 'primary', title: 'Primary buttons · Filled Disc studies', Preview: PrimaryLook },
  { variant: 'secondary', title: 'Secondary buttons · Filled Disc studies', Preview: SecondaryLook },
];

export function ButtonStylesRows() {
  return (
    <div className="lb-rows" data-testid="button-rows">
      <section className="lb-row" data-testid="primary-button-row" aria-label="Primary buttons">
        <div className="lb-row-head"><h3>Primary buttons</h3><span>Five looks. Each shows the button, then the same button disabled. Hover any of them.</span></div>
        <div className="lb-grid">{PRIMARY_LOOKS.map((look, i) => <Card key={look.id} n={i + 1} look={look}><PrimaryLook look={look} /></Card>)}</div>
      </section>
      <section className="lb-row" data-testid="secondary-button-row" aria-label="Secondary buttons">
        <div className="lb-row-head"><h3>Secondary buttons</h3><span>Five looks, in gray, to sit beside the primary. Each shows the button, then the same button disabled.</span></div>
        <div className="lb-grid">{SECONDARY_LOOKS.map((look, i) => <Card key={look.id} n={i + 1} look={look}><SecondaryLook look={look} /></Card>)}</div>
      </section>
      {FILLED_DISC_ROWS.map(({ variant, title, Preview }) => (
        <section
          key={variant}
          className={cn('lb-row lb-filled-disc-row', `lb-filled-disc-row--${variant}`)}
          data-testid={`${variant}-filled-disc-row`}
          aria-label={title}
        >
          <div className="lb-row-head">
            <h3>{title}</h3>
            <span>Five filled gradients, shown enabled and disabled.</span>
          </div>
          <div className="lb-grid">
            {FILLED_DISC_LOOKS.map((look, i) => (
              <Card key={look.id} n={i + 1} look={look}><Preview look={look} /></Card>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
