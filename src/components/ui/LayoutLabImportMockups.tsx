import type { ReactNode } from 'react';
import { ArrowRight, CheckCircle, Database, Folder, Pause, Refresh, WarningTriangle, Xmark } from 'iconoir-react/regular';
import { ControlButton } from './controls/ControlButton';
import { ImportProgressModal, type ImportUiStep } from '../ImportProgressModal';
import '../profile/profile.css';

// Layout Lab / Import: every screen of the Rekordbox import popover, built on the real popover shell and the shared import-group,
// import-heading and import-status-icon styles, with fixed sample data. Nothing here talks to the import itself.

const noop = () => {};
const warning = (
  <div className="import-group import-group--amber flex items-center gap-3 text-left">
    <WarningTriangle width={16} height={16} aria-hidden="true" className="shrink-0 text-amber-400" />
    <p className="whitespace-nowrap text-[11px] leading-snug text-amber-100">Keep Rekordbox closed. Do not eject the drive until DropDex confirms.</p>
  </div>
);

function Row({ label, value, tone }: { label: string; value: ReactNode; tone?: 'amber' }) {
  return (
    <div className="mt-2 flex justify-between gap-4 first:mt-0">
      <span className="text-muted-foreground">{label}</span>
      <span className={tone === 'amber' ? 'font-semibold text-amber-400' : 'font-semibold text-foreground'}>{value}</span>
    </div>
  );
}

