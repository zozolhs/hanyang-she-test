CREATE OR REPLACE FUNCTION public.she_v24_commit_safety_import(p_actor uuid, p_upload_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 part record;
 first_part public.she_v24_safety_import_parts%ROWTYPE;
 expected_part integer := 0;
 input_items jsonb := '[]'::jsonb;
 existing_items jsonb := '[]'::jsonb;
 prepared_items jsonb := '[]'::jsonb;
 kept_items jsonb := '[]'::jsonb;
 final_items jsonb := '[]'::jsonb;
 final_docs jsonb := '[]'::jsonb;
 amended_doc jsonb;
 prior_doc jsonb;
 prior_meta public.hanyang_safety_store%ROWTYPE;
 old_chunk public.hanyang_safety_store%ROWTYPE;
 part_items jsonb;
 effective_mode text;
 replaced_doc_ids text[] := ARRAY[]::text[];
 raw_import_count integer;
 doc_id text;
 doc_title text;
 rev_history jsonb;
 row_id text;
 upload_count integer;
 old_count integer;
 new_total integer;
 new_chunk_count integer;
 old_chunk_count integer;
 persist_chunk_count integer;
 i integer;
 tick timestamptz;
BEGIN
 IF p_actor IS NULL OR p_upload_id IS NULL THEN
  RETURN jsonb_build_object('status','invalid');
 END IF;
 SELECT * INTO first_part FROM public.she_v24_safety_import_parts
 WHERE actor_id=p_actor AND upload_id=p_upload_id AND part_index=0
   AND created_at>now()-interval '2 hours';
 IF NOT FOUND THEN RETURN jsonb_build_object('status','incomplete'); END IF;
 FOR part IN SELECT * FROM public.she_v24_safety_import_parts
  WHERE actor_id=p_actor AND upload_id=p_upload_id
  ORDER BY part_index
 LOOP
  IF part.part_index <> expected_part OR
    part.part_count <> first_part.part_count OR
    part.base_meta_updated_at <> first_part.base_meta_updated_at OR
    part.import_mode <> first_part.import_mode OR
    part.target_doc_id IS DISTINCT FROM first_part.target_doc_id OR
    part.document <> first_part.document OR
    part.created_at < now()-interval '2 hours' THEN
    RETURN jsonb_build_object('status','incomplete');
  END IF;
  input_items := input_items || part.items;
  expected_part := expected_part+1;
 END LOOP;
 IF expected_part <> first_part.part_count THEN
  RETURN jsonb_build_object('status','incomplete');
 END IF;
 raw_import_count:=jsonb_array_length(input_items);
 upload_count:=raw_import_count;
 IF upload_count<1 OR upload_count>10000 THEN
  RETURN jsonb_build_object('status','invalid');
 END IF;
 IF EXISTS (
  SELECT 1 FROM jsonb_array_elements(input_items) e(value)
  WHERE jsonb_typeof(e.value) <> 'object'
    OR length(COALESCE(e.value->>'measureText',''))=0
 ) THEN RETURN jsonb_build_object('status','invalid'); END IF;
 -- Lock all risk rows in deterministic order. This coordinates with the
 -- existing CAS batch writer and prevents stale data overwrites.
 PERFORM 1 FROM public.hanyang_safety_store
  WHERE id='main_v10_meta' OR id ~ '^main_v10_chunk_[0-9]+$'
  ORDER BY id FOR UPDATE;
 SELECT * INTO prior_meta FROM public.hanyang_safety_store
  WHERE id='main_v10_meta';
 IF NOT FOUND THEN RETURN jsonb_build_object('status','not_found'); END IF;
 IF prior_meta.updated_at IS DISTINCT FROM first_part.base_meta_updated_at THEN
  RETURN jsonb_build_object('status','conflict');
 END IF;
 SELECT COALESCE(jsonb_agg(x.value ORDER BY
   substring(s.id FROM '[0-9]+$')::integer,x.ordinality),'[]'::jsonb)
 INTO existing_items
 FROM public.hanyang_safety_store s
 CROSS JOIN LATERAL jsonb_array_elements(s.items)
   WITH ORDINALITY AS x(value,ordinality)
 WHERE s.id~'^main_v10_chunk_[0-9]+$';
 old_count:=jsonb_array_length(existing_items);
 IF old_count <> COALESCE((prior_meta.items->0->>'totalItems')::integer,-1) THEN
  RETURN jsonb_build_object('status','integrity');
 END IF;
 -- Deduplicate only within one evaluation type and exact task context.
 WITH k AS (
  SELECT e.value,e.ordinality,
   jsonb_build_array(
    lower(regexp_replace(btrim(coalesce(e.value->>'evalType',first_part.document->>'evalType','')),'[[:space:]]+',' ','g')),
    lower(regexp_replace(btrim(coalesce(e.value->>'taskTitle','')),'[[:space:]]+',' ','g')),
    lower(regexp_replace(btrim(coalesce(e.value->>'causeObj','')),'[[:space:]]+',' ','g')),
    lower(regexp_replace(btrim(coalesce(e.value->>'hazardText','')),'[[:space:]]+',' ','g')),
    lower(regexp_replace(btrim(coalesce(e.value->>'measureText','')),'[[:space:]]+',' ','g'))
   )::text AS key
  FROM jsonb_array_elements(input_items) WITH ORDINALITY e(value,ordinality)
 ), unique_rows AS (
  SELECT DISTINCT ON(key) value,ordinality FROM k ORDER BY key,ordinality
 )
 SELECT coalesce(jsonb_agg(value ORDER BY ordinality),'[]'::jsonb)
 INTO input_items FROM unique_rows;
 upload_count:=jsonb_array_length(input_items);
 doc_title:=btrim(coalesce(first_part.document->>'title',''));
 doc_id:=first_part.target_doc_id;
 effective_mode:=first_part.import_mode;
 IF doc_title='' AND doc_id IS NOT NULL THEN
  SELECT d.value->>'title' INTO doc_title FROM jsonb_array_elements(prior_meta.documents) d(value)
  WHERE d.value->>'id'=doc_id LIMIT 1;
 END IF;
 IF coalesce(doc_title,'')='' OR length(doc_title)>220 THEN RETURN jsonb_build_object('status','invalid'); END IF;
 IF effective_mode='new' THEN
  -- Last uploaded approved version wins within same title/file/category/site.
  SELECT d.value->>'id' INTO doc_id FROM jsonb_array_elements(prior_meta.documents)
   WITH ORDINALITY d(value,ordinality)
   WHERE lower(btrim(coalesce(d.value->>'evalType','')))=lower(btrim(coalesce(first_part.document->>'evalType','')))
     AND lower(btrim(coalesce(d.value->>'areaTag','')))=lower(btrim(coalesce(first_part.document->>'areaTag','')))
     AND (
       lower(btrim(coalesce(d.value->>'title','')))=lower(doc_title)
       OR (coalesce(first_part.document->>'fileName','')<>''
         AND lower(btrim(coalesce(d.value->>'fileName','')))=lower(btrim(first_part.document->>'fileName')))
     )
   ORDER BY d.ordinality LIMIT 1;
  IF doc_id IS NULL THEN
   doc_id:='doc-imp-'||replace(p_upload_id::text,'-','');
   prior_doc:='{}'::jsonb;
  ELSE
   effective_mode:='replace';
   SELECT d.value INTO prior_doc FROM jsonb_array_elements(prior_meta.documents) d(value)
   WHERE d.value->>'id'=doc_id LIMIT 1;
  END IF;
 ELSE
  IF doc_id IS NULL OR length(doc_id)>120 THEN RETURN jsonb_build_object('status','invalid'); END IF;
  SELECT d.value INTO prior_doc FROM jsonb_array_elements(prior_meta.documents) d(value)
  WHERE d.value->>'id'=doc_id LIMIT 1;
  IF prior_doc IS NULL THEN
   IF effective_mode='replace' AND jsonb_array_length(prior_meta.documents)=0 THEN
    effective_mode:='new';
    doc_id:='doc-imp-'||replace(p_upload_id::text,'-','');
    prior_doc:='{}'::jsonb;
   ELSE RETURN jsonb_build_object('status','not_found'); END IF;
  END IF;
 END IF;
 IF effective_mode='replace' THEN
  SELECT coalesce(array_agg(d.value->>'id'),ARRAY[]::text[]) INTO replaced_doc_ids
  FROM jsonb_array_elements(prior_meta.documents) d(value)
  WHERE d.value->>'id'=doc_id OR (
   lower(btrim(coalesce(d.value->>'evalType','')))=lower(btrim(coalesce(first_part.document->>'evalType','')))
   AND lower(btrim(coalesce(d.value->>'areaTag','')))=lower(btrim(coalesce(first_part.document->>'areaTag','')))
   AND (
    lower(btrim(coalesce(d.value->>'title','')))=lower(doc_title)
    OR (coalesce(first_part.document->>'fileName','')<>''
     AND lower(btrim(coalesce(d.value->>'fileName','')))=lower(btrim(first_part.document->>'fileName')))
   )
  );
  SELECT count(*) INTO i FROM jsonb_array_elements(existing_items) e(value)
   WHERE e.value->>'docId'=ANY(replaced_doc_ids);
  IF i>=100 AND upload_count<i*0.5
    AND first_part.document->>'confirmLargeReplacement' IS DISTINCT FROM 'true' THEN
   RETURN jsonb_build_object('status','large_replacement','previous_items',i,'new_items',upload_count);
  END IF;
 END IF;
 SELECT COALESCE(jsonb_agg(
  (e.value - 'id' - 'docId' - 'docName') ||
   jsonb_build_object('id','item-imp-'||replace(p_upload_id::text,'-','')||'-'||e.ordinality,
                      'docId',doc_id,'docName',doc_title)
  ORDER BY e.ordinality),'[]'::jsonb)
 INTO prepared_items
 FROM jsonb_array_elements(input_items) WITH ORDINALITY e(value,ordinality);
 IF effective_mode='replace' THEN
  SELECT COALESCE(jsonb_agg(e.value ORDER BY e.ordinality),'[]'::jsonb)
   INTO kept_items FROM jsonb_array_elements(existing_items) WITH ORDINALITY e(value,ordinality)
   WHERE NOT (coalesce(e.value->>'docId','')=ANY(replaced_doc_ids));
 ELSE kept_items:=existing_items; END IF;

 -- Never append a row that already belongs to this document, category and
 -- task context. Full revision uploads must use replace, not append.
 IF effective_mode='append' AND EXISTS (
   SELECT 1 FROM (
     SELECT DISTINCT jsonb_build_array(lower(regexp_replace(btrim(coalesce(prev.value->>'evalType','')),'[[:space:]]+',' ','g')),lower(regexp_replace(btrim(coalesce(prev.value->>'taskTitle','')),'[[:space:]]+',' ','g')),lower(regexp_replace(btrim(coalesce(prev.value->>'causeObj','')),'[[:space:]]+',' ','g')),lower(regexp_replace(btrim(coalesce(prev.value->>'hazardText','')),'[[:space:]]+',' ','g')),lower(regexp_replace(btrim(coalesce(prev.value->>'measureText','')),'[[:space:]]+',' ','g'))) AS k
     FROM jsonb_array_elements(kept_items) prev(value)
     WHERE prev.value->>'docId'=doc_id
   ) old_rows
   JOIN (
     SELECT DISTINCT jsonb_build_array(lower(regexp_replace(btrim(coalesce(next.value->>'evalType','')),'[[:space:]]+',' ','g')),lower(regexp_replace(btrim(coalesce(next.value->>'taskTitle','')),'[[:space:]]+',' ','g')),lower(regexp_replace(btrim(coalesce(next.value->>'causeObj','')),'[[:space:]]+',' ','g')),lower(regexp_replace(btrim(coalesce(next.value->>'hazardText','')),'[[:space:]]+',' ','g')),lower(regexp_replace(btrim(coalesce(next.value->>'measureText','')),'[[:space:]]+',' ','g'))) AS k
     FROM jsonb_array_elements(prepared_items) next(value)
   ) new_rows USING (k)
 ) THEN
   RETURN jsonb_build_object('status','duplicate');
 END IF;
 final_items := prepared_items || kept_items;
 new_total:=jsonb_array_length(final_items);
 IF old_count>=100 AND new_total < old_count*0.8
  AND NOT (effective_mode='replace' AND first_part.document->>'confirmLargeReplacement'='true') THEN
  RETURN jsonb_build_object('status','mass_loss');
 END IF;
 IF new_total>20000 THEN RETURN jsonb_build_object('status','invalid'); END IF;
 SELECT count(*) INTO i FROM jsonb_array_elements(existing_items) e(value)
  WHERE effective_mode='append' AND e.value->>'docId'=doc_id;
 rev_history := jsonb_build_array(jsonb_build_object(
  'revNo',COALESCE(first_part.document->>'revNo','Rev.1'),
  'revDate',COALESCE(first_part.document->>'revDate',''),
  'fileName',COALESCE(first_part.document->>'fileName',''),
  'note','서버 검증 후 위험성평가 Excel 업로드'
 )) || CASE WHEN jsonb_typeof(prior_doc->'revHistory')='array'
   THEN prior_doc->'revHistory' ELSE '[]'::jsonb END;
 amended_doc := prior_doc || jsonb_build_object(
  'id',doc_id,
  'title',doc_title,
  'evalType',COALESCE(first_part.document->>'evalType','최초 평가'),
  'areaTag',COALESCE(first_part.document->>'areaTag','HANYANG'),
  'fileName',COALESCE(first_part.document->>'fileName',''),
  'revNo',COALESCE(first_part.document->>'revNo','Rev.1'),
  'revDate',COALESCE(first_part.document->>'revDate',''),
  'displayCount', CASE WHEN effective_mode='append'
    THEN i+upload_count ELSE upload_count END,
  'revHistory',rev_history
 );
 IF effective_mode='new' THEN
  final_docs:=jsonb_build_array(amended_doc)||prior_meta.documents;
 ELSIF effective_mode='replace' THEN
  SELECT jsonb_build_array(amended_doc)||
   coalesce(jsonb_agg(d.value ORDER BY d.ordinality),'[]'::jsonb)
   INTO final_docs FROM jsonb_array_elements(prior_meta.documents) WITH ORDINALITY d(value,ordinality)
   WHERE NOT (coalesce(d.value->>'id','')=ANY(replaced_doc_ids));
 ELSE
  SELECT COALESCE(jsonb_agg(
    CASE WHEN d.value->>'id'=doc_id THEN amended_doc ELSE d.value END
    ORDER BY d.ordinality),'[]'::jsonb)
   INTO final_docs FROM jsonb_array_elements(prior_meta.documents) WITH ORDINALITY d(value,ordinality);
 END IF;
 new_chunk_count:=CEIL(new_total::numeric/800)::integer;
 old_chunk_count:=COALESCE((prior_meta.items->0->>'chunkCount')::integer,0);
 persist_chunk_count:=greatest(new_chunk_count,old_chunk_count);
 IF persist_chunk_count<1 OR persist_chunk_count>25 THEN
  RETURN jsonb_build_object('status','invalid');
 END IF;
 FOR i IN 0..persist_chunk_count-1 LOOP
  row_id:='main_v10_chunk_'||i;
  SELECT COALESCE(jsonb_agg(e.value ORDER BY e.ordinality),'[]'::jsonb)
    INTO part_items
    FROM jsonb_array_elements(final_items) WITH ORDINALITY e(value,ordinality)
    WHERE e.ordinality > i*800 AND e.ordinality <= (i+1)*800;
  SELECT * INTO old_chunk FROM public.hanyang_safety_store WHERE id=row_id;
  IF FOUND THEN
   INSERT INTO public.she_v24_store_history(store_id,actor_id,previous_row)
    VALUES (row_id,p_actor,to_jsonb(old_chunk));
   UPDATE public.hanyang_safety_store SET
    items=part_items,documents='[]'::jsonb,users='[]'::jsonb,
    updated_at=greatest(clock_timestamp(),old_chunk.updated_at+interval '1 microsecond')
    WHERE id=row_id;
  ELSE
   INSERT INTO public.hanyang_safety_store(id,documents,items,users,updated_at)
    VALUES(row_id,'[]'::jsonb,part_items,'[]'::jsonb,clock_timestamp());
  END IF;
 END LOOP;
 INSERT INTO public.she_v24_store_history(store_id,actor_id,previous_row)
 VALUES ('main_v10_meta',p_actor,to_jsonb(prior_meta));
 UPDATE public.hanyang_safety_store SET
  documents=final_docs,
  items=jsonb_build_array(prior_meta.items->0 ||
   jsonb_build_object('chunkCount',new_chunk_count,'totalItems',new_total)),
  updated_at=greatest(clock_timestamp(),prior_meta.updated_at+interval '1 microsecond')
 WHERE id='main_v10_meta';
 DELETE FROM public.she_v24_safety_import_parts
 WHERE actor_id=p_actor AND upload_id=p_upload_id;
 RETURN jsonb_build_object('status','ok','doc_id',doc_id,
 'document_title',doc_title,'imported_items',upload_count,
 'source_items',raw_import_count,'duplicates_removed',raw_import_count-upload_count,
 'effective_mode',effective_mode,'replaced_documents',coalesce(array_length(replaced_doc_ids,1),0),
 'total_items',new_total,'document_count',jsonb_array_length(final_docs));
END;
$function$
