import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { RekordboxPreviewWaveform } from '../../components/library/RekordboxPreviewWaveform';
import { ControlButton } from '../../components/ui/controls';
import { TimelineBeatLane, TimelineLane, TimelineSectionLane } from '../../components/ui/media';
import { WaveformCueMarker } from '../../components/ui/media/WaveformCueMarker';
import { sectionTone } from '../../lib/music/phraseSections';
import { formatTime } from '../../lib/music/trackTiming';
import type { WaveformLoadState } from '../../lib/queries/waveformValidation';
import { cn } from '../../lib/utils';
import { loadSetLabReposition, prepareSetLabReposition, setLabRepositionViewport, type SetLabRepositionData, type SetLabRepositionTarget } from './repositionSetLab';
import { nearestSetLabWindow, sameSetLabWindow, setLabPhraseIntervals, type ResolvedSetLabSection } from './sectionResolver';
import type { SetLabSourceDependencies } from './setLabSources';
import type { SetLabAction } from './sessionReducer';
import { setLabCueMarkers, sliceSetLabClipWaveform } from './timelineGeometry';
import './setLabReposition.css';

type RepositionAction = Extract<SetLabAction, { type: 'reposition' }>;

function RepositionLanes({ target, data, waveform, proposed, overview = false }: {
  target: SetLabRepositionTarget;
  data: SetLabRepositionData;
  waveform: WaveformLoadState;
  proposed: ResolvedSetLabSection;
  overview?: boolean;
}) {
  const { trackDurationMs, waveformDurationMs } = data;
  const viewport = setLabRepositionViewport(proposed.section, trackDurationMs);
  const visible = overview ? { startMs: 0, endMs: trackDurationMs } : viewport.visible;
  const percent = overview ? (ms: number) => ms / trackDurationMs * 100 : viewport.percent;
  const phrases = setLabPhraseIntervals(data.phrases, target.grid.beats, trackDurationMs);
  const sections = phrases.flatMap(({ id, startMs, endMs, semantic, occurrence }) => {
    const start = Math.max(startMs, visible.startMs);
    const end = Math.min(endMs, visible.endMs);
    if (end <= start) return [];
    const label = semantic.type ? `${semantic.type} ${occurrence}` : 'Unclassified phrase';
    return [{ id, label, title: `${label} · ${formatTime(startMs)}–${formatTime(endMs)}`,
      color: sectionTone(semantic.type ?? '').waveformColor, leftPercent: percent(start), widthPercent: percent(end) - percent(start) }];
  });
  const cues = setLabCueMarkers(target.cues, visible);
  const beats = target.grid.beats.filter((beat) => beat.ms >= visible.startMs && beat.ms <= visible.endMs && (!overview || beat.isDownbeat));
  const barLabelStride = Math.max(1, Math.ceil(beats.filter(({ isDownbeat }) => isDownbeat).length / (overview ? 12 : 24)));
  const section = proposed.section;
  const height = overview ? 40 : 132;
  const display = sliceSetLabClipWaveform(waveform, visible, waveformDurationMs);
  return (
    <div className="waveform-section-frame">
      <div className="cue-timeline relative" style={{ '--cue-timeline-inline-inset': '0px' } as CSSProperties}>
        <div className={overview ? undefined : 'set-lab-reposition__reveal'}>
          <TimelineSectionLane sections={sections} message={sections.length ? undefined :
            <p className="px-2 pt-1 text-[10px] text-muted-foreground">{data.phraseError ? 'Phrase analysis could not load' : 'No labeled phrases here'}</p>} />
          <TimelineLane heightClass="h-9">
            {cues.map((cue) => <WaveformCueMarker key={cue.id} role="img" aria-label={cue.description} title={cue.description}
              label={cue.label} color={cue.color} memory={!cue.hot}
              style={{ left: `${percent(visible.startMs) + cue.leftPercent / 100 * (percent(visible.endMs) - percent(visible.startMs))}%` }}
            />)}
          </TimelineLane>
          <TimelineLane heightClass={overview ? 'h-10' : 'h-[132px]'} className="bg-[var(--color-background)]/70">
            <div className="absolute inset-y-0"
              style={{ left: `${percent(visible.startMs)}%`, width: `${percent(visible.endMs) - percent(visible.startMs)}%` }}>
              <RekordboxPreviewWaveform state={display} height={height} variant="detail" appearance="rekordbox"
                renderMode="area" surface={false} showCenterLine={false}
                ariaLabel={overview ? 'Full track waveform' : 'Expanded source waveform'} />
            </div>
          </TimelineLane>
          <TimelineBeatLane ticks={beats.map((beat) => ({
            key: String(beat.seq), leftPercent: percent(beat.ms), downbeat: beat.isDownbeat,
            title: `Bar ${beat.bar}, beat ${beat.beatInBar} · ${formatTime(beat.ms)}`,
          }))} labels={beats.filter((beat) => beat.isDownbeat && (beat.bar - 1) % barLabelStride === 0).map((beat) => ({
            key: String(beat.seq), leftPercent: percent(beat.ms), text: beat.bar,
          }))} />
        </div>
        <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 rounded-sm border-2 border-primary bg-primary/[0.08]"
          style={{ left: `${percent(section.startMs)}%`, width: `${percent(section.endMs) - percent(section.startMs)}%` }} />
      </div>
    </div>
  );
}

