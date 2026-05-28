import { useState, useRef, useEffect, type ChangeEvent } from 'react';
import { Loader2, Upload, Check, User, X, Search } from 'lucide-react';
import { cn } from '../../lib/utils';
import { uploadAvatar } from '../../lib/queries/storage';
import { upsertUserProfile } from '../../lib/queries/userProfile';
import {
  fetchUserGenres,
  fetchUserArtists,
  upsertUserGenre,
  deleteUserGenre,
  upsertUserArtist,
  deleteUserArtist,
  searchGenres,
  searchArtistsByName,
} from '../../lib/queries/userPreferences';
import type { UserProfile, UserGenrePreference, UserArtistPreference } from '../../types';

// ── Preference picker (genres or artists) ────────────────────────────────────

interface PickerItem { id: string; name: string; }

interface PreferencePickerProps {
  label: string;
  placeholder: string;
  selected: PickerItem[];
  maxItems: number;
  onSearch: (q: string) => Promise<PickerItem[]>;
  onAdd: (item: PickerItem) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}

function PreferencePicker({
  label,
  placeholder,
  selected,
  maxItems,
  onSearch,
  onAdd,
  onRemove,
}: PreferencePickerProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PickerItem[]>([]);
  const [focused, setFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  const showDropdown = focused && results.length > 0;

  useEffect(() => {
    if (query.length < 2) { setResults([]); return; }
    const t = setTimeout(async () => {
      try { setResults(await onSearch(query)); }
      catch { /* ignore */ }
    }, 200);
    return () => clearTimeout(t);
  }, [query, onSearch]);

  const handleAdd = async (item: PickerItem) => {
    if (selected.some((s) => s.id === item.id)) return;
    setBusy(true);
    try {
      await onAdd(item);
      setQuery('');
      setResults([]);
    } finally { setBusy(false); }
  };

  const handleRemove = async (id: string) => {
    setBusy(true);
    try { await onRemove(id); }
    finally { setBusy(false); }
  };

  const atMax = selected.length >= maxItems;

  return (
    <section className="space-y-1.5">
      <h3 className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground flex items-center justify-between">
        {label}
        <span className="opacity-50 font-mono">{selected.length}/{maxItems}</span>
      </h3>

      {/* Search input */}
      {!atMax && (
        <div className="relative">
          <div className="relative">
            <Search
              size={11}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setTimeout(() => setFocused(false), 150)}
              placeholder={placeholder}
              className="w-full bg-[var(--color-surface)] border border-[var(--color-border-subtle)] rounded-lg py-1.5 pl-7 pr-3 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 transition-all placeholder:text-muted-foreground/50"
            />
          </div>

          {showDropdown && (
            <div
              className="absolute top-full mt-0.5 left-0 right-0 z-50 bg-[var(--color-panel)] border border-[var(--color-border-subtle)] rounded-xl shadow-lg overflow-hidden max-h-44 overflow-y-auto"
              onMouseDown={(e) => e.preventDefault()}
            >
              {results.map((r) => {
                const alreadySelected = selected.some((s) => s.id === r.id);
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => { if (!alreadySelected) void handleAdd(r); }}
                    className={cn(
                      'w-full px-3 py-2 text-left text-xs font-medium transition-colors',
                      alreadySelected
                        ? 'text-muted-foreground cursor-default opacity-50'
                        : 'hover:bg-[var(--color-surface-hover)] text-foreground cursor-pointer',
                    )}
                  >
                    {r.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
      {atMax && (
        <p className="text-[9px] text-muted-foreground italic">Max {maxItems} selected.</p>
      )}

      {/* Selected chips */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.map((item) => (
            <span
              key={item.id}
              className="flex items-center gap-1 pl-1 pr-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-primary/10 text-primary border border-primary/15"
            >
              <button
                onClick={() => void handleRemove(item.id)}
                disabled={busy}
                className="flex items-center justify-center w-3 h-3 rounded-full hover:bg-primary/25 transition-colors"
                aria-label={`Remove ${item.name}`}
              >
                <X size={7} />
              </button>
              {item.name}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

interface EditProfileViewProps {
  userId: string;
  existingProfile: UserProfile | null;
  onPreferencesChanged: () => void;
  onSaved: (profile: UserProfile) => void;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];

export function EditProfileView({
  userId,
  existingProfile,
  onPreferencesChanged,
  onSaved,
}: EditProfileViewProps) {
  // Profile fields
  const [displayName, setDisplayName] = useState(existingProfile?.display_name ?? '');
  const [username, setUsername] = useState(existingProfile?.username ?? '');
  const [bio, setBio] = useState(existingProfile?.bio ?? '');
  const [spotifyUrl, setSpotifyUrl] = useState(existingProfile?.spotify_url ?? '');
  const [soundcloudUrl, setSoundcloudUrl] = useState(existingProfile?.soundcloud_url ?? '');
  const [instagramUrl, setInstagramUrl] = useState(existingProfile?.instagram_url ?? '');
  const [youtubeUrl, setYoutubeUrl] = useState(existingProfile?.youtube_url ?? '');
  const [websiteUrl, setWebsiteUrl] = useState(existingProfile?.website_url ?? '');

  // Avatar
  const [pendingAvatar, setPendingAvatar] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [imgError, setImgError] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Preferences
  const [selectedGenres, setSelectedGenres] = useState<UserGenrePreference[]>([]);
  const [selectedArtists, setSelectedArtists] = useState<UserArtistPreference[]>([]);

  // Save state
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const displayedAvatar = avatarPreview ?? existingProfile?.avatar_url ?? null;

  // Load preferences on mount
  useEffect(() => {
    Promise.all([fetchUserGenres(userId), fetchUserArtists(userId)])
      .then(([g, a]) => { setSelectedGenres(g); setSelectedArtists(a); })
      .catch(() => {});
  }, [userId]);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    setSaveError(null);
    setImgError(false);
    const file = e.target.files?.[0];
    if (!file) return;
    if (!ACCEPTED_TYPES.includes(file.type)) { setSaveError('Please select a JPEG, PNG, WebP, or GIF image.'); return; }
    if (file.size > MAX_FILE_SIZE) { setSaveError('Image must be smaller than 10 MB.'); return; }
    setPendingAvatar(file);
    setAvatarPreview(URL.createObjectURL(file));
    setSaved(false);
  };

  const handleSave = async () => {
    if (!displayName.trim()) { setSaveError('Display name is required.'); return; }
    setSaving(true); setSaveError(null); setSaved(false);
    try {
      const updates: Partial<Omit<UserProfile, 'user_id' | 'created_at' | 'updated_at'>> = {
        display_name: displayName.trim(),
        username: username.trim() || null,
        bio: bio.trim() || null,
        spotify_url: spotifyUrl.trim() || null,
        soundcloud_url: soundcloudUrl.trim() || null,
        instagram_url: instagramUrl.trim() || null,
        youtube_url: youtubeUrl.trim() || null,
        website_url: websiteUrl.trim() || null,
      };
      if (pendingAvatar) updates.avatar_url = await uploadAvatar(userId, pendingAvatar);
      const result = await upsertUserProfile(userId, updates);
      setSaved(true); setPendingAvatar(null); onSaved(result);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save. Please try again.');
    } finally { setSaving(false); }
  };

  // Genre handlers — positions are 1-indexed (DB: BETWEEN 1 AND 5)
  const handleAddGenre = async (item: { id: string; name: string }) => {
    const nextPos = selectedGenres.length === 0
      ? 1
      : Math.max(...selectedGenres.map((g) => g.position)) + 1;
    await upsertUserGenre(userId, item.id, nextPos);
    setSelectedGenres((prev) => [
      ...prev,
      { user_id: userId, genre_id: item.id, position: nextPos, created_at: new Date().toISOString(), genre: { id: item.id, name: item.name, normalized_name: '' } },
    ]);
    onPreferencesChanged();
  };

  const handleRemoveGenre = async (genreId: string) => {
    await deleteUserGenre(userId, genreId);
    setSelectedGenres((prev) => prev.filter((g) => g.genre_id !== genreId));
    onPreferencesChanged();
  };

  // Artist handlers — positions are 1-indexed (DB: BETWEEN 1 AND 10)
  const handleAddArtist = async (item: { id: string; name: string }) => {
    const nextPos = selectedArtists.length === 0
      ? 1
      : Math.max(...selectedArtists.map((a) => a.position)) + 1;
    await upsertUserArtist(userId, item.id, nextPos);
    setSelectedArtists((prev) => [
      ...prev,
      { user_id: userId, artist_id: item.id, position: nextPos, created_at: new Date().toISOString(), artist: { id: item.id, name: item.name, normalized_name: null, profile_image_url: null } },
    ]);
    onPreferencesChanged();
  };

  const handleRemoveArtist = async (artistId: string) => {
    await deleteUserArtist(userId, artistId);
    setSelectedArtists((prev) => prev.filter((a) => a.artist_id !== artistId));
    onPreferencesChanged();
  };

  const genreItems = selectedGenres.map((g) => ({ id: g.genre_id, name: g.genre?.name ?? '' }));
  const artistItems = selectedArtists.map((a) => ({ id: a.artist_id, name: a.artist?.name ?? '' }));

  return (
    <div className="space-y-3 md:max-w-3xl md:mx-auto">

      {/* ── Identity row ── */}
      <div className="flex gap-4 items-start">
        {/* Avatar */}
        <div className="shrink-0 flex flex-col items-center gap-1.5">
          <div className="w-20 h-20 rounded-full ring-4 ring-primary/25 shadow-lg bg-primary/10 flex items-center justify-center overflow-hidden">
            {displayedAvatar && !imgError ? (
              <img src={displayedAvatar} alt="Avatar" className="w-full h-full object-cover" onError={() => setImgError(true)} />
            ) : (
              <User size={32} className="text-primary/60" />
            )}
          </div>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1 px-2 py-1 rounded-lg border border-dashed border-[var(--color-border-subtle)] hover:border-primary/40 text-muted-foreground hover:text-primary text-[9px] font-bold uppercase tracking-widest transition-all"
          >
            <Upload size={10} />
            {pendingAvatar ? 'Change' : existingProfile?.avatar_url ? 'Replace' : 'Upload'}
          </button>
          <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={handleFileChange} />
        </div>

        {/* Name + Username + Bio */}
        <div className="flex-1 min-w-0 grid grid-cols-2 gap-x-3 gap-y-2">
          <div className="space-y-1">
            <label className="block text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
              Display Name <span className="text-primary">*</span>
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => { setDisplayName(e.target.value); setSaved(false); }}
              placeholder="Your artist name"
              maxLength={120}
              className="w-full bg-[var(--color-surface)] border border-[var(--color-border-subtle)] rounded-xl px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all placeholder:text-muted-foreground/50"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => { setUsername(e.target.value); setSaved(false); }}
              placeholder="@yourhandle"
              maxLength={60}
              className="w-full bg-[var(--color-surface)] border border-[var(--color-border-subtle)] rounded-xl px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all placeholder:text-muted-foreground/50"
            />
          </div>

          <div className="col-span-2 space-y-1">
            <label className="block text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Bio</label>
            <textarea
              value={bio}
              onChange={(e) => { setBio(e.target.value); setSaved(false); }}
              placeholder="Tell people about your sound…"
              rows={2}
              maxLength={500}
              className="w-full bg-[var(--color-surface)] border border-[var(--color-border-subtle)] rounded-xl px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all placeholder:text-muted-foreground/50 resize-none"
            />
          </div>
        </div>
      </div>

      {/* ── Social links ── */}
      <section className="space-y-1.5">
        <h3 className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground px-0.5">Social Links</h3>
        <div className="glass rounded-xl divide-y divide-[var(--color-border-faint)] overflow-hidden">
          {[
            { label: 'Spotify', value: spotifyUrl, set: setSpotifyUrl, placeholder: 'https://open.spotify.com/artist/…' },
            { label: 'SoundCloud', value: soundcloudUrl, set: setSoundcloudUrl, placeholder: 'https://soundcloud.com/…' },
            { label: 'Instagram', value: instagramUrl, set: setInstagramUrl, placeholder: 'https://instagram.com/…' },
            { label: 'YouTube', value: youtubeUrl, set: setYoutubeUrl, placeholder: 'https://youtube.com/…' },
            { label: 'Website', value: websiteUrl, set: setWebsiteUrl, placeholder: 'https://yoursite.com' },
          ].map(({ label, value, set, placeholder }) => (
            <div key={label} className="px-3 py-1.5 flex items-center gap-3">
              <p className="text-[9px] uppercase font-bold tracking-widest text-muted-foreground w-18 shrink-0">{label}</p>
              <input
                type="url"
                value={value}
                onChange={(e) => { set(e.target.value); setSaved(false); }}
                placeholder={placeholder}
                className="flex-1 bg-transparent text-xs font-mono focus:outline-none placeholder:text-muted-foreground/40 text-foreground min-w-0"
              />
            </div>
          ))}
        </div>
      </section>

      {/* ── Genres + Artists ── */}
      <div className="grid grid-cols-2 gap-3">
        <div className="glass rounded-xl p-3">
          <PreferencePicker
            label="Genres"
            placeholder="Search genres…"
            selected={genreItems}
            maxItems={5}
            onSearch={searchGenres}
            onAdd={handleAddGenre}
            onRemove={handleRemoveGenre}
          />
        </div>
        <div className="glass rounded-xl p-3">
          <PreferencePicker
            label="Favorite Artists"
            placeholder="Search artists…"
            selected={artistItems}
            maxItems={10}
            onSearch={searchArtistsByName}
            onAdd={handleAddArtist}
            onRemove={handleRemoveArtist}
          />
        </div>
      </div>

      {/* ── Save ── */}
      <div className="flex items-center gap-3">
        {saveError && <p className="text-xs text-red-400 font-medium">{saveError}</p>}
        <button
          onClick={handleSave}
          disabled={saving}
          className={cn(
            'flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs uppercase tracking-widest transition-all active:scale-95 ml-auto',
            saved
              ? 'bg-green-500/15 text-green-400 border border-green-500/30'
              : 'bg-primary text-white hover:bg-primary/90 shadow-sm',
            saving && 'opacity-60 cursor-not-allowed',
          )}
        >
          {saving ? <><Loader2 size={13} className="animate-spin" /> Saving…</>
            : saved ? <><Check size={13} /> Saved</>
            : 'Save Profile'}
        </button>
      </div>
    </div>
  );
}
