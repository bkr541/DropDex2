import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/utils';
import './essential-audio-dock.css';

/** Layout Lab 01. The preview and production dock use the same composition and CSS. */
export function EssentialAudioDock({ transport, identity, timeline, metadata, output, className, ...props }: {
  transport: ReactNode; identity: ReactNode; timeline: ReactNode; metadata: ReactNode; output: ReactNode;
} & HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cn('adl-dock', className)}>
    {transport}{identity}{timeline}<div className="adl-metadata">{metadata}</div>{output}
  </div>;
}
