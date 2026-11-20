-- HANYANG SHE V24 TEST / account lockout atomic increment.
-- Does not modify V23 tables, functions, policies, or user records.
-- Execute in HANYANG-SHE-TEST SQL Editor before deploying she-v24-auth.
BEGIN;
CREATE OR REPLACE FUNCTION public.she_v24_record_failed_login(p_account_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  UPDATE public.she_v24_accounts
  SET failed_attempts = CASE
        WHEN locked_until IS NOT NULL AND locked_until <= now() THEN 1
        ELSE least(failed_attempts + 1, 10)
      END,
      locked_until = CASE
        WHEN (CASE
          WHEN locked_until IS NOT NULL AND locked_until <= now() THEN 1
          ELSE failed_attempts + 1 END) >= 5
          THEN now() + interval '15 minutes'
        ELSE NULL
      END,
      updated_at = now()
  WHERE id = p_account_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.she_v24_record_failed_login(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.she_v24_record_failed_login(uuid) TO service_role;
COMMIT;
