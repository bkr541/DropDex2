import type { ReactNode } from 'react';
import { Database, NavArrowDown, NavArrowRight, Trash, Usb } from 'iconoir-react/regular';
import './layout-lab-nested-groups.css';

// Layout Lab / Nested Groups: six ways to show groups nested inside a parent group, using a USB records list's real content
// (the USB header, its counts, and its Export Library file). Pick one for production.

interface Stat { label: string; value: string }
const STATS: Stat[] = [
  { label: 'Tracks', value: '359' }, { label: 'Playlists', value: '3' },
  { label: 'Imported', value: 'Nov 9, 2026' }, { label: 'Import', value: '1' },
];
const FILE_STATS: Stat[] = [
  { label: 'Imported', value: 'Nov 9, 2026' }, { label: 'Tracks', value: '359' }, { label: 'Playlists', value: '3' },
];

const Pill = ({ tone, children }: { tone: 'teal' | 'green' | 'amber'; children: ReactNode }) => <span className={`ng-pill ng-pill--${tone}`}>{children}</span>;

function Pairs({ stats }: { stats: Stat[] }) {
  return <dl className="ng-pairs">{stats.map((s) => <div key={s.label}><dt>{s.label}</dt><dd>{s.value}</dd></div>)}</dl>;
}
function Figures({ stats }: { stats: Stat[] }) {
  return <dl className="ng-figures">{stats.map((s) => <div key={s.label}><dd>{s.value}</dd><dt>{s.label}</dt></div>)}</dl>;
}

interface Variant { id: number; name: string; note: string; stats: 'pairs' | 'figures' }
const VARIANTS: Variant[] = [
  { id: 1, name: 'Hairline Boxes', note: 'Outlined nested groups, label and value pairs, no row rules.', stats: 'pairs' },
  { id: 2, name: 'Tonal Fills', note: 'No borders: nested groups are a slightly darker fill, counts as light figures.', stats: 'figures' },
  { id: 3, name: 'Ruled Sections', note: 'No boxes: sections divided by hairlines, with a label column on the left.', stats: 'pairs' },
  { id: 4, name: 'Accent Rail', note: 'A thin rail on the left edge of each nested group, indented under the header.', stats: 'pairs' },
  { id: 5, name: 'Raised Plates', note: 'Parent is an inset tray; nested groups are raised plates like the buttons, counts as figures.', stats: 'figures' },
  { id: 6, name: 'Legend Frames', note: 'Nested groups are frames with their label cut into the top border.', stats: 'pairs' },
];

interface Usb { name: string; pills: { tone: 'teal' | 'green' | 'amber'; text: string }[]; open: boolean; counts: Stat[]; file: { pills: { tone: 'teal' | 'green' | 'amber'; text: string }[]; stats: Stat[] } }
const USBS: Usb[] = [
  { name: 'REVERIE', open: true, pills: [{ tone: 'teal', text: 'Active Library' }, { tone: 'teal', text: 'Connected Now' }], counts: STATS,
    file: { pills: [{ tone: 'green', text: 'Active' }, { tone: 'amber', text: 'Completed With Warnings' }], stats: FILE_STATS } },
  { name: 'LUMA', open: true, pills: [], counts: [{ label: 'Tracks', value: '1,204' }, { label: 'Playlists', value: '12' }, { label: 'Imported', value: 'Oct 21, 2026' }, { label: 'Import', value: '2' }],
    file: { pills: [{ tone: 'green', text: 'Completed' }], stats: [{ label: 'Imported', value: 'Oct 21, 2026' }, { label: 'Tracks', value: '1,204' }, { label: 'Playlists', value: '12' }] } },
  { name: 'STAGE SET', open: false, pills: [], counts: [], file: { pills: [], stats: [] } },
];

function UsbRecord({ usb, v }: { usb: Usb; v: Variant }) {
  const Stats = v.stats === 'figures' ? Figures : Pairs;
  const Body = (
    <>
      <section className="ng-group ng-group--counts">
        <span className="ng-label">Library</span>
        <Stats stats={usb.counts} />
      </section>
      <section className="ng-group ng-group--export">
        <header className="ng-group__head"><span className="ng-label">Export Library</span><NavArrowDown width={14} height={14} aria-hidden="true" /></header>
        <div className="ng-file">
          <Database className="ng-file__icon" width={14} height={14} aria-hidden="true" /><strong>exportLibrary.db</strong>{usb.file.pills.map((p) => <Pill key={p.text} tone={p.tone}>{p.text}</Pill>)}
          <button type="button" className="ng-trash" aria-label="Delete"><Trash width={14} height={14} aria-hidden="true" /></button>
        </div>
        <Stats stats={usb.file.stats} />
      </section>
    </>
  );
  return (
    <article className="ng-rec">
      <header className="ng-record">
        <Usb width={16} height={16} aria-hidden="true" />
        <strong>{usb.name}</strong>{usb.pills.map((p) => <Pill key={p.text} tone={p.tone}>{p.text}</Pill>)}
        {usb.open ? <NavArrowDown className="ng-chevron" width={14} height={14} aria-hidden="true" /> : <NavArrowRight className="ng-chevron" width={14} height={14} aria-hidden="true" />}
      </header>
      {usb.open && (v.id === 3 ? <div className="ng-sections">{Body}</div> : <div className="ng-rec__body">{Body}</div>)}
    </article>
  );
}

function Record({ v }: { v: Variant }) {
  return (
    <div className="studio-surface ng-parent" data-variant={v.id}>
      <header className="ng-parent__head"><Usb width={14} height={14} aria-hidden="true" /><span className="ng-label">USBs</span></header>
      <div className="ng-records">{USBS.map((u) => <UsbRecord key={u.name} usb={u} v={v} />)}</div>
    </div>
  );
}

export function NestedGroupMockupsContent() {
  return (
    <div className="ng-lab" data-testid="nested-group-mockups">
      <div className="ng-intro">
        <span>Layout Lab / Nested Groups</span>
        <h1>Six ways to nest groups in a list of USB records</h1>
        <p>Same content in each: three USB records (two open, one closed), each with its counts and Export Library file. Tell me which number to use for production.</p>
      </div>
      <div className="ng-grid">
        {VARIANTS.map((v) => (
          <div key={v.id}>
            <p className="ng-caption"><b>{String(v.id).padStart(2, '0')}</b> {v.name}<small>{v.note}</small></p>
            <Record v={v} />
          </div>
        ))}
      </div>
    </div>
  );
}