function RepositionWaveform({ target, data, waveform, index, onChange, disabled, inputRef }: {
  target: SetLabRepositionTarget;
  data: SetLabRepositionData;
  waveform: WaveformLoadState;
  index: number;
  onChange: (index: number) => void;
  disabled: boolean;
  inputRef: React.Ref<HTMLInputElement>;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; startMs: number; msPerPixel: number } | null>(null);
  const scroll = useRef<number | null>(null);
  const proposed = data.windows[index];
  const viewport = setLabRepositionViewport(proposed.section, data.trackDurationMs);
  const snap = useMemo(() => (ms: number) => {
    const window = nearestSetLabWindow(data.windows, ms);
    if (window) onChange(data.windows.indexOf(window));
  }, [data.windows, onChange]);

  useEffect(() => {
    const element = surface.current?.querySelector<HTMLElement>('.cue-timeline');
    if (!element || disabled) return;
    function wheel(event: WheelEvent) {
      const delta = event.deltaX || (event.shiftKey ? event.deltaY : 0);
      const width = element?.clientWidth ?? 0;
      if (!delta || !width) return;
      event.preventDefault();
      const pixels = delta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? width : 1);
      const start = (scroll.current ?? proposed.section.startMs) + pixels * viewport.spanMs / width;
      scroll.current = Math.max(data.windows[0].section.startMs, Math.min(data.windows.at(-1)!.section.startMs, start));
      snap(scroll.current);
    }
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [data.windows, disabled, proposed.section.startMs, snap, viewport.spanMs]);

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if (disabled || !event.isPrimary || event.button !== 0) return;
    const width = event.currentTarget.querySelector<HTMLElement>('.cue-timeline')?.clientWidth ?? 0;
    if (!width) return;
    scroll.current = null;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, startMs: proposed.section.startMs, msPerPixel: viewport.spanMs / width };
  }

  const { section, quality, explanation } = proposed;
  const phrase = section.phraseType ? `${section.phraseType} ${section.phraseOccurrence}`
    : quality === 'mixed' ? 'Mixed section' : 'Unclassified section';
  return (
    <>
      <div className="rounded-md border border-[var(--color-border-subtle)] p-2">
        <div ref={surface} className="touch-pan-y select-none overflow-hidden rounded bg-[var(--color-background)] cursor-grab active:cursor-grabbing"
          onPointerDown={startDrag} onLostPointerCapture={() => { drag.current = null; }}
          onPointerMove={(event) => {
            if (!disabled && drag.current && event.currentTarget.hasPointerCapture(event.pointerId)) {
              const { x, startMs, msPerPixel } = drag.current;
              snap(startMs + (x - event.clientX) * msPerPixel);
            }
          }}>
          <RepositionLanes target={target} data={data} waveform={waveform} proposed={proposed} />
        </div>
        <div className="mt-2 flex flex-wrap justify-between gap-x-3 text-xs">
          <span className="font-bold">{proposed.barCount} bars · {phrase}</span>
          <output aria-live="polite" className="font-mono text-muted-foreground">
            Bar {proposed.startDownbeat.bar} → {proposed.endDownbeat.bar} · {(section.startMs / 1000).toFixed(3)}–{(section.endMs / 1000).toFixed(3)} s
          </output>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{explanation}</p>
      </div>

      <div className="mt-3 rounded-md border border-[var(--color-border-subtle)] p-2">
        <p className="mb-2 text-xs font-bold">Full track</p>
        <RepositionLanes target={target} data={data} waveform={waveform} proposed={proposed} overview />
        <label className="mt-2 block text-xs text-muted-foreground">
          Start downbeat
          <input ref={inputRef} type="range" min={0} max={data.windows.length - 1} step={1} value={index}
            disabled={disabled}
            aria-valuetext={`Bar ${proposed.startDownbeat.bar}, ${(section.startMs / 1000).toFixed(3)} seconds`}
            onChange={(event) => { scroll.current = null; onChange(Number(event.currentTarget.value)); }}
            className="block w-full accent-primary focus-visible:outline-primary" />
        </label>
        <p className="mt-1 text-xs text-muted-foreground">Drag the expanded waveform, scroll sideways, or use the slider’s arrow keys, Home and End.</p>
        {data.mediaDurationMs < data.trackDurationMs && <p className="mt-1 text-xs text-muted-foreground">
          The available audio ends at {formatTime(data.mediaDurationMs)}. The slider stops at the last complete playable window.
        </p>}
      </div>
    </>
  );
}

