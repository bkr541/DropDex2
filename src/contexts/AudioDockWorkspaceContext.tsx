import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import type { RekordboxTrack } from '../types';

export interface AudioDockWorkspace {
  tracks: readonly RekordboxTrack[];
  selectedTrack: RekordboxTrack | null;
  onSelectTrack?: (track: RekordboxTrack) => void;
}
const WorkspaceContext = createContext<AudioDockWorkspace | null>(null);
const RegistrationContext = createContext<((owner: string, workspace: AudioDockWorkspace) => () => void) | null>(null);

/** Supplies page navigation to the dock without changing any audio engine. */
export function AudioDockWorkspaceProvider({ children }: { children: ReactNode }) {
  const [registration, setRegistration] = useState<{ owner: string; workspace: AudioDockWorkspace } | null>(null);
  const register = useCallback((owner: string, workspace: AudioDockWorkspace) => {
    setRegistration({ owner, workspace });
    return () => setRegistration((current) => current?.owner === owner ? null : current);
  }, []);
  return <RegistrationContext.Provider value={register}>
    <WorkspaceContext.Provider value={registration?.workspace ?? null}>{children}</WorkspaceContext.Provider>
  </RegistrationContext.Provider>;
}

/** Optional in standalone previews/tests. Only mounted workspace owners register a queue. */
export function useAudioDockTracks(tracks: readonly RekordboxTrack[], selectedTrack: RekordboxTrack | null = null,
  onSelectTrack?: (track: RekordboxTrack) => void, enabled = true) {
  const register = useContext(RegistrationContext);
  const owner = useId();
  const workspace = useMemo(() => ({ tracks, selectedTrack, onSelectTrack }), [tracks, selectedTrack, onSelectTrack]);
  useEffect(() => {
    if (register && enabled) return register(owner, workspace);
  }, [register, owner, workspace, enabled]);
}
export function useAudioDockWorkspace() { return useContext(WorkspaceContext); }
