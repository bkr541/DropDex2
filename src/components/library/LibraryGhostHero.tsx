import { useCallback, useRef, useState } from 'react';
import { Calendar, CheckCircle, MediaImage, Pause, Refresh, Undo, Upload, Usb, WarningTriangle } from 'iconoir-react/regular';
import { useUsbConnection } from '../../contexts/UsbConnectionContext';
import { useLibraryHeroCounts } from '../../hooks/useLibraryHeroCounts';
import type { LibraryOverviewWidgetId } from '../../lib/dashboard/libraryOverviewWidgets';
import { cn } from '../../lib/utils';
import type { RekordboxImport, UserProfile } from '../../types';
import { ControlButton } from '../ui/controls';
import { heroFigure, heroImportState, type HeroImportTone } from './libraryHeroState';
import { ProfileSocialLinks } from './ProfileSocialLinks';
import './library-ghost-hero.css';

const TONE_ICON: Record<HeroImportTone, typeof CheckCircle> = { complete: CheckCircle, paused: Pause, working: Refresh, incomplete: WarningTriangle, failed: WarningTriangle };

interface LibraryGhostHeroProps {
  latestImport: RekordboxImport;
  profile: UserProfile | null;
  /** Groups the user has turned off in Personalization. */
  hiddenWidgets: ReadonlySet<LibraryOverviewWidgetId>;
  /** How many genres the library has, from the library statistics the page already loads. */
  genreCount: number | null;
  onImport: () => void;
  onResumeAnalysis?: (importId: string) => void;
  onShowIncompleteAnalysis?: () => void;
}

/**
 * The Home hero: the Ghost Banner. The artist's name rises from the bottom edge as a huge faint word, the picture, name and social icons
 * are large, and seven values about the library run in one line between hairlines. Under them, in a row as wide as that line, are where
 * the import stands, the USB if one is loaded, the date of the last import, Resume Analysis when it is needed, and Import Library.
 */
