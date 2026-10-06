-- Persist verified third-party account links. Encrypted OAuth credentials for
-- playlist access are added by the follow-up 20261006030000 migration.

CREATE TABLE IF NOT EXISTS public.user_external_accounts (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider            text        NOT NULL CHECK (provider IN ('spotify')),
  provider_account_id text,
  display_name        text,
  profile_url         text,
  status              text        NOT NULL DEFAULT 'failed'
                                  CHECK (status IN ('pending', 'linked', 'failed')),
  failure_reason      text,
  linked_at           timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider),
  UNIQUE (provider, provider_account_id)
);

DROP TRIGGER IF EXISTS trg_user_external_accounts_updated_at
  ON public.user_external_accounts;
CREATE TRIGGER trg_user_external_accounts_updated_at
  BEFORE UPDATE ON public.user_external_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.user_external_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "external_accounts: select own" ON public.user_external_accounts;
CREATE POLICY "external_accounts: select own"
  ON public.user_external_accounts FOR SELECT TO authenticated
  USING (user_id = auth.uid());

REVOKE INSERT, UPDATE, DELETE ON public.user_external_accounts FROM authenticated;
