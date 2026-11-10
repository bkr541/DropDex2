import type { SVGProps } from 'react';

/** A USB flash drive, drawn to match the line weight of the Iconoir icons used beside it. */
export function UsbDriveIcon({ width = 16, height = 16, ...rest }: SVGProps<SVGSVGElement>) {
  return (
    <svg width={width} height={height} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      <path d="M8 22h8a2 2 0 0 0 2-2v-8H6v8a2 2 0 0 0 2 2Z" />
      <path d="M8 12V3h8v9" />
      <path d="M10.5 6.5v1M13.5 6.5v1" />
    </svg>
  );
}
