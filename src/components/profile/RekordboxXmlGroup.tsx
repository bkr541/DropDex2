import { ProfileSwitch } from './ProfileSwitch';
import { SurfaceCard } from '../ui/display/SurfaceCard';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, CloudUpload, Download, Eye, Folder, Page, PagePlus, Refresh, Trash } from 'iconoir-react/regular';
import { useRekordboxXmlFiles } from '../../hooks/useRekordboxXmlFiles';
import { logger } from '../../lib/logger';
import { readRekordboxXml, type RekordboxXmlRecord } from '../../lib/queries/rekordboxXml';
import { parseRekordboxXmlCollection, type XmlCollectionTrack } from '../../lib/rekordboxXml/xmlCollection';
import { RekordboxXmlViewer } from './RekordboxXmlViewer';
import { checkRekordboxXmlFile, type RekordboxXmlHeader } from '../../lib/rekordboxXml/xmlHeader';
import { formatBytes } from '../../lib/usb/usbFormat';
import { cn } from '../../lib/utils';
import { ControlButton, FormField, TextControl } from '../ui/controls';
import { NoticeCard, StatusLoader } from '../ui/feedback';
import { ToolbarIconButton, ToolbarIconGroup } from '../ui/controls/ToolbarIconButton';

const STORAGE_KEY = 'dropdex:rekordbox:xml-sync-enabled';

function readEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeEnabled(value: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
  } catch { /* the switch still works for this visit */ }
}

const formatDate = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString(undefined, { dateStyle: 'medium' });
};

interface ChosenFile {
  file: File;
  /** The full location on this computer (desktop app only); otherwise just the name. */
  location: string;
  header: RekordboxXmlHeader | null;
  problem: string | null;
}