export function SetLabRepositionEditor({ target, waveform, trigger, usb, onClose, onCommit }: {
  target: SetLabRepositionTarget;
  waveform: WaveformLoadState;
  trigger: HTMLElement;
  usb: SetLabSourceDependencies['usb'];
  onClose: () => void;
  onCommit: (action: RepositionAction, confirmed?: boolean) => 'confirm' | 'committed' | 'rejected';
}) {
  const titleId = useId();
  const descriptionId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const slider = useRef<HTMLInputElement>(null);
  const confirmationCancel = useRef<HTMLDivElement>(null);
  const saveRequest = useRef<AbortController | null>(null);
  const confirmation = useRef<RepositionAction | null>(null);
  const [pending, setPending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<SetLabRepositionData | null>(null);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useLayoutEffect(() => {
    const element = dialog.current;
    element?.showModal();
    heading.current?.focus();
    return () => {
      saveRequest.current?.abort();
      saveRequest.current = null;
      confirmation.current = null;
      element?.close();
      if (trigger.isConnected) trigger.focus({ preventScroll: true });
    };
  }, [trigger]);

  // The parent invalidates the whole editor on USB or import changes. Keep the
  // connection used by this request fixed even if the context object rerenders.
  const sources = useRef({ usb });
  useEffect(() => {
    const controller = new AbortController();
    void loadSetLabReposition(target, sources.current, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      const current = nearestSetLabWindow(result.windows, target.slot.section.startMs);
      setIndex(current ? result.windows.indexOf(current) : 0);
      setData(result);
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'The track could not be loaded.');
    });
    return () => controller.abort();
  }, [target]);

  useLayoutEffect(() => {
    if (pending) confirmationCancel.current?.querySelector('button')?.focus();
    else if (data && document.activeElement === heading.current) slider.current?.focus();
  }, [data, pending]);

  function cancelConfirmation() {
    confirmation.current = null;
    setPending(false);
    heading.current?.focus();
  }

  function commit(action: RepositionAction, confirmed = false) {
    const status = onCommit(action, confirmed);
    if (status === 'confirm') {
      confirmation.current = action;
      setPending(true);
    } else if (status === 'committed') {
      onClose();
    } else {
      setError('The draft could not be updated. The original section is still in place.');
    }
  }

  const proposed = data?.windows[index];
  async function save() {
    if (!data || !proposed || saveRequest.current || confirmation.current) return;
    const request = new AbortController();
    saveRequest.current = request;
    setSaving(true);
    setError(null);
    try {
      const action = await prepareSetLabReposition(target, data, proposed, sources.current, request.signal);
      request.signal.throwIfAborted();
      commit(action);
    } catch (reason) {
      if (!request.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not validate the proposed section.');
    } finally {
      if (saveRequest.current === request) {
        saveRequest.current = null;
        setSaving(false);
      }
    }
  }

  function confirm() {
    const action = confirmation.current;
    if (!action) return;
    cancelConfirmation();
    try {
      commit(action, true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save the proposed section.');
    }
  }

  return (
    <dialog ref={dialog} aria-labelledby={titleId} aria-describedby={descriptionId}
      className="set-lab-reposition m-auto overflow-y-auto rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 text-foreground shadow-2xl backdrop:bg-black/70 sm:p-5"
      onCancel={(event) => {
        event.preventDefault();
        if (confirmation.current) cancelConfirmation();
        else onClose();
      }}>
      <h2 ref={heading} tabIndex={-1} id={titleId} className="text-base font-black outline-none">
        {pending ? 'Apply the new section?' : 'Reposition Track'}
      </h2>
      <p id={descriptionId} className="mb-3 mt-1 text-xs text-muted-foreground">
        {pending ? 'Applying this change will stop playback and reset the preview to the beginning.'
          : `Slot ${target.slot.position} · ${target.track.title} · ${target.slot.barCount} bars`}
      </p>
      <div hidden={pending}>
        {data && <RepositionWaveform target={target} data={data} waveform={waveform} index={index} onChange={setIndex}
          disabled={saving} inputRef={slider} />}
        {!data && !error && <p role="status" className="py-4 text-sm text-muted-foreground">Checking audio and loading the Rekordbox grid…</p>}
        {error && <p role="alert" className="mt-3 text-sm text-foreground">{error}</p>}
        {saving && <p role="status" className="mt-3 text-xs text-muted-foreground">Verifying audio for the selected section…</p>}
        <div className="mt-4 flex justify-end gap-2">
          <ControlButton onClick={onClose}>Cancel</ControlButton>
          <ControlButton variant="primary" disabled={!proposed || saving || sameSetLabWindow(target.slot.section, proposed.section)}
            onClick={() => { void save(); }}>Save</ControlButton>
        </div>
      </div>
      {pending && <div ref={confirmationCancel} className="mt-4 flex justify-end gap-2">
        <ControlButton onClick={cancelConfirmation}>Cancel</ControlButton>
        <ControlButton variant="primary" onClick={confirm}>Confirm</ControlButton>
      </div>}
    </dialog>
  );
}
