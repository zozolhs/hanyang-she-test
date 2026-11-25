CREATE OR REPLACE FUNCTION public.she_v24_commit_safety_snapshot(p_actor uuid, p_upload_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 first_part public.she_v24_safety_import_parts%ROWTYPE;
 part record;
 meta public.hanyang_safety_store%ROWTYPE;
 old_chunk public.hanyang_safety_store%ROWTYPE;
 new_docs jsonb;
 new_items jsonb := '[]'::jsonb;
 part_items jsonb;
 old_item_count integer;
 new_count integer;
 old_chunk_count integer;
 new_chunk_count integer;
 count_existing integer;
 i integer;
 row_id text;
 part_seq integer := 0;
BEGIN
 SELECT * INTO first_part FROM public.she_v24_safety_import_parts
 WHERE actor_id=p_actor AND upload_id=p_upload_id AND part_index=0
 AND import_mode='snapshot' AND created_at>now()-interval '2 hours';
 IF NOT FOUND THEN RETURN jsonb_build_object('status','incomplete'); END IF;
 FOR part IN SELECT * FROM public.she_v24_safety_import_parts
  WHERE actor_id=p_actor AND upload_id=p_upload_id ORDER BY part_index
 LOOP
  IF part.part_index<>part_seq OR part.part_count<>first_part.part_count
   OR part.base_meta_updated_at<>first_part.base_meta_updated_at
   OR part.import_mode<>'snapshot'
   OR part.document<>first_part.document
   OR part.created_at<now()-interval '2 hours'
  THEN RETURN jsonb_build_object('status','incomplete'); END IF;
  new_items:=new_items||part.items;
  part_seq:=part_seq+1;
 END LOOP;
 IF part_seq<>first_part.part_count THEN RETURN jsonb_build_object('status','incomplete'); END IF;
 new_docs:=first_part.document->'documents';
 IF jsonb_typeof(new_docs)<>'array' OR jsonb_array_length(new_docs)<1 OR
    jsonb_array_length(new_docs)>2000 THEN RETURN jsonb_build_object('status','invalid'); END IF;
 new_count:=jsonb_array_length(new_items);
 IF new_count<1 OR new_count>20000 THEN RETURN jsonb_build_object('status','invalid'); END IF;

 -- Do not let manual edits/legacy auto-save reinsert identical rows into
 -- the same document and work category. Separate work names remain separate.
 IF EXISTS (
  SELECT 1 FROM (
   SELECT row_number() OVER (PARTITION BY
    coalesce(x.value->>'docId',''),
    lower(regexp_replace(btrim(coalesce(x.value->>'evalType','')),'[[:space:]]+',' ','g')),
    lower(regexp_replace(btrim(coalesce(x.value->>'taskTitle','')),'[[:space:]]+',' ','g')),
    lower(regexp_replace(btrim(coalesce(x.value->>'causeObj','')),'[[:space:]]+',' ','g')),
    lower(regexp_replace(btrim(coalesce(x.value->>'hazardText','')),'[[:space:]]+',' ','g')),
    lower(regexp_replace(btrim(coalesce(x.value->>'measureText','')),'[[:space:]]+',' ','g'))
    ORDER BY x.ordinality) row_rank
   FROM jsonb_array_elements(new_items) WITH ORDINALITY x(value,ordinality)
  ) ranked
  WHERE row_rank>1
 ) THEN RETURN jsonb_build_object('status','duplicate'); END IF;
 PERFORM 1 FROM public.hanyang_safety_store
 WHERE id='main_v10_meta' OR id~'^main_v10_chunk_[0-9]+$'
 ORDER BY id FOR UPDATE;
 SELECT * INTO meta FROM public.hanyang_safety_store WHERE id='main_v10_meta';
 IF NOT FOUND THEN RETURN jsonb_build_object('status','not_found'); END IF;
 IF meta.updated_at IS DISTINCT FROM first_part.base_meta_updated_at
  THEN RETURN jsonb_build_object('status','conflict'); END IF;
 old_item_count:=COALESCE((meta.items->0->>'totalItems')::integer,0);
 SELECT COALESCE(SUM(jsonb_array_length(items)),0)::integer INTO count_existing
 FROM public.hanyang_safety_store WHERE id~'^main_v10_chunk_[0-9]+$';
 IF count_existing<>old_item_count
  THEN RETURN jsonb_build_object('status','integrity'); END IF;
 IF old_item_count>=100 AND new_count<old_item_count*0.8
  THEN RETURN jsonb_build_object('status','mass_loss'); END IF;
 -- No existing document may disappear from a general edit/save request.
 IF EXISTS(
  SELECT 1 FROM jsonb_array_elements(meta.documents) d(value)
  WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(new_docs) nd(value)
    WHERE nd.value->>'id'=d.value->>'id')
 ) THEN RETURN jsonb_build_object('status','doc_loss'); END IF;
 old_chunk_count:=COALESCE((meta.items->0->>'chunkCount')::integer,0);
 new_chunk_count:=CEIL(new_count::numeric/800)::integer;
 IF greatest(old_chunk_count,new_chunk_count)>25
  THEN RETURN jsonb_build_object('status','invalid'); END IF;
 FOR i IN 0..greatest(old_chunk_count,new_chunk_count)-1 LOOP
  row_id:='main_v10_chunk_'||i;
  SELECT COALESCE(jsonb_agg(e.value ORDER BY e.ordinality),'[]'::jsonb)
  INTO part_items FROM jsonb_array_elements(new_items) WITH ORDINALITY e(value,ordinality)
  WHERE e.ordinality>i*800 AND e.ordinality<=(i+1)*800;
  SELECT * INTO old_chunk FROM public.hanyang_safety_store WHERE id=row_id;
  IF FOUND THEN
    INSERT INTO public.she_v24_store_history(store_id,actor_id,previous_row)
    VALUES(row_id,p_actor,to_jsonb(old_chunk));
    UPDATE public.hanyang_safety_store SET
       documents='[]'::jsonb,items=part_items,users='[]'::jsonb,
       updated_at=greatest(clock_timestamp(),old_chunk.updated_at+interval '1 microsecond')
    WHERE id=row_id;
  ELSE
    INSERT INTO public.hanyang_safety_store(id,documents,items,users,updated_at)
    VALUES(row_id,'[]'::jsonb,part_items,'[]'::jsonb,clock_timestamp());
  END IF;
 END LOOP;
 INSERT INTO public.she_v24_store_history(store_id,actor_id,previous_row)
 VALUES('main_v10_meta',p_actor,to_jsonb(meta));
 UPDATE public.hanyang_safety_store SET documents=new_docs,
 items=jsonb_build_array((meta.items->0)
 ||jsonb_build_object('totalItems',new_count,'chunkCount',new_chunk_count)
 ||CASE WHEN jsonb_typeof(first_part.document->'itemMaps')='object'
  THEN jsonb_build_object('itemMaps',first_part.document->'itemMaps')
  ELSE '{}'::jsonb END
 ||CASE WHEN jsonb_typeof(first_part.document->'docTableMapsV24')='object'
  THEN jsonb_build_object('docTableMapsV24',first_part.document->'docTableMapsV24')
  ELSE '{}'::jsonb END),
 updated_at=greatest(clock_timestamp(),meta.updated_at+interval '1 microsecond')
 WHERE id='main_v10_meta';
 DELETE FROM public.she_v24_safety_import_parts
 WHERE actor_id=p_actor AND upload_id=p_upload_id;
 RETURN jsonb_build_object('status','ok','total_items',new_count,
  'document_count',jsonb_array_length(new_docs));
END;
$function$
