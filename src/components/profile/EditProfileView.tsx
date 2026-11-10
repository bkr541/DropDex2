import { useState, useRef, useEffect, type ChangeEvent } from 'react';
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
import { AlignLeft, AtSign, Cloud, Globe, Instagram, Refresh, Spotify, Tiktok, Upload, Xmark, Youtube } from 'iconoir-react/regular';
import { ControlButton, FormField, SearchControl, TextareaControl, TextControl } from '../ui/controls';
import { Avatar } from '../ui/display';
import { NoticeCard } from '../ui/feedback';

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
    <section className="space-y-3">
      <h2 className="profile-heading justify-between">
        {label}
        <span className="profile-preference-count">{selected.length}/{maxItems}</span>
      </h2>

      {/* Search input */}
      {!atMax && (
        <div className="relative">
          <SearchControl
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 150)}
            placeholder={placeholder}
            aria-label={placeholder}
          />

          {showDropdown && (
            <div
              className="dd-autocomplete__list"
              onMouseDown={(e) => e.preventDefault()}
            >
              {results.map((r) => {
                const alreadySelected = selected.some((s) => s.id === r.id);
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => void handleAdd(r)}
                    disabled={busy || alreadySelected}
                    className="dd-autocomplete__option"
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
        <p className="text-xs text-muted-foreground">Max {maxItems} selected.</p>
      )}

      {/* Selected chips */}
      {selected.length > 0 && (
        <div className="dd-chip-list" aria-label={label}>
          {selected.map((item) => (
            <span
              key={item.id}
              className="dd-chip"
            >
              {item.name}
              <button
                type="button"
                onClick={() => void handleRemove(item.id)}
                disabled={busy}
                aria-label={`Remove ${item.name}`}
              >
                <Xmark width={14} height={14} aria-hidden="true" />
              </button>
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
  const [tiktokUrl, setTiktokUrl] = useState(existingProfile?.tiktok_url ?? '');
  const [youtubeUrl, setYoutubeUrl] = useState(existingProfile?.youtube_url ?? '');
  const [websiteUrl, setWebsiteUrl] = useState(existingProfile?.website_url ?? '');

  // Avatar
  const [pendingAvatar, setPendingAvatar] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Preferences
  const [selectedGenres, setSelectedGenres] = useState<UserGenrePreference[]>([]);
  const [selectedArtists, setSelectedArtists] = useState<UserArtistPreference[]>([]);

  // Save state
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const displayedAvatar = avatarPreview ?? existingProfile?.avatar_url ?? null;

  // Load preferences on mount
  useEffect(() => {
    Promise.all([fetchUserGenres(userId), fetchUserArtists(userId)])
      .then(([g, a]) => { setSelectedGenres(g); setSelectedArtists(a); })
      .catch(() => {});
  }, [userId]);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    setSaveError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    if (!ACCEPTED_TYPES.includes(file.type)) { setSaveError('Please select a JPEG, PNG, WebP, or GIF image.'); return; }
    if (file.size > MAX_FILE_SIZE) { setSaveError('Image must be smaller than 10 MB.'); return; }
    setPendingAvatar(file);
    setAvatarPreview(URL.createObjectURL(file));
  };

  const handleSave = async () => {
    if (!displayName.trim()) { setSaveError('Display name is required.'); return; }
    setSaving(true); setSaveError(null);
    try {
      const updates: Partial<Omit<UserProfile, 'user_id' | 'created_at' | 'updated_at'>> = {
        display_name: displayName.trim(),
        username: username.trim() || null,
        bio: bio.trim() || null,
        spotify_url: spotifyUrl.trim() || null,
        soundcloud_url: soundcloudUrl.trim() || null,
        instagram_url: instagramUrl.trim() || null,
        tiktok_url: tiktokUrl.trim() || null,
        youtube_url: youtubeUrl.trim() || null,
        website_url: websiteUrl.trim() || null,
      };
      if (pendingAvatar) updates.avatar_url = await uploadAvatar(userId, pendingAvatar);
      const result = await upsertUserProfile(userId, updates);
      setPendingAvatar(null); onSaved(result);
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

  const isDirty =
    displayName !== (existingProfile?.display_name ?? '') ||
    username !== (existingProfile?.username ?? '') ||
    bio !== (existingProfile?.bio ?? '') ||
    spotifyUrl !== (existingProfile?.spotify_url ?? '') ||
    soundcloudUrl !== (existingProfile?.soundcloud_url ?? '') ||
    instagramUrl !== (existingProfile?.instagram_url ?? '') ||
    tiktokUrl !== (existingProfile?.tiktok_url ?? '') ||
    youtubeUrl !== (existingProfile?.youtube_url ?? '') ||
    websiteUrl !== (existingProfile?.website_url ?? '') ||
    pendingAvatar !== null;

  return (
    <div className="profile-stack">

      {/* ── Identity row ── */}
      <section className="lgh profile-identity-hero" aria-label="Identity">
        <span aria-hidden="true" className="lgh-watermark">{displayName.trim() || 'Profile'}</span>
        <div className="profile-identity">
          <div className="flex flex-col items-center gap-5">
            <div className="relative flex">
              <span className="lgh-ring" aria-hidden="true" />
              <Avatar src={displayedAvatar} alt="Profile avatar" className="lgh-avatar" />
            </div>
            <ControlButton variant="secondary" onClick={() => fileInputRef.current?.click()} aria-label="Choose profile avatar">
              <Upload width={14} height={14} aria-hidden="true" />
              {pendingAvatar ? 'Change' : existingProfile?.avatar_url ? 'Replace' : 'Upload'}
            </ControlButton>
            <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={handleFileChange} />
          </div>

          <div className="profile-identity-fields">
            <FormField label="Display Name" required>
              {({ id }) => (
                <TextControl
                  id={id}
                  required
                  icon={null}
                  className="profile-identity-name"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Your artist name"
                  maxLength={120}
                />
              )}
            </FormField>

            <FormField label="Username">
              {({ id }) => (
                <TextControl
                  id={id}
                  icon={<AtSign width={17} height={17} aria-hidden="true" />}
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="@yourhandle"
                  maxLength={60}
                />
              )}
            </FormField>

            <FormField label="Bio">
              {({ id }) => (
                <TextareaControl
                  id={id}
                  icon={<AlignLeft width={17} height={17} aria-hidden="true" />}
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="Tell people about your sound…"
                  rows={2}
                  maxLength={500}
                  className="resize-none"
                />
              )}
            </FormField>
          </div>
        </div>
      </section>

      {/* ── Genres + Artists ── */}
      <div className="profile-group profile-preference-grid">
        <PreferencePicker
          label="Genres"
          placeholder="Search genres…"
          selected={genreItems}
          maxItems={5}
          onSearch={searchGenres}
          onAdd={handleAddGenre}
          onRemove={handleRemoveGenre}
        />
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

      {/* ── Social links ── */}
      <section className="profile-group">
        <h2 className="profile-heading"><Globe width={14} height={14} aria-hidden="true" />Social Links</h2>
        <div className="profile-fields">
          {[
            { label: 'Spotify', value: spotifyUrl, set: setSpotifyUrl, placeholder: 'https://open.spotify.com/artist/…', icon: <Spotify width={16} height={16} aria-hidden="true" /> },
            { label: 'SoundCloud', value: soundcloudUrl, set: setSoundcloudUrl, placeholder: 'https://soundcloud.com/…', icon: <Cloud width={16} height={16} aria-hidden="true" /> },
            { label: 'Instagram', value: instagramUrl, set: setInstagramUrl, placeholder: 'https://instagram.com/…', icon: <Instagram width={16} height={16} aria-hidden="true" /> },
            { label: 'TikTok', value: tiktokUrl, set: setTiktokUrl, placeholder: 'https://tiktok.com/@…', icon: <Tiktok width={16} height={16} aria-hidden="true" /> },
            { label: 'YouTube', value: youtubeUrl, set: setYoutubeUrl, placeholder: 'https://youtube.com/…', icon: <Youtube width={16} height={16} aria-hidden="true" /> },
            { label: 'Website', value: websiteUrl, set: setWebsiteUrl, placeholder: 'https://yoursite.com', icon: <Globe width={16} height={16} aria-hidden="true" /> },
          ].map(({ label, value, set, placeholder, icon }) => (
            <FormField key={label} label={label}>
              {({ id }) => (
                <TextControl
                  id={id}
                  icon={icon}
                  type="url"
                  value={value}
                  onChange={(e) => set(e.target.value)}
                  placeholder={placeholder}
                />
              )}
            </FormField>
          ))}
        </div>
      </section>

      <div className="profile-footer">
        {saveError && <NoticeCard tone="error" className="w-full">{saveError}</NoticeCard>}
        {(isDirty || saving) && (
          <ControlButton onClick={handleSave} disabled={saving} variant="primary">
            {saving ? <><Refresh width={13} height={13} aria-hidden="true" className="animate-spin" /> Saving…</>
              : <><Upload width={13} height={13} aria-hidden="true" /> Save Profile</>}
          </ControlButton>
        )}
      </div>
    </div>
  );
}
