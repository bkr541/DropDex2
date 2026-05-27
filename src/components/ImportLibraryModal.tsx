import React, { useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  AlertCircle,
  CheckCircle2,
  Database,
  FileUp,
  Loader2,
  X,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { supabase } from '../lib/supabase';
import { uploadRekordboxDb } from '../lib/api/rekordboxImport';
import type { ImportResult } from '../lib/api/rekordboxImport';

type ModalState = 'idle' | 'selected' | 'uploading' | 'success' | 'error';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const EXPECTED_FILENAME = 'exportLibrary.db';

export function ImportLibraryModal({ isOpen, onClose, onSuccess }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<ModalState>('idle');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  const reset = () => {
    setState('idle');
    setSelectedFile(null);
    setResult(null);
    setErrorMessage('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleClose = () => {
    if (state === 'uploading') return;
    reset();
    onClose();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.db')) {
      setErrorMessage(
        'Please select a .db database file. The rekordbox export is named exportLibrary.db.',
      );
      setState('error');
      return;
    }
    setSelectedFile(file);
    setState('selected');
  };

  const handleImport = async () => {
    if (!selectedFile) return;

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      setErrorMessage('You must be signed in to import a library.');
      setState('error');
      return;
    }

    setState('uploading');
    try {
      const importResult = await uploadRekordboxDb(selectedFile, session.access_token);
      setResult(importResult);
      setState('success');
    } catch (err: unknown) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Import failed. Please try again.',
      );
      setState('error');
    }
  };

  const handleDone = () => {
    onSuccess();
    reset();
    onClose();
  };

  const unexpectedName = selectedFile && selectedFile.name !== EXPECTED_FILENAME;

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="w-full max-w-sm glass p-8 rounded-3xl"
          >

            {/* ── Idle / Selected ── */}
            {(state === 'idle' || state === 'selected') && (
              <>
                <div className="flex items-start justify-between mb-6">
                  <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center shrink-0">
                    <Database className="text-primary" size={22} />
                  </div>
                  <button
                    onClick={handleClose}
                    className="text-muted-foreground hover:text-foreground transition-colors p-1"
                  >
                    <X size={18} />
                  </button>
                </div>

                <h2 className="text-2xl font-bold mb-2">Import Rekordbox USB Library</h2>
                <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
                  Select{' '}
                  <code className="text-primary font-mono text-xs">exportLibrary.db</code> from
                  your USB drive's{' '}
                  <code className="font-mono text-xs">PIONEER/rekordbox</code> folder. DropDex
                  will import your playlists and track metadata to the cloud.
                </p>

                {/* Drop zone */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className={cn(
                    'w-full py-5 px-4 rounded-2xl border-2 border-dashed transition-all mb-4 text-center',
                    selectedFile
                      ? 'border-primary/50 bg-primary/5'
                      : 'border-[var(--color-border-subtle)] hover:border-primary/40 hover:bg-primary/5',
                  )}
                >
                  {selectedFile ? (
                    <div>
                      <p className="text-sm font-bold font-mono truncate">{selectedFile.name}</p>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        {(selectedFile.size / (1024 * 1024)).toFixed(1)} MB · Click to change
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <FileUp size={20} />
                      <p className="text-sm">Click to select file</p>
                    </div>
                  )}
                </button>

                {/* Unexpected filename warning */}
                {unexpectedName && (
                  <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl mb-4">
                    <AlertCircle size={13} className="text-amber-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-300 leading-relaxed">
                      Unexpected filename. The standard rekordbox database is named{' '}
                      <code className="font-mono">exportLibrary.db</code>. You can still try
                      importing.
                    </p>
                  </div>
                )}

                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  className="hidden"
                  accept=".db"
                />

                <button
                  onClick={handleImport}
                  disabled={!selectedFile}
                  className="w-full py-4 bg-primary text-white rounded-xl font-bold transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Import Library
                </button>
                <button
                  onClick={handleClose}
                  className="mt-3 w-full text-muted-foreground text-sm hover:text-foreground transition-colors py-2"
                >
                  Cancel
                </button>
              </>
            )}

            {/* ── Uploading ── */}
            {state === 'uploading' && (
              <div className="text-center py-4">
                <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-6">
                  <Loader2 className="animate-spin text-primary" size={28} />
                </div>
                <h2 className="text-xl font-bold mb-2">Importing Library…</h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Uploading <span className="font-mono text-xs">{selectedFile?.name}</span>,
                  parsing tracks, and writing to your cloud library. This may take a moment.
                </p>
              </div>
            )}

            {/* ── Success ── */}
            {state === 'success' && result && (
              <div className="text-center">
                <div className="w-16 h-16 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
                  <CheckCircle2 className="text-emerald-400" size={28} />
                </div>
                <h2 className="text-xl font-bold mb-1">Library Imported!</h2>
                <p className="text-sm text-muted-foreground mb-5">
                  <code className="font-mono text-xs">{result.source_filename}</code> imported
                  successfully.
                </p>

                <div className="grid grid-cols-3 gap-2 mb-5">
                  {[
                    { label: 'Tracks', value: result.track_count.toLocaleString() },
                    { label: 'Playlists', value: result.playlist_count },
                    { label: 'Placements', value: result.playlist_track_count.toLocaleString() },
                  ].map(({ label, value }) => (
                    <div key={label} className="glass rounded-xl p-3">
                      <p className="text-lg font-black font-mono">{value}</p>
                      <p className="text-[9px] uppercase tracking-widest text-muted-foreground font-bold mt-0.5">
                        {label}
                      </p>
                    </div>
                  ))}
                </div>

                {result.playlists.length > 0 && (
                  <div className="text-left mb-5 max-h-40 overflow-y-auto space-y-1 pr-1">
                    {result.playlists.map((pl) => (
                      <div
                        key={pl.name}
                        className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-[var(--color-surface)]"
                      >
                        <span className="text-xs font-medium truncate">{pl.name}</span>
                        <span className="text-[10px] font-mono text-muted-foreground shrink-0 ml-2">
                          {pl.track_count}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                <button
                  onClick={handleDone}
                  className="w-full py-4 bg-primary text-white rounded-xl font-bold transition-all active:scale-95"
                >
                  Done
                </button>
              </div>
            )}

            {/* ── Error ── */}
            {state === 'error' && (
              <div className="text-center">
                <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
                  <AlertCircle className="text-red-400" size={28} />
                </div>
                <h2 className="text-xl font-bold mb-2">Import Failed</h2>
                <p className="text-sm text-muted-foreground leading-relaxed px-2">
                  {errorMessage}
                </p>
                <div className="flex gap-3 mt-6">
                  <button
                    onClick={reset}
                    className="flex-1 py-3 bg-primary text-white rounded-xl font-bold transition-all active:scale-95"
                  >
                    Try Again
                  </button>
                  <button
                    onClick={handleClose}
                    className="flex-1 py-3 glass rounded-xl font-bold text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
