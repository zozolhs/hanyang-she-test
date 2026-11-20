-- TEST V24: Only the server-validated super administrator may permanently remove
-- a non-super account. Audit is kept after deletion; sessions cascade immediately.
BEGIN;

CREATE TABLE IF NOT EXISTS public.she_v24_account_deletion_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  deleted_account_id uuid NOT NULL,
  login_id text NOT NULL,
  display_name text NOT NULL,
  deleted_by uuid NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE public.she_v24_account_deletion_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.she_v24_account_deletion_log FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.she_v24_account_deletion_log_id_seq FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.she_v24_account_deletion_log TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.she_v24_account_deletion_log_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.she_v24_delete_account(
  p_actor_id uuid,
  p_target_id uuid,
  p_expected_login_id text
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY INVOKER
SET search_path = ''
AS $fn$
DECLARE
  actor_role text;
  actor_status text;
  deleted_id uuid;
  deleted_login text;
  deleted_name text;
BEGIN
  IF p_actor_id IS NULL OR p_target_id IS NULL OR p_expected_login_id IS NULL OR
     p_actor_id = p_target_id OR length(p_expected_login_id) > 32 OR
     p_expected_login_id !~ '^[a-z0-9][a-z0-9._-]{3,31}$' THEN
    RETURN jsonb_build_object('status','invalid');
  END IF;

  SELECT a.role, a.status INTO actor_role, actor_status
    FROM public.she_v24_accounts AS a WHERE a.id = p_actor_id;
  IF NOT FOUND OR actor_role IS DISTINCT FROM 'super_admin' OR actor_status IS DISTINCT FROM 'approved' THEN
    RETURN jsonb_build_object('status','forbidden');
  END IF;

  -- The login ID supplied in the confirmation dialog must still match the
  -- account being deleted. Never delete the active or any super-admin account.
  DELETE FROM public.she_v24_accounts AS a
    WHERE a.id = p_target_id
      AND a.login_id = p_expected_login_id
      AND a.role <> 'super_admin'
    RETURNING a.id, a.login_id, a.display_name
      INTO deleted_id, deleted_login, deleted_name;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','not_found');
  END IF;

  INSERT INTO public.she_v24_account_deletion_log
    (deleted_account_id, login_id, display_name, deleted_by)
  VALUES
    (deleted_id, deleted_login, deleted_name, p_actor_id);

  -- Existing she_v24_sessions(account_id) FK ON DELETE CASCADE
  -- atomically removes all tokens for the deleted account.
  RETURN jsonb_build_object('status','deleted','login_id',deleted_login);
END;
$fn$;

REVOKE ALL ON FUNCTION public.she_v24_delete_account(uuid,uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.she_v24_delete_account(uuid,uuid,text)
  TO service_role;

COMMIT;
