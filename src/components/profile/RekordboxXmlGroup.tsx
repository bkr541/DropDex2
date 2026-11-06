import { useRef, useState } from 'react';
import { CircleDash, CloudUpload, Document, DocumentAdd, Download, FolderOpen, TrashCan, WarningAlt } from '@carbon/icons-react';
import { useRekordboxXmlFiles } from '../../hooks/useRekordboxXmlFiles';
import { logger } from '../../lib/logger';
import type { RekordboxXmlRecord } from '../../lib/queries/rekordboxXml';
import { checkRekordboxXmlFile, type RekordboxXmlHeader } from '../../lib/rekordboxXml/xmlHeader';
import { formatBytes } from '../../lib/usb/usbFormat';
import { cn } from '../../lib/utils';
import { ControlButton } from '../ui/controls';

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

function SavedFileRow({ record, onRemove, onDownload }: { record: RekordboxXmlRecord; onRemove: (record: RekordboxXmlRecord) => Promise<boolean>; onDownload: (record: RekordboxXmlRecord) => Promise<void> }) {
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
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" data-testid="rekordbox-xml-row">
      <div className="flex min-w-0 items-center gap-3">
        <Document size={20} className="shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="truncate text-sm font-bold" title={record.fileName}>{record.fileName}</p>
          <p className="text-[11px] text-muted-foreground">{details}</p>
          {failed && <p className="mt-0.5 text-[11px] text-red-400" role="alert">{failed}</p>}
        </div>
      </div>
      {confirming ? (
        <div className="flex items-center gap-2" role="group" aria-label={`Remove ${record.fileName}`}>
          <span className="text-xs text-muted-foreground">Remove this saved copy?</span>
          <ControlButton variant="danger" onClick={() => void remove()} disabled={busy}>
            {busy ? <CircleDash className="animate-spin" size={14} /> : <TrashCan size={14} />} Remove
          </ControlButton>
          <ControlButton variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>Keep</ControlButton>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <ControlButton variant="neutral" onClick={() => void onDownload(record)}><Download size={14} /> Download</ControlButton>
          <ControlButton variant="ghost" onClick={() => setConfirming(true)} aria-label={`Remove ${record.fileName}`}><TrashCan size={14} /></ControlButton>
        </div>
      )}
    </li>
  );
}

/**
 * Library tab: Rekordbox. One switch turns on Rekordbox XML saving. With it on, the user chooses a Rekordbox.xml file on this
 * computer and saves a copy of it to their own private DropDex cloud folder. They can save as many as they like.
 */
