import { AlbumList, BookStack, Flask, Globe, HardDrive, Headset, HorizontalMerge, PlaylistPlay, TriangleFlag } from 'iconoir-react/regular';
import './navIcons.css';

/** One Iconoir Regular icon per page, shared by navigation and page headings. */
export const NAV_ICONS = {
  home: BookStack,
  'artist-library': AlbumList,
  cues: TriangleFlag,
  audition: Headset,
  discovery: Globe,
  'drop-lab': Flask,
  'set-lab': PlaylistPlay,
  'flip-lab': HorizontalMerge,
  usb: HardDrive,
};
