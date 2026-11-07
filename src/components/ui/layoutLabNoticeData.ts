import { audioMediaErrorMessage, usbFileErrorMessage, usbStatusPlaybackMessage } from '../../contexts/AudioPlayerContext';
import type { UsbStatus } from '../../contexts/UsbConnectionContext';
import type { NoticeTone } from './feedback/NoticeCard';

export type NoticeGroupId = 'usb-state' | 'file-lookup' | 'audio-decoding' | 'player-track';

export interface NoticeEntry {
  id: string;
  group: NoticeGroupId;
  tone: NoticeTone;
  title: string;
  message: string;
  /** Shows the Connect USB button, as the Now Playing bar does for these two. */
  connectAction?: boolean;
}

export const NOTICE_GROUPS: readonly { id: NoticeGroupId; title: string; note: string }[] = [
  { id: 'usb-state', title: 'USB state', note: 'Why a track cannot play from the drive right now (usbStatusPlaybackMessage).' },
  { id: 'file-lookup', title: 'File lookup', note: 'The drive is there, but the file is not (usbFileErrorMessage).' },
  { id: 'audio-decoding', title: 'Audio decoding', note: 'The browser could not play the file (audioMediaErrorMessage).' },
  { id: 'player-track', title: 'Player and track', note: 'Problems found by the player itself before or while it starts.' },
];

/** Where the 25 player messages are shown today: the red line under the Audition transport, and the Now Playing bar everywhere else. */
export const NOTICE_SHOWN_IN = 'Audition transport · Now Playing bar';

const usb = (status: UsbStatus, tone: NoticeTone, title: string, extra: Partial<NoticeEntry> = {}): NoticeEntry => ({
  id: `usb-${status}`, group: 'usb-state', tone, title, message: usbStatusPlaybackMessage(status), ...extra,
});
const file = (kind: string, tone: NoticeTone, title: string, error: Parameters<typeof usbFileErrorMessage>[0]): NoticeEntry => ({
  id: `file-${kind}`, group: 'file-lookup', tone, title, message: usbFileErrorMessage(error),
});
const media = (code: number | null, title: string): NoticeEntry => ({
  id: `media-${code ?? 'none'}`, group: 'audio-decoding', tone: 'error', title, message: audioMediaErrorMessage(code === null ? null : ({ code } as MediaError)),
});

/** The 25 playback messages, with the real text from the player. */
export const NOTICES: readonly NoticeEntry[] = [
  usb('wrong_root', 'warning', 'Wrong folder'),
  usb('permission-required', 'warning', 'USB access needed'),
  usb('unavailable', 'warning', 'USB not found', { connectAction: true }),
  usb('unsupported', 'info', 'Browser cannot open a USB'),
  usb('error', 'error', 'USB problem'),
  usb('connecting', 'info', 'Checking the USB'),
  usb('disconnected', 'warning', 'USB disconnected', { connectAction: true }),
  usb('released', 'info', 'USB handed back'),

  file('not_found', 'error', 'File not on the USB', { kind: 'not_found', path: 'Contents/Artist/Track.mp3', message: '' }),
  file('permission_denied', 'warning', 'Permission denied', { kind: 'permission_denied', message: '' }),
  file('security', 'error', 'Blocked by the browser', { kind: 'security', message: '' }),
  file('type_mismatch', 'error', 'A folder, not a file', { kind: 'type_mismatch', segment: 'Track.mp3', message: '' }),
  file('ambiguous_case_match', 'error', 'Two names match', { kind: 'ambiguous_case_match', segment: 'track.mp3', candidates: ['Track.mp3', 'track.MP3'], path: 'Contents/Artist', message: '' }),
  file('abort', 'neutral', 'Cancelled', { kind: 'abort', message: '' }),
  file('unexpected', 'error', 'Could not open the file', { kind: 'unexpected', message: 'The drive stopped responding.' }),

  media(4, 'Unsupported format'),
  media(2, 'Network error'),
  media(3, 'Cannot decode the audio'),
  media(1, 'Playback error with a code'),
  media(null, 'Playback error'),

  { id: 'player-engine', group: 'player-track', tone: 'error', title: 'Audio engine not ready', message: 'Audio engine not ready.' },
  { id: 'player-no-path', group: 'player-track', tone: 'warning', title: 'No file path', message: 'This track has no file path. Re-import with a USB connected.' },
  { id: 'player-volume', group: 'player-track', tone: 'warning', title: 'Different USB', message: 'This track belongs to USB volume "DVYDRMNG" but its Rekordbox path references "PIONEER_DJ". Connect the matching drive.' },
  { id: 'player-path', group: 'player-track', tone: 'error', title: 'Path cannot be resolved', message: 'Cannot resolve track path (invalid): "C:\\Music\\Track.mp3"' },
  { id: 'player-failed', group: 'player-track', tone: 'error', title: 'Playback failed', message: 'Playback failed: The play() request was interrupted by a call to pause().' },
];

export interface SurfaceNotice {
  id: string;
  surface: string;
  where: string;
  tone: NoticeTone;
  title: string;
  message: string;
  action?: string;
}

/** The USB notices that are written separately from the player, one per screen, with their real wording. */
export const SURFACE_NOTICES: readonly SurfaceNotice[] = [
  { id: 'top-bar', surface: 'Top bar USB button', where: 'usb/UsbConnectionButton.tsx (hover message)', tone: 'warning', title: 'USB not found', message: 'Plug the drive back in, or click to try again.', action: 'Try again' },
  { id: 'usb-management', surface: 'USB Management', where: 'usb-management/UsbOverviewTab.tsx', tone: 'neutral', title: 'No USB connected', message: 'Connect the USB you play from to see how much room it has, what format it is in, and what is on it.', action: 'Connect USB' },
  { id: 'cloud-sync', surface: 'Cloud sync', where: 'profile/StreamingSyncGroup.tsx', tone: 'warning', title: 'Connect your USB first', message: 'DropDex reads your tracks from it to make the cloud copies. You can do that on the USB Management page.' },
  { id: 'resume-analysis', surface: 'Resume Analysis', where: 'ResumeAnalysisModal.tsx', tone: 'warning', title: 'Some tracks still need analysis', message: 'Reconnect the USB and run Resume Analysis again to retry the 12 tracks still missing analysis files.' },
  { id: 'drop-lab', surface: 'Drop Lab', where: 'lib/music/dropLabPreviewAudio.ts', tone: 'warning', title: 'USB needed to preview', message: 'Connect the Rekordbox USB drive to preview this transition.', action: 'Connect USB' },
  { id: 'flip-lab', surface: 'Flip Lab', where: 'flip-lab/flipLabSeparation.ts', tone: 'warning', title: 'USB needed to flip', message: 'Connect the USB that has "Fancy. $hit (KALYP Remix)" and press Flip again.', action: 'Connect USB' },
  { id: 'cue-points', surface: 'Cue Points', where: 'cues/CuePointsView.tsx (floating note over the waveform)', tone: 'warning', title: 'Beat snapping unavailable', message: 'Beat snapping is unavailable because this track has no valid Rekordbox beat grid. Switch Snap to Off for deliberate off-grid timing.' },
];
