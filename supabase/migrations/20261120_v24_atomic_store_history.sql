-- V24 integrated TEST portal: atomic optimistic update plus internal rollback history.
-- Existing hanyang_safety_store rows and V23 policies remain unchanged.
BEGIN;
CREATE TABLE IF NOT EXISTS public.she_v24_store_history (
  history_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  store_id text NOT NULL,
  actor_id uuid NOT NULL,
  previous_row jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.she_v24_store_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.she_v24_store_history FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.she_v24_store_history_history_id_seq FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.she_v24_store_history TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.she_v24_store_history_history_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.she_v24_cas_update_store(
  p_id text, p_expected_updated_at timestamptz,
  p_documents jsonb, p_items jsonb, p_users jsonb, p_actor uuid
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  prior jsonb;
  previous_time timestamptz;
  new_time timestamptz;
BEGIN
  IF p_id IS NULL OR p_expected_updated_at IS NULL OR p_actor IS NULL
     OR jsonb_typeof(p_documents) <> 'array'
     OR jsonb_typeof(p_items) <> 'array'
     OR jsonb_typeof(p_users) <> 'array' THEN
    RETURN jsonb_build_object('status','invalid');
  END IF;

  SELECT to_jsonb(r) INTO prior
  FROM public.hanyang_safety_store r
  WHERE r.id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','not_found');
  END IF;
  previous_time := (prior->>'updated_at')::timestamptz;
  IF previous_time IS DISTINCT FROM p_expected_updated_at THEN
    RETURN jsonb_build_object('status','conflict');
  END IF;

  INSERT INTO public.she_v24_store_history (store_id, actor_id, previous_row)
    VALUES (p_id, p_actor, prior);

  UPDATE public.hanyang_safety_store SET
    documents = p_documents,
    items = p_items,
    users = p_users,
    updated_at = greatest(clock_timestamp(), previous_time + interval '1 microsecond')
  WHERE id = p_id RETURNING updated_at INTO new_time;

  RETURN jsonb_build_object('status','ok','id',p_id,'updated_at',new_time);
END;
$function$;
REVOKE ALL ON FUNCTION public.she_v24_cas_update_store(text,timestamptz,jsonb,jsonb,jsonb,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.she_v24_cas_update_store(text,timestamptz,jsonb,jsonb,jsonb,uuid)
  TO service_role;
COMMIT;
