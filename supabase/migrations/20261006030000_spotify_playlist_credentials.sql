-- Server-only Spotify OAuth credentials used to refresh playlist access.
-- Values are encrypted before they leave the DropDex backend and are never
-- readable through an authenticated client policy.

ALTER TABLE public.user_external_accounts
  ADD COLUMN IF NOT EXISTS access_token_ciphertext text,
  ADD COLUMN IF NOT EXISTS refresh_token_ciphertext text,
  ADD COLUMN IF NOT EXISTS token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS granted_scopes text[] NOT NULL DEFAULT '{}';

DROP POLICY IF EXISTS "external_accounts: select own" ON public.user_external_accounts;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.user_external_accounts FROM authenticated;
