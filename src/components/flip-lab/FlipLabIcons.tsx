import { HorizontalMerge, Microphone, MusicDoubleNote } from 'iconoir-react/regular';

export function VocalIcon({ size = 24 }: { size?: number }) {
  return <Microphone width={size} height={size} aria-hidden="true" />;
}

export function InstrumentalIcon({ size = 24 }: { size?: number }) {
  return <MusicDoubleNote width={size} height={size} aria-hidden="true" />;
}

export function FlipIcon({ size = 24 }: { size?: number }) {
  return <HorizontalMerge width={size} height={size} aria-hidden="true" />;
}
