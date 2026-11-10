import type { ElementType, SVGProps } from 'react';
import { AlbumList, BookStack, Flask, Globe, HardDrive, Headset, HorizontalMerge, PlaylistPlay } from 'iconoir-react/regular';
import { Flask as FilledFlask, Headset as FilledHeadset } from 'iconoir-react/solid';
import './navIcons.css';

const CUE_MARKER_OUTLINE = 'M4.5 3h15Q21 3 21 4.5V16q0 .7-.6 1.1l-7.8 4.4q-.6 .35-1.2 0l-7.8-4.4Q3 16.7 3 16V4.5Q3 3 4.5 3Z';

/** The Fine Outline cue marker from the waveform, drawn at navigation size. */
function CuePointsNavIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}
      strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d={CUE_MARKER_OUTLINE} />
      <path d="m8.5 14 3.5-7 3.5 7M9.75 11.5h4.5" />
    </svg>
  );
}

/** Page icons shared by navigation and page headings. */
export const NAV_ICONS = {
  home: BookStack,
  'artist-library': AlbumList,
  cues: CuePointsNavIcon,
  audition: Headset,
  discovery: Globe,
  'drop-lab': Flask,
  'set-lab': PlaylistPlay,
  'flip-lab': HorizontalMerge,
  usb: HardDrive,
};

function filledIcon(path: string) {
  return function FilledIcon(props: SVGProps<SVGSVGElement>) {
    return (
      <svg width={24} height={24} viewBox="0 0 24 24" fill="none" {...props}>
        <path d={path} fill="currentColor" fillRule="evenodd" />
      </svg>
    );
  };
}

export const FilledProfileIcon = filledIcon(
  'M12 3.5a4 4 0 1 1 0 8a4 4 0 0 1 0-8Z M4.5 19a7.5 7.5 0 0 1 15 0v.5a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1Z',
);

/** Filled counterparts for the active sidebar. Cutouts retain identifying details at 24px. */
export const FILLED_NAV_ICONS = new Map<ElementType, ElementType>([
  [BookStack, filledIcon(
    'M7 2.5h11.5a1 1 0 0 1 1 1v17a1 1 0 0 1-1 1H7A2.5 2.5 0 0 1 4.5 19V5A2.5 2.5 0 0 1 7 2.5Z ' +
    'M9 6.5h6V8H9Z M7 14.5h11v1.25H7Z M7 18h11v1.25H7Z',
  )],
  [AlbumList, filledIcon(
    'M3 2h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z ' +
    'M10.2 5.5h3.7V7h-2.2v5.5c0 1.1-1 2-2.2 2s-2.2-.75-2.2-1.8c0-1.15 1.3-2.1 2.9-1.7Z ' +
    'M20.25 8H22v12.5a1.5 1.5 0 0 1-1.5 1.5H8v-1.75h12.25Z',
  )],
  [CuePointsNavIcon, filledIcon(
    CUE_MARKER_OUTLINE +
    ' M7.5 14.5l3.8-8h1.4l3.8 8h-1.6l-.85-1.85h-4.1L9.1 14.5Z M10.55 11.4h2.9L12 8.2Z',
  )],
  [Headset, FilledHeadset],
  [Globe, filledIcon(
    'M12 2a10 10 0 1 1 0 20a10 10 0 0 1 0-20Z ' +
    'M8 4.8l1.6 1.1L8 8.6l-2.5.8L4 11a8 8 0 0 1 4-6.2Z ' +
    'M4.5 13l4 1.5-1 3.2.6 2.1a8 8 0 0 1-3.6-6.8Z ' +
    'M16.8 5.1a8 8 0 0 1 3.3 4.2l-2.6-.8-2.1 1v-2.2l1.4-.5Z ' +
    'M19.9 13.3a8 8 0 0 1-3.2 5.5l-.5-1.6-2.1-1v-2.7l2.7-1.1Z',
  )],
  [Flask, FilledFlask],
  [PlaylistPlay, filledIcon('M2 4h18v2.5H2Z M2 10h18v2.5H2Z M2 16h12v2.5H2Z M17.5 14.5 22 18l-4.5 3.5Z')],
  [HorizontalMerge, filledIcon('M10 3h1.5v18H10v-8l-4 3v-3.1H2v-1.8h4V8l4 3Z M14 3h-1.5v18H14v-8l4 3v-3.1h4v-1.8h-4V8l-4 3Z')],
  [HardDrive, filledIcon(
    'M5.5 3h13a1 1 0 0 1 .96.72L22 13v7a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-7l2.54-9.28A1 1 0 0 1 5.5 3Z ' +
    'M3.5 12.25h17v1.5h-17Z M6 16.1a.9 .9 0 1 1 0 1.8a.9 .9 0 0 1 0-1.8Z M10 16.1a.9 .9 0 1 1 0 1.8a.9 .9 0 0 1 0-1.8Z',
  )],
]);
