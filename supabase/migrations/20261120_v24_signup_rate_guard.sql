-- V24 TEST: server-only registration rate cap.
-- Global cap protects against large public signup floods; approved accounts are unaffected.
BEGIN;
CREATE TABLE IF NOT EXISTS public.she_v24_signup_throttle (
  window_start timestamptz PRIMARY KEY,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts>=0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.she_v24_signup_throttle ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.she_v24_signup_throttle FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON TABLE public.she_v24_signup_throttle TO service_role;

CREATE OR REPLACE FUNCTION public.she_v24_allow_signup()
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=''
AS $body$
DECLARE current_attempts integer;
BEGIN
  INSERT INTO public.she_v24_signup_throttle (window_start,attempts,updated_at)
  VALUES (date_trunc('hour',now()),1,now())
  ON CONFLICT (window_start) DO UPDATE
    SET attempts = public.she_v24_signup_throttle.attempts + 1,
        updated_at=now()
    WHERE public.she_v24_signup_throttle.attempts < 30
  RETURNING attempts INTO current_attempts;
  RETURN current_attempts IS NOT NULL;
END;
$body$;
REVOKE ALL ON FUNCTION public.she_v24_allow_signup() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.she_v24_allow_signup() TO service_role;
COMMIT;
