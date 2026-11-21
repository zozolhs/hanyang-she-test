-- HANYANG SHE V24: prevent automated password guessing without changing the login UI or approval flow.
-- All limits are enforced atomically in Postgres, not in ephemeral Edge Function memory.
BEGIN;

CREATE TABLE IF NOT EXISTS public.she_v24_login_throttle (
  bucket_key text NOT NULL,
  window_start timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bucket_key, window_start)
);
ALTER TABLE public.she_v24_login_throttle ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.she_v24_login_throttle FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.she_v24_login_throttle TO service_role;

CREATE OR REPLACE FUNCTION public.she_v24_allow_login(p_login_id text)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = ''
AS $body$
DECLARE
  period timestamptz := to_timestamp(floor(extract(epoch FROM clock_timestamp()) / 300) * 300);
  count_after integer;
BEGIN
  IF p_login_id IS NULL OR length(p_login_id) NOT BETWEEN 4 AND 32 THEN
    RETURN false;
  END IF;

  -- Global bound also limits CPU-heavy password hashing for arbitrary unknown login IDs.
  INSERT INTO public.she_v24_login_throttle(bucket_key,window_start,attempts,updated_at)
  VALUES ('global',period,1,clock_timestamp())
  ON CONFLICT(bucket_key,window_start) DO UPDATE
    SET attempts=public.she_v24_login_throttle.attempts+1,updated_at=clock_timestamp()
    WHERE public.she_v24_login_throttle.attempts < 600
  RETURNING attempts INTO count_after;
  IF count_after IS NULL THEN RETURN false; END IF;

  count_after := NULL;
  -- Per-login-ID bound; stores only a one-way identifier hash (not the ID itself).
  INSERT INTO public.she_v24_login_throttle(bucket_key,window_start,attempts,updated_at)
  VALUES ('id:'||md5(p_login_id),period,1,clock_timestamp())
  ON CONFLICT(bucket_key,window_start) DO UPDATE
    SET attempts=public.she_v24_login_throttle.attempts+1,updated_at=clock_timestamp()
    WHERE public.she_v24_login_throttle.attempts < 12
  RETURNING attempts INTO count_after;

  -- Rare probabilistic cleanup keeps the table bounded without a new scheduler service.
  IF random() < 0.01 THEN
    DELETE FROM public.she_v24_login_throttle
    WHERE window_start < clock_timestamp() - interval '1 hour';
  END IF;
  RETURN count_after IS NOT NULL;
END;
$body$;

REVOKE ALL ON FUNCTION public.she_v24_allow_login(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.she_v24_allow_login(text) TO service_role;
COMMIT;