export function RekordboxXmlGroup({ userId }: { userId: string | null }) {
  const [enabled, setEnabled] = useState(readEnabled);
  const [chosen, setChosen] = useState<ChosenFile | null>(null);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const xml = useRekordboxXmlFiles(userId, enabled);

  const desktop = typeof window !== 'undefined' ? window.dropdexDesktop ?? null : null;

  const toggle = () => {
    const next = !enabled;
    setEnabled(next);
    writeEnabled(next);
    if (!next) { setChosen(null); setMessage(null); }
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
    if (!chosen?.header) return;
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

  const sameAsSaved = chosen?.header ? xml.files.some((record) => record.fileName === chosen.file.name && record.sizeBytes === chosen.file.size) : false;

  return (
    <section className="space-y-3" data-testid="rekordbox-xml-group">
      <h2 className="flex items-center gap-1.5 px-1 text-xs font-bold uppercase tracking-widest text-muted-foreground"><Document size={11} />Rekordbox</h2>
      <div className="glass divide-y divide-[var(--color-border-faint)] rounded-2xl">
        <div className="flex items-start justify-between gap-4 p-4">
          <div className="min-w-0">
            <p id="rekordbox-xml-label" className="text-sm font-bold">Sync Rekordbox XML</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Keep a copy of your Rekordbox XML export in your own private DropDex cloud folder. You can save more than one, for example one for each USB or each time you export.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-labelledby="rekordbox-xml-label"
            data-testid="rekordbox-xml-toggle"
            onClick={toggle}
            disabled={xml.saving}
            className={cn(
              'relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:opacity-50',
              enabled ? 'border-primary bg-primary' : 'border-[var(--color-border-subtle)] bg-[var(--color-surface)]',
            )}
          >
            <span className={cn('absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white shadow transition-all', enabled ? 'left-[22px]' : 'left-0.5')} />
          </button>
        </div>

        {enabled && (
          <div className="space-y-3 p-4" data-testid="rekordbox-xml-panel">
            <div>
              <label htmlFor="rekordbox-xml-path" className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Rekordbox XML file</label>
              <div className="mt-1.5 flex items-stretch gap-2">
                <input
                  id="rekordbox-xml-path"
                  readOnly
                  value={chosen?.location ?? ''}
                  placeholder="No file chosen"
                  title={chosen?.location}
                  data-testid="rekordbox-xml-path"
                  className="min-w-0 flex-1 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2 text-xs"
                />
                <ControlButton variant="neutral" onClick={() => inputRef.current?.click()} disabled={xml.saving}>
                  <FolderOpen size={14} /> Browse…
                </ControlButton>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".xml,text/xml,application/xml"
                  className="hidden"
                  data-testid="rekordbox-xml-input"
                  onChange={(event) => { void onFileChosen(event.target.files?.[0]); }}
                />
              </div>
              {chosen?.header && (
                <p className="mt-1.5 text-[11px] text-muted-foreground" data-testid="rekordbox-xml-summary">
                  {[formatBytes(chosen.file.size), chosen.header.trackCount != null ? `${chosen.header.trackCount.toLocaleString()} tracks` : null, chosen.header.rekordboxVersion ? `Rekordbox ${chosen.header.rekordboxVersion}` : null].filter(Boolean).join(' · ')}
                </p>
              )}
              {chosen?.problem && <p className="mt-1.5 flex items-start gap-1.5 text-xs text-red-400" role="alert"><WarningAlt size={14} className="mt-px shrink-0" />{chosen.problem}</p>}
              {sameAsSaved && <p className="mt-1.5 text-[11px] text-muted-foreground">You already saved a file with this name and size. Saving it again keeps both copies.</p>}
              {chosen && !desktop && <p className="mt-1.5 text-[11px] text-muted-foreground">Your browser only shares the file&apos;s name. The desktop app shows its full location.</p>}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <ControlButton variant="primary" onClick={() => void save()} disabled={!chosen?.header || xml.saving} data-testid="rekordbox-xml-save">
                {xml.saving ? <CircleDash className="animate-spin" size={14} /> : <CloudUpload size={14} />} {xml.saving ? 'Saving…' : 'Save to DropDex'}
              </ControlButton>
              {message && (
                <p className={cn('text-xs', message.kind === 'error' ? 'text-red-400' : 'text-emerald-400')} role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</p>
              )}
            </div>
          </div>
        )}

        {enabled && (
          <div data-testid="rekordbox-xml-saved">
            <p className="flex items-center gap-1.5 px-4 pt-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground"><DocumentAdd size={11} />Saved copies{xml.files.length > 0 ? ` · ${xml.files.length}` : ''}</p>
            {xml.loading && xml.files.length === 0 ? (
              <p className="flex items-center gap-2 px-4 py-4 text-xs text-muted-foreground"><CircleDash className="animate-spin text-primary" size={14} /> Loading your saved files…</p>
            ) : xml.loadFailed ? (
              <p className="flex items-center gap-3 px-4 py-4 text-xs text-red-400" role="alert">
                Your saved files couldn&apos;t be loaded. <button type="button" onClick={xml.reload} className="font-bold text-primary hover:underline">Try again</button>
              </p>
            ) : xml.files.length === 0 ? (
              <p className="px-4 py-4 text-xs text-muted-foreground" data-testid="rekordbox-xml-empty">Nothing saved yet. Choose a Rekordbox XML file above and save it.</p>
            ) : (
              <ul className="divide-y divide-[var(--color-border-faint)]">
                {xml.files.map((record) => <SavedFileRow key={record.id} record={record} onRemove={xml.remove} onDownload={download} />)}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