function SavedFileRow({ record, onRemove, onDownload, onView }: { record: RekordboxXmlRecord; onRemove: (record: RekordboxXmlRecord) => Promise<boolean>; onDownload: (record: RekordboxXmlRecord) => Promise<void>; onView: (record: RekordboxXmlRecord) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const remove = async () => {
    setBusy(true);
    setFailed(null);
    const ok = await onRemove(record);
    if (!ok) { setFailed("The file couldn't be removed. Try again."); setBusy(false); setConfirming(false); }
  };

  const details = [
    formatBytes(record.sizeBytes),
    record.trackCount != null ? `${record.trackCount.toLocaleString()} tracks` : null,
    record.rekordboxVersion ? `Rekordbox ${record.rekordboxVersion}` : null,
    `Saved ${formatDate(record.createdAt)}`,
  ].filter(Boolean).join(' · ');

  return (
    <li className="profile-record flex flex-wrap items-center justify-between gap-3" data-testid="rekordbox-xml-row">
      <div className="flex min-w-0 items-center gap-3">
        <Page width={20} height={20} aria-hidden="true" className="shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="truncate text-xs font-medium" title={record.fileName}>{record.fileName}</p>
          <p className="text-[11px] text-muted-foreground">{details}</p>
          {failed && <p className="mt-0.5 text-[11px] text-red-400" role="alert">{failed}</p>}
        </div>
      </div>
      {confirming ? (
        <div className="flex items-center gap-2" role="group" aria-label={`Remove ${record.fileName}`}>
          <span className="text-xs text-muted-foreground">Remove this saved copy?</span>
          <ControlButton variant="danger" onClick={() => void remove()} disabled={busy}>
            {busy ? <Refresh className="animate-spin" width={14} height={14} aria-hidden="true" /> : <Trash width={14} height={14} aria-hidden="true" />} Remove
          </ControlButton>
          <ControlButton variant="secondary" onClick={() => setConfirming(false)} disabled={busy}>Keep</ControlButton>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <ControlButton variant="secondary" onClick={() => onView(record)}><Eye width={14} height={14} aria-hidden="true" /> View tracks</ControlButton>
          <ControlButton variant="secondary" onClick={() => void onDownload(record)}><Download width={14} height={14} aria-hidden="true" /> Download</ControlButton>
          <ControlButton variant="secondary" onClick={() => setConfirming(true)} aria-label={`Remove ${record.fileName}`}><Trash width={14} height={14} aria-hidden="true" /></ControlButton>
        </div>
      )}
    </li>
  );
}

/**
 * Profile Rekordbox tab. Local viewing and saved snapshots stay available independently of the cloud-saving switch.
 */
export function RekordboxXmlGroup({ userId }: { userId: string | null }) {
  const [enabled, setEnabled] = useState(readEnabled);
  const [chosen, setChosen] = useState<ChosenFile | null>(null);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const xml = useRekordboxXmlFiles(userId, true);
  const [view, setView] = useState<{ name: string; tracks: XmlCollectionTrack[] } | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const request = useRef(0);
  useEffect(() => () => { request.current += 1; }, []);
  const closeViewer = () => { request.current += 1; setView(null); setOpening(null); };
  const openXml = async (name: string, read: () => Promise<string>) => {
    const sequence = ++request.current;
    setOpening(name);
    setView(null);
    setMessage(null);
    try {
      const text = await read();
      if (request.current !== sequence) return;
      setView({ name, tracks: parseRekordboxXmlCollection(text) });
    } catch (error) {
      if (request.current === sequence) setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'The XML file could not be read. Try again.' });
    } finally {
      if (request.current === sequence) setOpening(null);
    }
  };


  const desktop = typeof window !== 'undefined' ? window.dropdexDesktop ?? null : null;

  const toggle = () => {
    const next = !enabled;
    setEnabled(next);
    writeEnabled(next);
    if (!next) setMessage(null);
  };

  const onFileChosen = async (file: File | undefined) => {
    setMessage(null);
    if (!file) return;
    const check = await checkRekordboxXmlFile(file);
    if ('problem' in check) logger.warn('rekordbox.xml.rejected', { fileName: file.name, sizeBytes: file.size });
    setChosen({
      file,
      location: desktop?.getPathForFile(file) || file.name,
      header: 'header' in check ? check.header : null,
      problem: 'problem' in check ? check.problem : null,
    });
  };

  const save = async () => {
    if (!enabled || !chosen?.header) return;
    setMessage(null);
    const problem = await xml.save(chosen.file, chosen.header);
    if (problem) {
      setMessage({ kind: 'error', text: problem });
      return;
    }
    setMessage({ kind: 'success', text: `Saved ${chosen.file.name} to DropDex.` });
    setChosen(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const download = async (record: RekordboxXmlRecord) => {
    const url = await xml.downloadUrl(record);
    if (!url) { setMessage({ kind: 'error', text: "The download link couldn't be made. Try again." }); return; }
    const link = document.createElement('a');
    link.href = url;
    link.download = record.fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  if (view || opening) return <section className="profile-group" aria-label="Rekordbox XML viewer">
    <ControlButton variant="ghost" onClick={closeViewer}><ArrowLeft width={16} height={16} aria-hidden="true" /> Back to saved XML files</ControlButton>
    <h2 className="profile-heading">Rekordbox Collection XML</h2>
    <p className="break-words text-xs text-muted-foreground">{view?.name ?? opening}</p>
    {view ? <RekordboxXmlViewer tracks={view.tracks} /> : <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground"><StatusLoader label="Reading XML Collection" /> Reading collection…</div>}
  </section>;

  const sameAsSaved = chosen?.header ? xml.files.some((record) => record.fileName === chosen.file.name && record.sizeBytes === chosen.file.size) : false;

  return (
    <section className="profile-group" data-testid="rekordbox-xml-group">
      <h2 className="profile-heading"><Page width={11} height={11} aria-hidden="true" />Rekordbox</h2>
      <SurfaceCard as="div" className="profile-records divide-y divide-[var(--color-border-faint)]">
        <div className="profile-record flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p id="rekordbox-xml-label" className="text-xs font-medium">Sync Rekordbox XML</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Keep a copy of your Rekordbox XML export in your own private DropDex cloud folder. You can save more than one, for example one for each USB or each time you export.
            </p>
          </div>
          <ProfileSwitch
            checked={enabled}
            aria-labelledby="rekordbox-xml-label"
            data-testid="rekordbox-xml-toggle"
            onClick={toggle}
            disabled={xml.saving}
          />
        </div>

        <div className="space-y-3 p-4" data-testid="rekordbox-xml-panel">
          <div>
            <p className="mb-3 text-xs text-muted-foreground">Browse a Collection XML file or view a saved copy to inspect your tracks. No USB or cloud sync is required to view a local file.</p>
            <FormField label="Rekordbox XML file" error={chosen?.problem ?? undefined}>
              {({ id, describedBy, invalid }) => <div className="flex min-w-0 items-center gap-2">
                <TextControl
                  id={id}
                  icon={<Page width={16} height={16} aria-hidden="true" />}
                  readOnly
                  value={chosen?.location ?? ''}
                  placeholder="No file chosen"
                  title={chosen?.location}
                  aria-describedby={describedBy}
                  aria-invalid={invalid || undefined}
                  data-testid="rekordbox-xml-path"
                  containerClassName="min-w-0 flex-1"
                />
                <div className="cue-studio">
                  <ToolbarIconGroup>
                    <ToolbarIconButton label="Browse Rekordbox XML file" onClick={() => inputRef.current?.click()} disabled={xml.saving}>
                      <Folder width={16} height={16} aria-hidden="true" />
                    </ToolbarIconButton>
                  </ToolbarIconGroup>
                </div>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".xml,text/xml,application/xml"
                  className="hidden"
                  data-testid="rekordbox-xml-input"
                  onChange={(event) => { void onFileChosen(event.target.files?.[0]); }}
                />
              </div>}
            </FormField>
            {chosen?.header && (
              <p className="mt-1.5 text-[11px] text-muted-foreground" data-testid="rekordbox-xml-summary">
                {[formatBytes(chosen.file.size), chosen.header.trackCount != null ? `${chosen.header.trackCount.toLocaleString()} tracks` : null, chosen.header.rekordboxVersion ? `Rekordbox ${chosen.header.rekordboxVersion}` : null].filter(Boolean).join(' · ')}
              </p>
            )}
            {sameAsSaved && <p className="mt-1.5 text-[11px] text-muted-foreground">You already saved a file with this name and size. Saving it again keeps both copies.</p>}
            {chosen && !desktop && <p className="mt-1.5 text-[11px] text-muted-foreground">Your browser only shares the file&apos;s name. The desktop app shows its full location.</p>}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <ControlButton variant="secondary" disabled={!chosen?.header} onClick={() => { if (chosen?.header) void openXml(chosen.file.name, () => chosen.file.text()); }}>
              <Eye width={14} height={14} aria-hidden="true" /> View tracks
            </ControlButton>
            <ControlButton variant="primary" onClick={() => void save()} disabled={!enabled || !chosen?.header || xml.saving} title={!enabled ? 'Enable Sync Rekordbox XML to save a cloud copy' : undefined} data-testid="rekordbox-xml-save">
              {xml.saving ? <Refresh className="animate-spin" width={14} height={14} aria-hidden="true" /> : <CloudUpload width={14} height={14} aria-hidden="true" />} {xml.saving ? 'Saving…' : 'Save to DropDex'}
            </ControlButton>
            {message && (
              <p className={cn('text-xs', message.kind === 'error' ? 'text-red-400' : 'text-emerald-400')} role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</p>
            )}
          </div>
        </div>

        <div data-testid="rekordbox-xml-saved">
          <p className="profile-record-heading flex items-center gap-1.5"><PagePlus width={11} height={11} aria-hidden="true" />Saved copies{xml.files.length > 0 ? ` · ${xml.files.length}` : ''}</p>
          {xml.loading && xml.files.length === 0 ? (
            <div className="flex items-center gap-3 px-4 py-4 text-xs text-muted-foreground">
              <StatusLoader label="Loading saved XML files" /> Loading your saved files…
            </div>
          ) : xml.loadFailed ? (
            <div className="p-4">
              <NoticeCard tone="error" action={<ControlButton variant="secondary" onClick={xml.reload}>Try again</ControlButton>}>
                Your saved files couldn&apos;t be loaded.
              </NoticeCard>
            </div>
          ) : xml.files.length === 0 ? (
            <p className="px-4 py-4 text-xs text-muted-foreground" data-testid="rekordbox-xml-empty">No saved copies yet. Browse a local XML file above to view its tracks, or enable sync to save a cloud copy.</p>
          ) : (
            <ul className="divide-y divide-[var(--color-border-faint)]">
              {xml.files.map((record) => <SavedFileRow key={record.id} record={record} onRemove={xml.remove} onDownload={download} onView={(saved) => { void openXml(saved.fileName, () => readRekordboxXml(saved)); }} />)}
            </ul>
          )}
        </div>
      </SurfaceCard>
    </section>
  );
}
