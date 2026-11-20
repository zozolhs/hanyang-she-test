-- V24 TEST original index: atomic multi-row compare-and-swap for safety risk documents.
-- No insert/delete; all requested existing rows are locked and old versions saved before writing.
BEGIN;
CREATE OR REPLACE FUNCTION public.she_v24_cas_update_safety_batch(
  p_rows jsonb,
  p_actor uuid
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=''
AS $fn$
DECLARE
  item jsonb;
  old_record public.hanyang_safety_store%ROWTYPE;
  seen text[] := '{}';
  target_ids text[];
  target_id text;
  expected_at timestamptz;
  updated_at timestamptz;
  updated_rows jsonb := '[]'::jsonb;
  input_rows integer;
BEGIN
  IF p_actor IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RETURN jsonb_build_object('status','invalid');
  END IF;
  input_rows := jsonb_array_length(p_rows);
  IF input_rows < 1 OR input_rows > 20 THEN
    RETURN jsonb_build_object('status','invalid');
  END IF;
  SELECT array_agg(v->>'id' ORDER BY v->>'id') INTO target_ids
  FROM jsonb_array_elements(p_rows) v;
  FOR item IN SELECT e FROM jsonb_array_elements(p_rows) AS s(e) LOOP
    target_id := item->>'id';
    IF target_id IS NULL OR target_id !~ '^main_v10_(meta|chunk_(0|[1-9][0-9]{0,3}))$'
      OR target_id = ANY(seen)
      OR jsonb_typeof(item->'documents') <> 'array'
      OR jsonb_typeof(item->'items') <> 'array'
      OR jsonb_typeof(item->'users') <> 'array'
      OR item->>'expected_updated_at' IS NULL THEN
      RETURN jsonb_build_object('status','invalid');
    END IF;
    seen := array_append(seen,target_id);
  END LOOP;
  -- Every lock acquired in sorted order for deadlock avoidance.
  FOREACH target_id IN ARRAY target_ids LOOP
    SELECT * INTO old_record FROM public.hanyang_safety_store
      WHERE id=target_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('status','not_found','id',target_id); END IF;
    SELECT (r.value->>'expected_updated_at')::timestamptz
      INTO expected_at FROM jsonb_array_elements(p_rows) AS r(value)
      WHERE r.value->>'id'=target_id LIMIT 1;
    IF old_record.updated_at IS DISTINCT FROM expected_at THEN
      RETURN jsonb_build_object('status','conflict','id',target_id);
    END IF;
  END LOOP;
  FOREACH target_id IN ARRAY target_ids LOOP
    SELECT e INTO item FROM jsonb_array_elements(p_rows) AS s(e)
      WHERE e->>'id'=target_id LIMIT 1;
    SELECT * INTO old_record FROM public.hanyang_safety_store WHERE id=target_id;
    INSERT INTO public.she_v24_store_history(store_id,actor_id,previous_row)
      VALUES (target_id,p_actor,to_jsonb(old_record));
    UPDATE public.hanyang_safety_store SET
      documents=item->'documents',items=item->'items',users=item->'users',
      updated_at=greatest(clock_timestamp(),old_record.updated_at+interval '1 microsecond')
    WHERE id=target_id RETURNING hanyang_safety_store.updated_at INTO updated_at;
    updated_rows := updated_rows || jsonb_build_array(
      jsonb_build_object('id',target_id,'updated_at',updated_at));
  END LOOP;
  RETURN jsonb_build_object('status','ok','rows',updated_rows);
END;
$fn$;
REVOKE ALL ON FUNCTION public.she_v24_cas_update_safety_batch(jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.she_v24_cas_update_safety_batch(jsonb,uuid) TO service_role;
COMMIT;
