-- TEST ONLY. One-page is a separate protected data domain under SAFETY.
-- Existing risk assessment store rows are never modified.
BEGIN;
CREATE TABLE IF NOT EXISTS public.she_v24_onepage_state (
  id text PRIMARY KEY CHECK (id = 'main'),
  payload jsonb NOT NULL CHECK(jsonb_typeof(payload) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS public.she_v24_onepage_history (
  revision_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id uuid NOT NULL,
  previous_payload jsonb NOT NULL,
  previous_updated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS public.she_v24_onepage_photos (
  id text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 100),
  row_id text NOT NULL CHECK (length(row_id) BETWEEN 1 AND 100),
  taken_at bigint NOT NULL,
  caption text NOT NULL DEFAULT '',
  filename text NOT NULL DEFAULT '',
  width integer NOT NULL DEFAULT 0,
  height integer NOT NULL DEFAULT 0,
  mime_type text NOT NULL DEFAULT 'image/jpeg' CHECK (mime_type IN ('image/jpeg','image/png','image/webp')),
  photo_data_url text NOT NULL,
  thumbnail_data_url text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.she_v24_onepage_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.she_v24_onepage_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.she_v24_onepage_photos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.she_v24_onepage_state, public.she_v24_onepage_history, public.she_v24_onepage_photos FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.she_v24_onepage_history_revision_id_seq FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.she_v24_onepage_state TO service_role;
GRANT SELECT, INSERT ON public.she_v24_onepage_history TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.she_v24_onepage_photos TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.she_v24_onepage_history_revision_id_seq TO service_role;
-- Preserve uploaded ONE-PAGE records only if this state row has never been created.
INSERT INTO public.she_v24_onepage_state(id,payload)
VALUES ('main', '{"rows":[{"cls":"26.09_1","date":"2026-09-28","trade":"일반배관","content":"OB 고소작업대 작업 시 상부 구조물에 개인생명줄 설치\n(개인생명줄 모서리 훼손위험으로 보양실시, 생명줄 강도 기준표시)","tl":"","tech":"황준태","mgr":"주현수","ssc":"하승훈","sss":"유준호","extra":"","proposal":"제안등록 완료","orig":true,"plan":"","photoNote":"","photoOK":true,"photoNA":false,"note":"","mail":false,"mailDate":"","submit":"26.10.07\n(김명진 프로)","apply":"일반배관 REV.01","id":"op_seed_0001"},{"cls":"26.10_1","date":"2026-10-07","trade":"일반배관","content":"OB 단부구간 난간대 외부 슬리브 설치작업\n(안전블럭, 안전대 착용 및 공도구 이탈 방지 조치의 건)","tl":"황준태","tech":"전홍철, 박태준","mgr":"주현수","ssc":"김대호","sss":"유준호","extra":"","proposal":"제안등록 완료","orig":true,"plan":"","photoNote":"작업방법 변경\nOB 작업대기","photoOK":false,"photoNA":true,"note":"","mail":true,"mailDate":"26.10.12","submit":"26.10.13","apply":"일반배관 REV.01","id":"op_seed_0002"},{"cls":"26.10_2","date":"2026-10-12","trade":"일반배관","content":"26.10_1 보충내용 기입[복사본에 추가기입 후 유주영 프로 결재]\n작업순서 기입,  상하동시작업 하부통제(무전기 지참) 등","tl":"","tech":"","mgr":"","ssc":"","sss":"","extra":"유주영","proposal":"제안등록 완료","orig":true,"plan":"","photoNote":"작업방법 변경\nOB 작업대기","photoOK":false,"photoNA":true,"note":"","mail":true,"mailDate":"26.10.12","submit":"26.10.13","apply":"일반배관 REV.01","id":"op_seed_0003"},{"cls":"26.10_3","date":"2026-10-15","trade":"폐수배관","content":"T/L을 사용하여 HPL 상부 접근 후 출입구 오픈하여 \n자재 양중작업","tl":"","tech":"박동욱","mgr":"지종혁","ssc":"김문표","sss":"윤영신","extra":"","proposal":"제안등록 완료","orig":true,"plan":"26.10.19","photoNote":"작업미실시","photoOK":false,"photoNA":true,"note":"","mail":true,"mailDate":"26.10.16","submit":"26.10.21","apply":"26년 11월 수시위평반영 예정","id":"op_seed_0004"},{"cls":"26.10_4","date":"2026-10-15","trade":"폐수배관","content":"①T/L 에서 리프팅 되어있는 HPL 이동\n② HPL 상부에서의 말비계 작업 건","tl":"","tech":"박동욱","mgr":"지종혁","ssc":"김문표","sss":"윤영신","extra":"","proposal":"제안등록 완료","orig":true,"plan":"26.10.19","photoNote":"일부공유\n(말비계)","photoOK":false,"photoNA":false,"note":"T/L →  HPL\n이동사진 필요","mail":true,"mailDate":"26.10.16","submit":"26.10.21","apply":"26년 11월 수시위평반영 예정","id":"op_seed_0005"},{"cls":"26.10_5","date":"2026-10-19","trade":"폐수배관","content":"HPL 상부 A형 말비계 작업\n(하부2인 지지, 전산볼트 추락방지대 설치/체결, 하중분산 고려)","tl":"","tech":"박동욱","mgr":"지종혁","ssc":"노정훈","sss":"신진욱","extra":"","proposal":"제안등록 완료","orig":true,"plan":"","photoNote":"","photoOK":true,"photoNA":false,"note":"","mail":true,"mailDate":"26.10.20","submit":"26.10.21","apply":"26년 11월 수시위평반영 예정","id":"op_seed_0006"},{"cls":"26.10_6","date":"2026-10-20","trade":"폐수배관","content":"HPL 상부 말비계 작업\n(말비계 1.5m 이상 확장)","tl":"","tech":"박동욱","mgr":"지종혁","ssc":"노정훈","sss":"서준기","extra":"","proposal":"제안등록 완료","orig":true,"plan":"","photoNote":"","photoOK":true,"photoNA":false,"note":"","mail":true,"mailDate":"26.10.21","submit":"26.10.21","apply":"26년 11월 수시위평반영 예정","id":"op_seed_0007"},{"cls":"26.10_7","date":"2026-10-21","trade":"폐수배관","content":"고소작업대 상부 배관 양중작업\n(말비계 → T/L 상부,   지면에서 로프 매듭후 T/L 상부 양중)","tl":"","tech":"박동욱","mgr":"지종혁","ssc":"노정훈","sss":"이민수","extra":"","proposal":"제안등록 완료","orig":true,"plan":"","photoNote":"","photoOK":true,"photoNA":false,"note":"26.11.09 完","mail":true,"mailDate":"26.10.21","submit":"26.10.28","apply":"26년 11월 수시위평반영 예정","id":"op_seed_0008"},{"cls":"26.10_8","date":"2026-10-28","trade":"폐수배관","content":"T/L을 사용하여 뿜칠 제거 및 보수작업 실시(집진기 사용)","tl":"","tech":"황준태","mgr":"지종혁","ssc":"노정훈","sss":"신진욱","extra":"","proposal":"제안등록 완료","orig":true,"plan":"","photoNote":"","photoOK":true,"photoNA":false,"note":"26.11.09 完","mail":true,"mailDate":"26.11.03","submit":"26.11.04","apply":"26년 11월 수시위평반영 예정","id":"op_seed_0009"},{"cls":"26.10_9","date":"2026-10-29","trade":"모듈공사","content":"지게차 메가데크 양중작업장 유도/통제 실시","tl":"","tech":"김영재","mgr":"신소망","ssc":"정재기","sss":"김민섭","extra":"","proposal":"","orig":true,"plan":"","photoNote":"★사진요청★","photoOK":false,"photoNA":false,"note":"하부 지게차\n통제 사진필요","mail":true,"mailDate":"26.11.03","submit":"26.11.04","apply":"26년 11월 수시위평반영 예정","id":"op_seed_0010"},{"cls":"26.10_10","date":"2026-10-29","trade":"모듈공사","content":"크레인을 이용한 지게차 양중작업\n(메가데크 상부 양중)","tl":"","tech":"김영재","mgr":"신소망","ssc":"정재기","sss":"김민섭","extra":"","proposal":"","orig":true,"plan":"","photoNote":"","photoOK":true,"photoNA":false,"note":"","mail":true,"mailDate":"26.11.03","submit":"26.11.04","apply":"26년 11월 수시위평반영 예정","id":"op_seed_0011"},{"cls":"26.10_11","date":"2026-10-29","trade":"모듈공사","content":"지게차 메가데크 상부 크레인 양중 및 층 반입 작업","tl":"","tech":"김영재","mgr":"신소망","ssc":"정재기","sss":"김민섭","extra":"","proposal":"","orig":true,"plan":"","photoNote":"△","photoOK":false,"photoNA":false,"note":"상부 양중후\n통제사진 없음","mail":true,"mailDate":"26.11.03","submit":"26.11.04","apply":"26년 11월 수시위평반영 예정","id":"op_seed_0012"},{"cls":"26.10_12","date":"2026-10-29","trade":"폐수배관","content":"PE 배관 체인블럭을 사용 한 양중작업\n(T/L 탑승 보조 및 유밴드 체결 작업 포함)","tl":"","tech":"김용민","mgr":"류동오","ssc":"서재교","sss":"임호현","extra":"","proposal":"제안등록 완료","orig":true,"plan":"","photoNote":"","photoOK":true,"photoNA":false,"note":"","mail":true,"mailDate":"26.11.03","submit":"26.11.04","apply":"26년 11월 수시위평반영 예정","id":"op_seed_0013"},{"cls":"26.10_13","date":"2026-10-29","trade":"일반배관","content":"공구함 단차구간 양중 시 손잡이 활용\n(사고 재발방지 대책 마련 시행 건)","tl":"","tech":"황준태","mgr":"민병석","ssc":"노정훈","sss":"서준기","extra":"","proposal":"","orig":true,"plan":"","photoNote":"","photoOK":true,"photoNA":false,"note":"","mail":true,"mailDate":"26.11.03","submit":"26.11.04","apply":"26년 11월 수시위평반영 예정","id":"op_seed_0014"},{"cls":"26.11_N1","date":"2026-11-02","trade":"모듈공사","content":"T/L 사용하여 앙카 타공 작업\n(T/L 기본 높이보다 아래쪽 타공 시 뒷문 개방하여 작업)","tl":"","tech":"김대성","mgr":"유재환","ssc":"정재기","sss":"정수호","extra":"","proposal":"","orig":true,"plan":"","photoNote":"","photoOK":true,"photoNA":false,"note":"","mail":true,"mailDate":"26.11.03","submit":"26.11.04","apply":"26년 11월 수시위평반영 예정","id":"op_seed_0015"},{"cls":"26.11_N2","date":"2026-11-02","trade":"폐수배관","content":"융착작업 화재발생 위험에 따른 조치\n(소화기 비치, 화재감시자 미배치)","tl":"","tech":"박동욱","mgr":"지종혁","ssc":"노정준","sss":"이민수","extra":"","proposal":"제안등록 완료","orig":true,"plan":"","photoNote":"","photoOK":true,"photoNA":false,"note":"","mail":true,"mailDate":"26.11.03","submit":"26.11.04","apply":"","id":"op_seed_0016"},{"cls":"26.11_N3","date":"2026-11-03","trade":"폐수배관","content":"T/L 내부 융착작업\n(찬넬로 만든 융착기 받침대를 T/L 내부에 고정하여 작업실시)","tl":"","tech":"박동욱","mgr":"지종혁","ssc":"노정준","sss":"서준기","extra":"","proposal":"제안등록 완료","orig":true,"plan":"","photoNote":"","photoOK":true,"photoNA":false,"note":"","mail":true,"mailDate":"26.11.11","submit":"26.11.11","apply":"","id":"op_seed_0017"},{"cls":"26.11_N4","date":"2026-11-04","trade":"모듈공사","content":"메인기둥 마그네틱 드릴 사용 타공작업\n(말비계, A형 말비계, T/L 작업)","tl":"","tech":"박근희","mgr":"류재환","ssc":"정창우","sss":"진정호","extra":"","proposal":"","orig":true,"plan":"","photoNote":"","photoOK":true,"photoNA":false,"note":"","mail":true,"mailDate":"26.11.11","submit":"26.11.11","apply":"","id":"op_seed_0018"},{"cls":"26.11_N5","date":"2026-11-06","trade":"폐수배관","content":"T/L을 이용한  PE배관 양중 및 설치작업\n(서포트 사이 밀어넣고 당기며 서포트 안착 및 고정 체결)","tl":"","tech":"김용민","mgr":"지종혁","ssc":"노정준","sss":"이민수","extra":"","proposal":"제안등록 완료","orig":true,"plan":"","photoNote":"","photoOK":true,"photoNA":false,"note":"","mail":true,"mailDate":"26.11.11","submit":"26.11.11","apply":"","id":"op_seed_0019"},{"cls":"26.11_N6","date":"2026-11-11","trade":"모듈공사","content":"550T 크레인을 이용한 100T 크레인 3F 메가모듈 양중작업","tl":"","tech":"전상훈","mgr":"신소망","ssc":"정재기","sss":"유준호","extra":"","proposal":"제안등록 완료","orig":true,"plan":"","photoNote":"★사진요청★","photoOK":false,"photoNA":false,"note":"11/22(토) \n실시예정","mail":false,"mailDate":"26.11.17\n송부 예정","submit":"금주(수)\n제출 예정","apply":"","id":"op_seed_0020"},{"cls":"26.11_N7","date":"2026-11-11","trade":"모듈공사","content":"크레인을 이용한 모듈 양중작업","tl":"","tech":"김경훈","mgr":"이천관","ssc":"노정준","sss":"유준호","extra":"","proposal":"제안등록 완료","orig":true,"plan":"","photoNote":"★사진요청★","photoOK":false,"photoNA":false,"note":"통제사진\n추가 필요함","mail":false,"mailDate":"26.11.17\n송부 예정","submit":"금주(수)\n제출 예정","apply":"","id":"op_seed_0021"},{"cls":"26.11_N8","date":"2026-11-11","trade":"모듈공사","content":"크레인을 이용한 모둘 양중 및 운반작업(유도/통제)","tl":"","tech":"김영재","mgr":"유재환","ssc":"노정준","sss":"유준호","extra":"","proposal":"제안등록 완료","orig":true,"plan":"","photoNote":"★사진요청★","photoOK":false,"photoNA":false,"note":"상부 양중후\n운반 통제사진","mail":false,"mailDate":"26.11.17\n송부 예정","submit":"금주(수)\n제출 예정","apply":"","id":"op_seed_0022"},{"cls":"26.11_N9","date":"2026-11-11","trade":"모듈공사","content":"크레인을 이용한 모듈 양중 및 설치위치 셋팅\n(모듈 이동구간 바닥보강, 추락방지 조치)","tl":"","tech":"김영재","mgr":"유재환","ssc":"노정준","sss":"유준호","extra":"","proposal":"제안등록 완료","orig":true,"plan":"","photoNote":"★사진요청★","photoOK":false,"photoNA":false,"note":"바닥보강\n추락방지조치","mail":false,"mailDate":"26.11.17\n송부 예정","submit":"금주(수)\n제출 예정","apply":"","id":"op_seed_0023"},{"cls":"26.11_N10","date":"2026-11-11","trade":"모듈공사","content":"뿜칠구간 타공, 용접을 위한 뿜칠 제거 및 보수작업(보호구 착용)","tl":"","tech":"김정욱","mgr":"백승은","ssc":"방은준","sss":"서준기","extra":"","proposal":"","orig":true,"plan":"","photoNote":"","photoOK":true,"photoNA":false,"note":"","mail":false,"mailDate":"26.11.17\n송부 예정","submit":"금주(수)\n제출 예정","apply":"","id":"op_seed_0024"},{"cls":"26.11_N11","date":"2026-11-12","trade":"폐수배관","content":"단차구간 인력을 이용한 배관 운반 및 양중\n(인력 8명, 단차부 계단설치, 휀스 출입통제)","tl":"","tech":"강선구","mgr":"지종혁","ssc":"노정훈","sss":"이민수","extra":"","proposal":"","orig":true,"plan":"","photoNote":"","photoOK":false,"photoNA":false,"note":"","mail":false,"mailDate":"26.11.17\n송부 예정","submit":"금주(수)\n제출 예정","apply":"","id":"op_seed_0025"},{"cls":"26.11_N12","date":"2026-11-13","trade":"모듈공사","content":"트레일러 상부 모듈 크레인을 사용하여 1F→3F 양중","tl":"","tech":"김경훈","mgr":"유재환","ssc":"김문표","sss":"임호현","extra":"","proposal":"","orig":true,"plan":"","photoNote":"","photoOK":false,"photoNA":false,"note":"","mail":false,"mailDate":"26.11.17\n송부 예정","submit":"금주(수)\n제출 예정","apply":"","id":"op_seed_0026"},{"cls":"26.11_N13","date":"2026-11-13","trade":"모듈공사","content":"모듈 양중 디바이스 운반 작업","tl":"","tech":"양선흠","mgr":"유재환","ssc":"김문표","sss":"임호현","extra":"","proposal":"","orig":true,"plan":"","photoNote":"","photoOK":false,"photoNA":false,"note":"","mail":false,"mailDate":"26.11.17\n송부 예정","submit":"금주(수)\n제출 예정","apply":"","id":"op_seed_0027"},{"cls":"26.11_N14","date":"2026-11-16","trade":"덕트공사","content":"계단실 도수 운반작업","tl":"","tech":"고광윤","mgr":"진준세","ssc":"정창우","sss":"진정호","extra":"","proposal":"","orig":true,"plan":"","photoNote":"","photoOK":false,"photoNA":false,"note":"","mail":false,"mailDate":"26.11.17\n송부 예정","submit":"금주(수)\n제출 예정","apply":"","id":"op_seed_0028"}],"extraMonths":[]}'::jsonb)
ON CONFLICT(id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.she_v24_onepage_cas(
  p_actor uuid,p_expected_at timestamptz,p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = ''
AS $function$
DECLARE previous_record public.she_v24_onepage_state%ROWTYPE;
        next_at timestamptz;
BEGIN
  IF p_actor IS NULL OR p_expected_at IS NULL OR jsonb_typeof(p_payload)<>'object'
    OR jsonb_typeof(p_payload->'rows')<>'array'
    OR jsonb_array_length(p_payload->'rows')>10000
    OR pg_catalog.octet_length(p_payload::text)>1100000
  THEN RETURN jsonb_build_object('status','invalid'); END IF;
  SELECT * INTO previous_record FROM public.she_v24_onepage_state
    WHERE id='main' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','not_found'); END IF;
  IF previous_record.updated_at IS DISTINCT FROM p_expected_at
    THEN RETURN jsonb_build_object('status','conflict'); END IF;

  INSERT INTO public.she_v24_onepage_history(actor_id,previous_payload,previous_updated_at)
    VALUES(p_actor,previous_record.payload,previous_record.updated_at);

  UPDATE public.she_v24_onepage_state
    SET payload=p_payload,
        updated_at=GREATEST(clock_timestamp(),previous_record.updated_at+interval '1 microsecond')
    WHERE id='main' RETURNING updated_at INTO next_at;
  RETURN jsonb_build_object('status','ok','updated_at',next_at);
END;
$function$;
REVOKE ALL ON FUNCTION public.she_v24_onepage_cas(uuid,timestamptz,jsonb)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.she_v24_onepage_cas(uuid,timestamptz,jsonb) TO service_role;
COMMIT;
