import type { ReactNode } from 'react';
import { Upload, Usb } from '@carbon/icons-react';
import { cn } from '../../lib/utils';
import { ControlButton } from './controls/ControlButton';
import './layout-lab-buttons.css';

// UI Components / Buttons: two rows of five looks. The first look in each row is the real component in use now; the other four are alternatives built
// from the same pieces as the rest of the graphite look: the coral ring of the profile icon, the raised nav recipe, recessed wells and hairlines.

interface Look { id: string; title: string; concept: string }

const PRIMARY_LOOKS: Look[] = [
  { id: 'p1', title: 'Ring (in use)', concept: 'The real primary button: a 1.5px coral ring with its soft glow, light capitals' },
  { id: 'p2', title: 'Filled Disc', concept: 'The coral of the Audition play button as a solid gradient, white light capitals' },
  { id: 'p3', title: 'Raised Plate', concept: 'The raised nav plate: lit rim, grain and three shadows, with a hairline coral ring' },
  { id: 'p4', title: 'Underline', concept: 'No box at all: coral capitals over a single coral rule, like a section underline' },
  { id: 'p5', title: 'Sunk Well', concept: 'A recessed well with an inner shadow, coral capitals and a coral edge on the left' },
];

const SECONDARY_LOOKS: Look[] = [
  { id: 's1', title: 'Gray Outline (in use)', concept: 'The real secondary button: a quiet gray outline on a clear background' },
  { id: 's2', title: 'Raised Plate', concept: 'The same raised plate as the primary, but gray: no coral anywhere' },
  { id: 's3', title: 'Hairline Underline', concept: 'Gray capitals over a hairline rule that brightens on hover' },
  { id: 's4', title: 'Sunk Well', concept: 'A recessed well with an inner shadow and gray capitals' },
  { id: 's5', title: 'Icon Disc', concept: 'The icon in its own hairline disc beside plain gray capitals' },
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
  const label = <><Upload size={13} /> Import Library</>;
  return look.id === 'p1' ? (
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
  const icon = look.id === 's5' ? <span className="lb-disc"><Usb size={12} /></span> : <Usb size={13} />;
  const label = <>{icon} Choose USB</>;
  return look.id === 's1' ? (
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
    </div>
  );
}
