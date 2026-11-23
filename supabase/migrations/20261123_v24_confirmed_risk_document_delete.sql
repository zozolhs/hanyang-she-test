-- Explicit, ID-scoped risk document deletion after UI confirmation.
-- General snapshot writes still reject large losses and missing documents.
-- The authenticated V24 store gateway is the sole authorized caller.
CREATE OR REPLACE FUNCTION public.she_v24_delete_safety_document(p_actor uuid, p_document_id text, p_expected_title text, p_expected_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  meta public.hanyang_safety_store%ROWTYPE;
  old_chunk public.hanyang_safety_store%ROWTYPE;
  target_document jsonb;
  old_items jsonb := '[]'::jsonb;
  remaining_items jsonb := '[]'::jsonb;
  remaining_docs jsonb := '[]'::jsonb;
  chunk_items jsonb;
  original_total integer;
  remaining_count integer;
  removed_count integer;
  old_chunk_count integer;
  new_chunk_count integer;
  actual_chunk_count integer;
  row_id text;
  i integer;
BEGIN
  IF p_actor IS NULL OR p_document_id IS NULL OR
     length(p_document_id) NOT BETWEEN 1 AND 120 OR
     p_expected_title IS NULL OR length(p_expected_title) NOT BETWEEN 1 AND 220 OR
     p_expected_at IS NULL THEN
    RETURN jsonb_build_object('status','invalid');
  END IF;
  -- Protect the same lock order used by atomic workbook imports. An
  -- in-progress upload/edit cannot race a confirmed delete.
  PERFORM 1 FROM public.hanyang_safety_store
    WHERE id='main_v10_meta' OR id~'^main_v10_chunk_[0-9]+$'
    ORDER BY id FOR UPDATE;
  SELECT * INTO meta FROM public.hanyang_safety_store
    WHERE id='main_v10_meta';
  IF NOT FOUND THEN RETURN jsonb_build_object('status','not_found'); END IF;
  IF meta.updated_at IS DISTINCT FROM p_expected_at THEN
    RETURN jsonb_build_object('status','conflict');
  END IF;
  IF jsonb_typeof(meta.documents) <> 'array' OR
     jsonb_typeof(meta.items) <> 'array' THEN
    RETURN jsonb_build_object('status','integrity');
  END IF;
  SELECT d.value INTO target_document
    FROM jsonb_array_elements(meta.documents) d(value)
    WHERE d.value->>'id'=p_document_id
    LIMIT 1;
  IF target_document IS NULL THEN RETURN jsonb_build_object('status','not_found'); END IF;
  IF target_document->>'title' IS DISTINCT FROM p_expected_title THEN
    RETURN jsonb_build_object('status','conflict');
  END IF;
  SELECT COALESCE(jsonb_agg(e.value ORDER BY
     substring(s.id FROM '[0-9]+$')::integer,e.ordinality),'[]'::jsonb)
    INTO old_items
    FROM public.hanyang_safety_store s
    CROSS JOIN LATERAL jsonb_array_elements(s.items)
      WITH ORDINALITY e(value,ordinality)
    WHERE s.id~'^main_v10_chunk_[0-9]+$';
  original_total:=COALESCE((meta.items->0->>'totalItems')::integer,-1);
  IF original_total <> jsonb_array_length(old_items) THEN
    RETURN jsonb_build_object('status','integrity');
  END IF;
  SELECT COALESCE(jsonb_agg(e.value ORDER BY e.ordinality),'[]'::jsonb)
    INTO remaining_items
    FROM jsonb_array_elements(old_items) WITH ORDINALITY e(value,ordinality)
    WHERE e.value->>'docId' IS DISTINCT FROM p_document_id;
  remaining_count:=jsonb_array_length(remaining_items);
  removed_count:=original_total-remaining_count;
  SELECT COALESCE(jsonb_agg(e.value ORDER BY e.ordinality),'[]'::jsonb)
    INTO remaining_docs
    FROM jsonb_array_elements(meta.documents) WITH ORDINALITY e(value,ordinality)
    WHERE e.value->>'id' IS DISTINCT FROM p_document_id;
  IF jsonb_array_length(remaining_docs)<>jsonb_array_length(meta.documents)-1 THEN
    RETURN jsonb_build_object('status','integrity');
  END IF;
  old_chunk_count:=COALESCE((meta.items->0->>'chunkCount')::integer,0);
  new_chunk_count:=CEIL(remaining_count::numeric/800)::integer;
  SELECT count(*) INTO actual_chunk_count FROM public.hanyang_safety_store
    WHERE id~'^main_v10_chunk_[0-9]+$';
  IF actual_chunk_count < old_chunk_count OR old_chunk_count>25 OR
     new_chunk_count>25 THEN
    RETURN jsonb_build_object('status','integrity');
  END IF;
  -- This is the only route that may intentionally remove a named document.
  -- Every changed row is recorded in the existing rollback history first.
  FOR i IN 0..GREATEST(old_chunk_count,new_chunk_count)-1 LOOP
    row_id:='main_v10_chunk_'||i;
    SELECT COALESCE(jsonb_agg(e.value ORDER BY e.ordinality),'[]'::jsonb)
      INTO chunk_items FROM jsonb_array_elements(remaining_items)
      WITH ORDINALITY e(value,ordinality)
      WHERE e.ordinality>i*800 AND e.ordinality<=(i+1)*800;
    SELECT * INTO old_chunk FROM public.hanyang_safety_store
      WHERE id=row_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('status','integrity'); END IF;
    INSERT INTO public.she_v24_store_history(store_id,actor_id,previous_row)
      VALUES(row_id,p_actor,to_jsonb(old_chunk));
    UPDATE public.hanyang_safety_store
      SET items=chunk_items,documents='[]'::jsonb,users='[]'::jsonb,
      updated_at=greatest(clock_timestamp(),old_chunk.updated_at+interval '1 microsecond')
      WHERE id=row_id;
  END LOOP;
  INSERT INTO public.she_v24_store_history(store_id,actor_id,previous_row)
    VALUES('main_v10_meta',p_actor,to_jsonb(meta));
  UPDATE public.hanyang_safety_store
    SET documents=remaining_docs,
    items=jsonb_build_array(meta.items->0 ||
      jsonb_build_object('totalItems',remaining_count,'chunkCount',new_chunk_count)),
    updated_at=greatest(clock_timestamp(),meta.updated_at+interval '1 microsecond')
    WHERE id='main_v10_meta';
  RETURN jsonb_build_object(
    'status','ok','deleted_document_id',p_document_id,
    'deleted_document_title',p_expected_title,
    'deleted_items',removed_count,'total_items',remaining_count,
    'document_count',jsonb_array_length(remaining_docs));
END;
$function$


REVOKE ALL ON FUNCTION public.she_v24_delete_safety_document(uuid,text,text,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.she_v24_delete_safety_document(uuid,text,text,timestamptz) TO service_role;
