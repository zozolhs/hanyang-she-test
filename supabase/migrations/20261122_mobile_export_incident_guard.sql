-- SHE TEST V24: record authenticated, detected mobile spreadsheet-export
-- attempts. Existing login, approval, module rights, Excel imports and PC exports
-- are unchanged. This is a session/account abuse counter, not device attestation.
BEGIN;

CREATE TABLE IF NOT EXISTS public.she_v24_mobile_export_incidents (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.she_v24_accounts(id) ON DELETE CASCADE,
  session_id uuid REFERENCES public.she_v24_sessions(id) ON DELETE SET NULL,
  export_key text NOT NULL CHECK (export_key IN (
    'risk_template_excel','roster_excel','roster_audit_csv',
    'education_match_csv','iris_match_csv','education_batch_csv',
    'education_report_csv','education_generic_csv','health_excel',
    'onepage_excel'
  )),
  detected_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS she_v24_mobile_export_by_account
  ON public.she_v24_mobile_export_incidents(account_id, detected_at DESC);
ALTER TABLE public.she_v24_mobile_export_incidents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.she_v24_mobile_export_incidents FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.she_v24_mobile_export_incidents TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.she_v24_mobile_export_incidents_id_seq TO service_role;

-- Server-only atomic enforcement, verified against the current account/session.
-- One detected attempt revokes only its session; 3 within 24 hours additionally
-- suspend the account for 60 minutes and revoke every active session.
-- The suspension is temporary, including for the sole super-admin, so that an
-- untrusted/forged browser signal cannot permanently lock out all administrators.
CREATE OR REPLACE FUNCTION public.she_v24_report_mobile_export(
  p_account_id uuid, p_session_id uuid, p_export_key text
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = ''
AS $body$
DECLARE
  account_status text;
  session_found uuid;
  incident_count integer;
  lock_time timestamptz;
  now_at timestamptz := clock_timestamp();
BEGIN
  IF p_account_id IS NULL OR p_session_id IS NULL OR
     p_export_key NOT IN (
       'risk_template_excel','roster_excel','roster_audit_csv',
       'education_match_csv','iris_match_csv','education_batch_csv',
       'education_report_csv','education_generic_csv','health_excel',
       'onepage_excel'
     ) THEN
    RETURN jsonb_build_object('status','invalid');
  END IF;
  -- Serialize incident counts and session revocations per account.
  SELECT status INTO account_status FROM public.she_v24_accounts
   WHERE id=p_account_id FOR UPDATE;
  IF account_status IS DISTINCT FROM 'approved' THEN
    RETURN jsonb_build_object('status','forbidden');
  END IF;
  SELECT id INTO session_found FROM public.she_v24_sessions
   WHERE id=p_session_id AND account_id=p_account_id
     AND revoked_at IS NULL AND expires_at>now_at FOR UPDATE;
  IF session_found IS NULL THEN
    RETURN jsonb_build_object('status','invalid_session');
  END IF;
  INSERT INTO public.she_v24_mobile_export_incidents(account_id,session_id,export_key)
    VALUES (p_account_id,p_session_id,p_export_key);
  SELECT count(*) INTO incident_count
    FROM public.she_v24_mobile_export_incidents
    WHERE account_id=p_account_id
      AND detected_at >= now_at - interval '24 hours';

  IF incident_count >= 3 THEN
    lock_time := now_at + interval '60 minutes';
    UPDATE public.she_v24_accounts
       SET locked_until=greatest(coalesce(locked_until,now_at),lock_time),
           updated_at=now_at
     WHERE id=p_account_id;
    UPDATE public.she_v24_sessions SET revoked_at=now_at
     WHERE account_id=p_account_id AND revoked_at IS NULL;
  ELSE
    UPDATE public.she_v24_sessions SET revoked_at=now_at
     WHERE id=p_session_id AND revoked_at IS NULL;
  END IF;

  -- Keep the incident ledger bounded without exposing a public maintenance API.
  IF random()<0.01 THEN
    DELETE FROM public.she_v24_mobile_export_incidents
      WHERE detected_at < now_at - interval '30 days';
  END IF;
  RETURN jsonb_build_object('status',CASE WHEN incident_count>=3 THEN 'locked' ELSE 'session_revoked' END,
                            'count',incident_count,
                            'locked_until',CASE WHEN incident_count>=3 THEN lock_time ELSE NULL END);
END;
$body$;

REVOKE ALL ON FUNCTION public.she_v24_report_mobile_export(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.she_v24_report_mobile_export(uuid,uuid,text) TO service_role;
COMMIT;