export function LibraryGhostHero({ latestImport, profile, hiddenWidgets, genreCount, onImport, onResumeAnalysis, onShowIncompleteAnalysis }: LibraryGhostHeroProps) {
  const { status: usbStatus, volumeName } = useUsbConnection();
  const counts = useLibraryHeroCounts(latestImport.id, profile?.user_id ?? null);
  const [imgError, setImgError] = useState(false);
  const [heroBg, setHeroBg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleBgUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (heroBg) URL.revokeObjectURL(heroBg);
    setHeroBg(URL.createObjectURL(file));
    event.target.value = '';
  }, [heroBg]);

  const showUsbImport = !hiddenWidgets.has('usbImport');
  const showAnalysis = !hiddenWidgets.has('trackAnalysis');
  const name = profile?.display_name?.trim() || 'My library';
  const initials = profile?.display_name ? profile.display_name.split(' ').map((word) => word[0]).join('').slice(0, 2).toUpperCase() : null;
  const avatarUrl = profile?.avatar_url ?? null;

  const total = latestImport.analysis_expected_track_count || latestImport.track_count;
  const parsed = latestImport.analysis_parsed_track_count ?? 0;
  const analysedPct = latestImport.analysis_status === 'completed' ? 100 : total > 0 ? Math.round((parsed / total) * 100) : 0;
  const state = heroImportState(latestImport.analysis_status);
  const StateIcon = TONE_ICON[state.tone];
  const canResume = state.needsAttention && state.tone !== 'working' && onResumeAnalysis && (latestImport.analysis_status === 'partial' || latestImport.analysis_status === 'failed' || latestImport.analysis_status === 'awaiting_upload' || latestImport.analysis_status === 'uploading');
  const lastImport = new Date(latestImport.imported_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const usbLoaded = usbStatus === 'connected' ? volumeName ?? 'USB connected' : null;

  const values: { label: string; value: string }[] = [
    { label: 'Tracks', value: heroFigure(latestImport.track_count) },
    { label: 'Playlists', value: heroFigure(counts.playlists) },
    { label: 'USBs', value: heroFigure(counts.usbs) },
    { label: 'Cue points', value: heroFigure(counts.cuePoints) },
    { label: 'Genres', value: heroFigure(genreCount) },
    ...(showAnalysis ? [{ label: 'Analysed', value: `${analysedPct}%` }] : []),
    { label: 'In the cloud', value: heroFigure(counts.inCloud) },
  ];

  const statusWord = (
    <>
      <StateIcon width={12} height={12} aria-hidden="true" /> {state.label}
    </>
  );

  return (
    <section className="lgh group" data-testid="library-hero" style={heroBg ? { backgroundImage: `url(${heroBg})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}>
      {heroBg && <div className="lgh-wash" />}
      <span aria-hidden="true" className="lgh-watermark" data-testid="hero-watermark">{name}</span>

      {/* Hover-reveal controls for the background picture */}
      <div className="absolute right-3 top-3 z-20 flex items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        {heroBg && (
          <button type="button" className="lgh-bg-button" aria-label="Remove background image" onClick={() => { URL.revokeObjectURL(heroBg); setHeroBg(null); }}><Undo width={16} height={16} aria-hidden="true" /></button>
        )}
        <button type="button" className="lgh-bg-button" aria-label="Change background image" onClick={() => fileInputRef.current?.click()}><MediaImage width={16} height={16} aria-hidden="true" /></button>
      </div>
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleBgUpload} aria-hidden="true" tabIndex={-1} />

      <div className="lgh-inner">
        <div className="flex min-w-0 items-center gap-7" data-testid="hero-identity">
          <div className="lgh-profile">
            <div className="lgh-ring" />
            {avatarUrl && !imgError ? (
              <img src={avatarUrl} alt={name} onError={() => setImgError(true)} className="lgh-avatar h-full w-full object-cover" />
            ) : (
              <div className="lgh-avatar lgh-avatar-initials h-full w-full">
                <span className="font-light tracking-[0.06em] text-primary">{initials ?? '?'}</span>
              </div>
            )}
            <span className="lgh-active-dot" />
          </div>
          <div className="flex min-w-0 flex-col justify-center gap-3.5">
            <p className="lgh-label">Artist library</p>
            <h2 className="truncate text-[40px] font-light uppercase leading-none tracking-[0.06em]" data-testid="hero-name">{name}</h2>
            <ProfileSocialLinks profile={profile} size={26} className="gap-5" />
          </div>
        </div>

        <div className="ml-auto flex shrink-0 flex-col gap-4">
          <div className="flex items-center">
            {values.map(({ label, value }, i) => (
              <div key={label} className={cn('min-w-0 px-5 text-center', i > 0 && 'border-l border-[#ffffff14]')} data-testid="hero-value"><p className="lgh-figure truncate text-[26px]">{value}</p><p className="lgh-label mt-1.5 whitespace-nowrap">{label}</p></div>
            ))}
          </div>

          {/* As wide as the line of values above, no wider: it takes no width of its own and wraps if it must. */}
          <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 border-t border-[#ffffff14] pt-3.5" style={{ width: 0, minWidth: '100%' }} data-testid="hero-import-row">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
              {state.needsAttention && onShowIncompleteAnalysis && showAnalysis ? (
                <button type="button" className="lgh-status" data-tone={state.tone} onClick={onShowIncompleteAnalysis} title="Show the tracks that still need analysis">{statusWord}</button>
              ) : (
                <span className="lgh-status" data-tone={state.tone} data-testid="hero-import-status">{statusWord}</span>
              )}
              {showUsbImport && <p className="lgh-meta" data-testid="hero-usb"><Usb width={11} height={11} aria-hidden="true" /> {usbLoaded ?? 'No USB loaded'}</p>}
              {showUsbImport && <p className="lgh-meta" data-testid="hero-last-import"><Calendar width={11} height={11} aria-hidden="true" /> Last import {lastImport}</p>}
            </div>
            <div className="flex items-center gap-3">
              {showAnalysis && canResume && (
                <ControlButton variant="secondary" className="!min-h-8 whitespace-nowrap" onClick={() => onResumeAnalysis(latestImport.id)}><Refresh width={12} height={12} aria-hidden="true" /> Resume Analysis</ControlButton>
              )}
              {showUsbImport && <ControlButton variant="primary" className="!min-h-8 whitespace-nowrap" onClick={onImport}><Upload width={12} height={12} aria-hidden="true" /> Import Library</ControlButton>}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