function Choices({ active, ready }: { active: number; ready: boolean }) {
  const items = ['USB Folder', 'ZIP Bundle', 'Database Only'];
  return (
    <div className={`mb-4 flex gap-1.5 rounded-xl border border-[var(--color-border-subtle)] p-1 ${ready ? 'bg-green-500/10' : 'bg-[var(--color-surface)]'}`}>
      {items.map((label, i) => (
        <span key={label} className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold ${i === active ? (ready ? 'bg-green-500 text-white shadow-sm' : 'bg-[var(--color-control-primary)] text-white shadow-sm') : 'text-muted-foreground'}`}>
          {i === 0 ? <Folder width={14} height={14} aria-hidden="true" /> : <Database width={14} height={14} aria-hidden="true" />}{label}
        </span>
      ))}
    </div>
  );
}

function Footer({ children }: { children: ReactNode }) {
  return <div className="mt-auto flex justify-center gap-3 pt-4">{children}</div>;
}

function Bar({ pct }: { pct: number }) {
  return (
    <div className="shrink-0">
      <div className="mb-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-surface)]"><div className="h-full rounded-full bg-green-500" style={{ width: `${pct}%` }} /></div>
      <p className="text-center text-sm text-muted-foreground">{pct}%</p>
    </div>
  );
}

function Hero({ title, spinner = true }: { title: string; spinner?: boolean }) {
  return (
    <div className="import-group import-group--green shrink-0 text-center">
      <div className="import-status-icon">
        {spinner ? <Refresh className="animate-spin text-green-500" width={24} height={24} aria-hidden="true" /> : <CheckCircle className="text-green-500" width={24} height={24} aria-hidden="true" />}
      </div>
      <h2 className="import-heading">{title}</h2>
    </div>
  );
}

const Body = ({ children }: { children: ReactNode }) => <div className="flex h-full flex-col">{children}</div>;
const Center = ({ children }: { children: ReactNode }) => <div className="flex h-full flex-col text-center">{children}</div>;

interface Screen { name: string; step: ImportUiStep; pct: number; ready?: boolean; status?: 'failed'; body: ReactNode }

const SCREENS: Screen[] = [
  { name: 'Source: nothing chosen', step: 'source', pct: 0, body: (
    <Body>
      <Choices active={0} ready={false} />
      <p className="mb-3 text-sm leading-relaxed text-muted-foreground">Select your USB drive root (e.g. &quot;My USB&quot;). DropDex will find exportLibrary.db automatically. Your music files are not uploaded.</p>
      <div className="mb-4 flex flex-1 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[var(--color-border-subtle)] px-4 text-muted-foreground">
        <Folder width={20} height={20} aria-hidden="true" /><p className="text-sm">Click to select USB drive folder</p>
      </div>
      <Footer><ControlButton variant="secondary"><Xmark width={16} height={16} aria-hidden="true" /> Cancel</ControlButton><ControlButton variant="primary" disabled>Import</ControlButton></Footer>
    </Body>) },
  { name: 'Source: folder chosen', step: 'source', pct: 0, ready: true, body: (
    <Body>
      <Choices active={0} ready />
      <p className="mb-3 text-sm leading-relaxed text-muted-foreground">Select your USB drive root (e.g. &quot;My USB&quot;). DropDex will find exportLibrary.db automatically. Your music files are not uploaded.</p>
      <div className="import-group import-group--green flex-1 text-left">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">My USB</p>
        <div className="flex items-center gap-2 text-sm"><CheckCircle width={14} height={14} aria-hidden="true" className="shrink-0 text-green-500" /><span className="truncate font-mono text-xs">exportLibrary.db</span><span className="ml-auto text-xs text-muted-foreground">4.2 MB</span></div>
      </div>
      <Footer><ControlButton variant="secondary"><Xmark width={16} height={16} aria-hidden="true" /> Cancel</ControlButton><ControlButton variant="primary">Import</ControlButton></Footer>
    </Body>) },
  { name: 'Database upload', step: 'database', pct: 25, ready: true, body: (
    <Body>
      <Hero title="Uploading Rekordbox Database…" />
      {warning}
      <div className="import-group import-stats text-left text-xs"><Row label="Stage" value="Uploading database" /></div>
      <Footer><ControlButton variant="secondary"><Xmark width={16} height={16} aria-hidden="true" /> Cancel import</ControlButton></Footer>
    </Body>) },
  { name: 'Analysis files upload', step: 'analysis-files', pct: 57, ready: true, body: (
    <Body>
      <Hero title="Uploading Analysis Files…" />
      {warning}
      <div className="import-group import-stats text-left text-xs"><Row label="Stage" value="Uploading analysis files" /><Row label="Files accepted" value="1,204 / 2,100" /><Row label="Data uploaded" value="318 MB / 560 MB" /><Row label="Retrying" value="3" tone="amber" /></div>
      <Bar pct={57} />
      <Footer><ControlButton variant="secondary"><Xmark width={16} height={16} aria-hidden="true" /> Cancel import</ControlButton><ControlButton variant="primary"><ArrowRight width={16} height={16} aria-hidden="true" /> Browse in Background</ControlButton></Footer>
    </Body>) },
  { name: 'USB released', step: 'analysis-files', pct: 70, ready: true, body: (
    <Center>
      <Hero title="USB Access Released" spinner={false} />
      <p className="text-sm text-muted-foreground">USB reading is complete. DropDex is continuing from uploaded copies and no longer needs the USB.</p>
    </Center>) },
  { name: 'Stopping import', step: 'analysis-files', pct: 60, ready: true, body: (
    <Body>
      <Hero title="Stopping USB Reads…" />
      {warning}
      <div className="import-group space-y-2 text-left">
        {[['Stopping local USB reads', 'active'], ['USB access released', 'todo'], ['Stopping cloud analysis', 'todo']].map(([label, st]) => (
          <div key={label} className="flex items-center gap-3 text-xs">
            {st === 'active' ? <Refresh width={16} height={16} aria-hidden="true" className="shrink-0 animate-spin text-amber-400" /> : <span className="h-4 w-4 shrink-0 rounded-full border border-[var(--color-border-subtle)]" />}
            <span className="text-muted-foreground">{label}</span>
          </div>
        ))}
      </div>
    </Body>) },
  { name: 'Analysis running', step: 'analyze', pct: 77, ready: true, body: (
    <Center>
      <Hero title="Analysis Running" />
      <div className="import-group import-stats text-left text-xs"><Row label="Current stage" value="Analysis Processing" /><Row label="Tracks ready" value="32" /><Row label="Tracks remaining" value="327" /><Row label="Estimate" value="about 4 min" /><Row label="Raw DAT/EXT archive" value="Queued" /></div>
      <p className="text-xs uppercase tracking-widest text-muted-foreground">Processing</p>
      <p className="mb-3 mt-0.5 text-sm font-semibold leading-snug text-foreground">POP LOCK AND DROP IT - SIDEQUEST</p>
      <Bar pct={9} />
      <Footer><ControlButton variant="secondary"><Pause width={16} height={16} aria-hidden="true" /> Pause Import</ControlButton><ControlButton variant="primary"><ArrowRight width={16} height={16} aria-hidden="true" /> Continue in Background</ControlButton></Footer>
    </Center>) },
  { name: 'Analysis paused', step: 'analyze', pct: 77, ready: true, body: (
    <Center>
      <div className="import-group import-group--amber shrink-0"><div className="import-status-icon"><CheckCircle className="text-amber-300" width={24} height={24} aria-hidden="true" /></div><h2 className="import-heading">Analysis Paused Safely</h2></div>
      <div className="import-group import-group--green flex items-start gap-3 text-left"><CheckCircle width={16} height={16} aria-hidden="true" className="mt-0.5 shrink-0 text-green-500" /><p className="text-xs leading-relaxed text-emerald-100">Your progress is saved. You can pick up where you left off at any time from Import History.</p></div>
      <Footer><ControlButton variant="primary"><CheckCircle width={16} height={16} aria-hidden="true" /> Done</ControlButton></Footer>
    </Center>) },
  { name: 'Analysis interrupted', step: 'analyze', pct: 77, ready: true, body: (
    <Center>
      <div className="import-group import-group--amber shrink-0"><div className="import-status-icon"><WarningTriangle className="text-amber-400" width={24} height={24} aria-hidden="true" /></div><h2 className="import-heading">Analysis Interrupted</h2></div>
      <div className="import-group text-left"><p className="text-xs leading-relaxed text-muted-foreground">Background analysis stopped unexpectedly. Open Import History and choose Resume. Completed work will not be repeated.</p></div>
      <Footer><ControlButton variant="primary"><CheckCircle width={16} height={16} aria-hidden="true" /> Done</ControlButton></Footer>
    </Center>) },
  { name: 'Complete', step: 'complete', pct: 100, ready: true, body: (
    <Center>
      <Hero title="Library Imported with Analysis!" spinner={false} />
      <div className="import-group import-stats text-left text-xs"><Row label="Tracks" value="359" /><Row label="Analysed" value="359" /><Row label="Parser" value="v12" /></div>
      <Footer><ControlButton variant="primary"><CheckCircle width={16} height={16} aria-hidden="true" /> Done</ControlButton></Footer>
    </Center>) },
  { name: 'Failed', step: 'database', pct: 25, status: 'failed', body: (
    <Center>
      <div className="import-group shrink-0"><div className="import-status-icon"><WarningTriangle className="text-red-400" width={24} height={24} aria-hidden="true" /></div><h2 className="import-heading">Import Failed</h2></div>
      <p className="px-2 text-sm leading-relaxed text-muted-foreground">The database could not be saved. Check your connection and try again.</p>
      <Footer><ControlButton variant="secondary"><Xmark width={16} height={16} aria-hidden="true" /> Cancel</ControlButton><ControlButton variant="primary"><Refresh width={16} height={16} aria-hidden="true" /> Retry</ControlButton></Footer>
    </Center>) },
];

export function ImportMockupsContent() {
  return (
    <div className="h-full overflow-y-auto p-8" data-testid="import-mockups" style={{ background: '#111419' }}>
      <div className="mb-8 max-w-xl">
        <span className="text-[9px] font-medium uppercase tracking-[0.16em] text-[#9aa5b8]">Layout Lab / Import</span>
        <h1 className="mt-2 text-2xl font-light text-[#f6f7fa]">Every Rekordbox import screen</h1>
        <p className="mt-2 text-sm text-[#a4adbd]">Built on the real import popover and its shared group, heading and icon styles, with sample data. Tell me what to change before it goes to production.</p>
      </div>
      <div className="flex flex-wrap gap-10">
        {SCREENS.map((s, i) => (
          <div key={s.name}>
            <p className="mb-3 text-xs text-[#a4adbd]"><span className="mr-2 text-[#f6f7fa]">{String(i + 1).padStart(2, '0')}</span>{s.name}</p>
            <div className="relative" style={{ width: 624 }}>
              <ImportProgressModal currentStep={s.step} stagePercent={s.pct} status={s.status} ready={s.ready} onClose={noop}>{s.body}</ImportProgressModal>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
