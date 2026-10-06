-- Add TikTok to the authenticated user's social profile links.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS tiktok_url text;
