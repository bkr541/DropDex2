import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getDeterministicBars(seed: string, count: number = 40): number[] {
  // Simple hash for seed
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }

  const bars: number[] = [];
  for (let i = 0; i < count; i++) {
    const pseudoRandom = Math.abs(Math.sin(hash + i)) * 100;
    // DJ waveform logic: usually higher in the middle (drop/chorus)
    const normalizedPos = i / count;
    const envelope = Math.sin(normalizedPos * Math.PI); 
    bars.push(Math.max(10, pseudoRandom * envelope));
  }
  return bars;
}

export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function formatKey(key: string): string {
  // Rekordbox keys sometimes come in different formats, but usually 1A, 2A, etc or C#, Db
  return key || 'N/A';
}
