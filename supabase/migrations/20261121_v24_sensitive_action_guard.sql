-- Additional V24 defense against stolen-session password-guessing.
-- Shares the existing server-only atomic throttle table; does not change login
-- credentials, member approval, business privileges, or workbook processing.
BEGIN;
CREATE OR REPLACE FUNCTION public.she_v24_allow_password_change(p_account_id uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = ''
AS $body$
DECLARE
  period timestamptz := to_timestamp(floor(extract(epoch FROM clock_timestamp()) / 300) * 300);
  count_after integer;
BEGIN
  IF p_account_id IS NULL THEN RETURN false; END IF;
  INSERT INTO public.she_v24_login_throttle(bucket_key,window_start,attempts,updated_at)
  VALUES('password-change:'||md5(p_account_id::text),period,1,clock_timestamp())
  ON CONFLICT(bucket_key,window_start) DO UPDATE
    SET attempts=public.she_v24_login_throttle.attempts+1,
        updated_at=clock_timestamp()
    WHERE public.she_v24_login_throttle.attempts < 30
  RETURNING attempts INTO count_after;
  RETURN count_after IS NOT NULL;
END;
$body$;
REVOKE ALL ON FUNCTION public.she_v24_allow_password_change(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.she_v24_allow_password_change(uuid) TO service_role;
COMMIT;
