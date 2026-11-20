-- TEST only. Original V23 attendance function is unchanged.
-- SECURITY INVOKER and revoked EXECUTE restrict the new function to service_role.
BEGIN;
CREATE OR REPLACE FUNCTION public.she_v24_confirm_education(p_event_id text, p_expected_updated_at text, p_actor uuid, p_attendance jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_access jsonb;
  v_sched public.hanyang_safety_store%ROWTYPE;
  v_roster public.hanyang_safety_store%ROWTYPE;
  v_events jsonb;
  v_workers jsonb;
  v_event jsonb;
  v_event_idx integer := -1;
  v_event_date date;
  v_course text;
  v_hours numeric;
  v_key text;
  v_state text;
  v_worker jsonb;
  v_field_value text;
  v_match_count integer;
  v_worker_index integer;
  v_found_count integer := 0;
  v_total integer := 0;
  v_skipped integer := 0;
  v_current_hours numeric;
  v_new_hours numeric;
  v_current_date date;
  v_new_date date;
  v_text_hours text;
  v_now timestamptz := clock_timestamp();
  v_confirmed jsonb := '[]'::jsonb;
  v_over jsonb := '[]'::jsonb;
  v_outcomes jsonb := '{}'::jsonb;
  v_name text;
  v_worker_number text;
  v_event_row jsonb;
  v_index integer;
BEGIN
  -- Caller account and EDUCATION write permission are validated by V24 Edge Function.
  IF p_actor IS NULL THEN RAISE EXCEPTION 'V24 실행 주체 누락'; END IF;
  IF length(COALESCE(p_event_id,'')) = 0 OR jsonb_typeof(COALESCE(p_attendance,'{}'::jsonb)) <> 'object'
  THEN RAISE EXCEPTION '교육 식별번호/출석 상태 오류'; END IF;

  -- 고정된 잠금 순서: 일정 => 연명부 (동시 확정과 중복 확정을 직렬화).
  SELECT * INTO v_sched FROM public.hanyang_safety_store
    WHERE id='main_v1_edu_schedule' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '교육 일정 저장 행 없음'; END IF;
  IF p_expected_updated_at IS NULL OR v_sched.updated_at::timestamptz IS DISTINCT FROM p_expected_updated_at::timestamptz
  THEN RAISE EXCEPTION '일정이 다른 관리자에 의해 변경됨. 새로고침 후 재확정하세요.'; END IF;
  SELECT * INTO v_roster FROM public.hanyang_safety_store
    WHERE id='main_v1_roster_master' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '연명부 저장 행 없음'; END IF;
  v_events := COALESCE(v_sched.items::jsonb,'[]'::jsonb);
  v_workers := COALESCE(v_roster.items::jsonb,'[]'::jsonb);
  IF jsonb_typeof(v_events)<>'array' OR jsonb_typeof(v_workers)<>'array'
  THEN RAISE EXCEPTION '교육 일정 또는 연명부 배열 형식 오류'; END IF;

  FOR v_event_row,v_index IN SELECT e,(ord-1)::integer
    FROM jsonb_array_elements(v_events) WITH ORDINALITY AS a(e,ord)
  LOOP
    IF v_event_row->>'id'=p_event_id THEN
      v_event_idx:=v_index;v_event:=v_event_row;EXIT;
    END IF;
  END LOOP;
  IF v_event_idx<0 THEN RAISE EXCEPTION '교육 일정 찾을 수 없음'; END IF;
  IF v_event->>'kind'='iris' THEN RAISE EXCEPTION '홍채등록 일정은 교육시간 합산 대상이 아님'; END IF;
  IF v_event->>'status'='completed' THEN
    RETURN jsonb_build_object('status','already_completed','eventId',p_event_id,'added',0);
  END IF;
  IF v_event->>'status'<>'scheduled' THEN RAISE EXCEPTION '예정 상태 교육만 완료 확정 가능'; END IF;
  IF COALESCE(v_event->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' OR
     COALESCE(v_event->>'endTime','') !~ '^([01]\d|2[0-3]):[0-5]\d$'
  THEN RAISE EXCEPTION '교육 날짜/종료시각 형식 오류'; END IF;
  v_event_date := (v_event->>'date')::date;
  IF (v_event_date + (v_event->>'endTime')::time) > (v_now AT TIME ZONE 'Asia/Seoul')
  THEN RAISE EXCEPTION '아직 교육 종료시각이 지나지 않았습니다.'; END IF;
  v_course:=COALESCE(v_event->>'courseKey','');
  IF v_course<>'' AND v_course NOT IN
   ('eduCommon','edu13ho','edu38ho','edu4ho','edu35ho','eduClosed','eduMsds','edu2ho','eduCrane')
  THEN RAISE EXCEPTION '지원하지 않는 연명부 연계 교육 항목'; END IF;
  v_hours:=COALESCE((v_event->>'hours')::numeric,0);
  IF v_hours<=0 OR v_hours>24 THEN RAISE EXCEPTION '유효하지 않은 교육 시간'; END IF;
  IF jsonb_typeof(COALESCE(v_event->'attendeeKeys','[]'::jsonb)) <> 'array'
  THEN RAISE EXCEPTION '수강자 목록 형식 오류'; END IF;

  -- 모든 참석자부터 검증; 한 명이라도 불일치하면 전체 트랜잭션 중단.
  FOR v_key IN SELECT jsonb_array_elements_text(COALESCE(v_event->'attendeeKeys','[]'::jsonb)) LOOP
    v_state := COALESCE(p_attendance->>v_key,'attended');
    IF v_state NOT IN ('attended','cancelled','postponed','absent')
    THEN RAISE EXCEPTION '알 수 없는 출석상태: %',v_state; END IF;
    v_outcomes := v_outcomes || jsonb_build_object(v_key,v_state);
    IF v_state <> 'attended' THEN v_skipped:=v_skipped+1;CONTINUE; END IF;
    IF v_key NOT LIKE 'worker:%' AND v_key NOT LIKE 'uid:%'
    THEN RAISE EXCEPTION '근로번호 또는 UID가 없는 교육대상자: %',v_key; END IF;
    SELECT COUNT(*), MIN((ord-1)::integer)
      INTO v_match_count, v_worker_index
      FROM jsonb_array_elements(v_workers) WITH ORDINALITY AS r(w,ord)
      WHERE CASE WHEN v_key LIKE 'worker:%'
        THEN COALESCE(w->>'workerNo','')=substring(v_key from 8)
        ELSE COALESCE(w->>'uid',w->>'_uid',w->>'id','')=substring(v_key from 5) END;
    IF v_match_count<>1 THEN RAISE EXCEPTION '근로자 고유번호 불일치/중복: %',v_key; END IF;
    v_worker:=v_workers->v_worker_index;
    IF length(trim(COALESCE(v_worker->>'resignDate','')))>0
    THEN RAISE EXCEPTION '퇴사자 교육 확정 불가: %',v_key; END IF;
    IF v_course='eduCrane' AND regexp_replace(COALESCE(v_worker->>'job',''),'[[:space:]]','','g')='용접공'
    THEN RAISE EXCEPTION '교육대상자가 아닙니다. 크레인/용접공: %',v_key; END IF;
    v_total:=v_total+1;
    IF v_course<>'' THEN
      v_field_value:=COALESCE(v_worker->>v_course,'');
      SELECT COALESCE((regexp_match(v_field_value,'([0-9]+(?:[.][0-9]+)?)\s*h','i'))[1]::numeric,0)
        INTO v_current_hours;
      v_new_hours:=v_current_hours+v_hours;
      IF v_new_hours>8 THEN v_over:=v_over||jsonb_build_array(jsonb_build_object('key',v_key,'hours',v_new_hours)); END IF;
      -- 형식이 비정상인 교육값을 덮어쓰지 않음.
      IF trim(v_field_value)<>'' AND v_current_hours=0 AND v_field_value !~ '^\s*(?:[0-9]{4}-[0-9]{2}-[0-9]{2}\s+)?0+(?:[.]0+)?\s*h?\s*$'
      THEN RAISE EXCEPTION '기존 교육시간 판독 불가 (%): %',v_key,v_field_value; END IF;
      v_current_date:=NULL;
      IF v_field_value ~ '[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN
        v_current_date:=substring(v_field_value from '[0-9]{4}-[0-9]{2}-[0-9]{2}')::date;
      END IF;
      v_new_date:=GREATEST(COALESCE(v_current_date,v_event_date),v_event_date);
      v_text_hours:=trim(trailing '.' from trim(trailing '0' from to_char(v_new_hours,'FM9999999990.000')));
      v_workers:=jsonb_set(v_workers,ARRAY[v_worker_index::text,v_course],to_jsonb(v_new_date::text||' '||v_text_hours||'h'),true);
    END IF;
    v_confirmed:=v_confirmed||to_jsonb(v_key);
  END LOOP;

  v_event:=v_event||jsonb_build_object(
    'status','completed','confirmedAt',v_now,'confirmedBy',p_actor,
    'confirmedKeys',v_confirmed,'attendeeOutcomes',v_outcomes
  );
  v_events:=jsonb_set(v_events,ARRAY[v_event_idx::text],v_event,false);
  INSERT INTO public.she_v24_store_history(store_id,actor_id,previous_row)
    VALUES ('main_v1_roster_master',p_actor,to_jsonb(v_roster)),
           ('main_v1_edu_schedule',p_actor,to_jsonb(v_sched));
  UPDATE public.hanyang_safety_store SET items=v_workers,updated_at=v_now
    WHERE id='main_v1_roster_master';
  UPDATE public.hanyang_safety_store SET items=v_events,updated_at=v_now
    WHERE id='main_v1_edu_schedule';
  RETURN jsonb_build_object('status','completed','eventId',p_event_id,
    'added',v_total,'excluded',v_skipped,'over8h',v_over);
END;
$function$;

REVOKE ALL ON FUNCTION public.she_v24_confirm_education(text,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.she_v24_confirm_education(text,text,uuid,jsonb) TO service_role;
COMMIT;
