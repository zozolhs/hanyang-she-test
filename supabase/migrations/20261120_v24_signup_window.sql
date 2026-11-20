-- V24 TEST: highest administrator controls a temporary public signup window.
BEGIN;
CREATE TABLE IF NOT EXISTS public.she_v24_signup_config (
  id text PRIMARY KEY CHECK (id='main'),
  enabled_until timestamptz NULL,
  changed_by uuid NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.she_v24_signup_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.she_v24_signup_config FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON TABLE public.she_v24_signup_config TO service_role;
INSERT INTO public.she_v24_signup_config(id,enabled_until) VALUES('main',NULL) ON CONFLICT(id) DO NOTHING;
COMMIT;
