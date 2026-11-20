# V24 기존 디자인 보존형 통합 · HANYANG-SHE-TEST

## 통합 URL

- 기존 주소 `https://zozolhs.github.io/hanyang-she-test/index.html` 를 그대로 사용.
- `index.html`의 기존 SHE 배너·모듈 카드·위험성평가 검색기 디자인과 업무 UI 유지.
- `roster.html`, `dashboard.html`, `health_check.html`의 기존 화면 유지.
- `v24-portal.html`은 앞선 독립 시험 화면이며, 본 통합의 사용 주소가 아님.

## 로그인

- `she-v24-index.js`가 V24 불투명 세션 토큰을 브라우저 탭의 `sessionStorage`에 저장하고, 매 서버 요청마다 유효성을 확인.
- 이메일·생년월일·4자리 PIN 로그인 대신 ID+비밀번호(최소 6자) 및 관리자 승인.
- 최고관리자 모달에서 회원 상태·메뉴 권한 설정, 가입 신청 2시간 열기/닫기.
- 기존 헤더에서 비밀번호 변경·로그아웃·점검 상태를 처리.
- 브라우저에 service role 키 노출 금지. V23 익명 접근 또는 오래된 사용자 세션 값은 권한 근거가 아님.

## 업무 서버

`she-v24-store`가 고정된 업무 데이터 식별자를 확인하고, 현재 승인 상태와 메뉴 권한을 서버에서 검증.
- 안전 검색은 승인된 직원에게 열람 가능. 수정은 `admin+safety` 또는 최고관리자.
- 연명부는 `roster` 권한에서 읽을 수 있고, 수정은 `admin+roster`.
- 교육 일정은 `education` 권한으로 조회, `admin+education`에서 수정.
- 건강검진 PDF→Excel 등 기존 화면 로컬 도구는 `health` 권한을 거친 후 이용.
- 교육용 연명부 RPC는 교육에 필요한 최소 필드만 제공(생년월일·연락처·혈액형·주민 관련 ID 등 제외).
- 출석 확정은 `she_v24_confirm_education` DB 함수를 통해 일정과 연명부 교육 시간을 같은 트랜잭션에서 갱신.
- 위험성평가 안전 청크+메타는 `she_v24_cas_update_safety_batch` DB 함수를 통해 함께 갱신하고 구버전 충돌을 거부.
- 업데이트 전 이전 행의 전체 스냅샷을 서비스 계정 전용 `she_v24_store_history`에 보관.
- 클라이언트 브라우저 공용 IndexedDB 백업은 사용자 간 자료 혼선을 피하기 위해 V24에서 비활성화.

## 비변경 사항 및 제한

- 운영용 별도 Supabase 프로젝트 `hanyang-safety`는 수정하지 않음.
- TEST 업무 데이터에 쓰기 시험을 하더라도 트랜잭션은 ROLLBACK.
- 기존 RLS 정책은 그대로 유지; V23 계정 자체를 DB에서 제거하거나 옛 함수 권한을 재작성하지 않음.
- 기존 UI의 일부 관리자 버튼은 서버에서 거부되는 읽기 전용 상태일 수 있음.
- 신규 위험성평가 청크 행을 생성하는 흐름은 서버 측에서 아직 허용하지 않음(기존 청크 수정 및 원자적 저장만).
- 데이터 브라우저 단위 E2E, 교육 확정 실제 데이터 변경, 여러 사용자 동시 작업은 별도 검증 필요.
- 실무 운영 전 기존 V23 `SECURITY DEFINER` 접근 경고 및 이메일 인증 경로 제거 여부를 종합 보안 검토해야 함.

## 검증 내역

- 모든 기존 HTML 파일의 인라인 JS 및 `she-v24-index.js` 문법 검사 통과.
- 원본 `index.html` 전체 CSS 및 SHE 메인 배너/모듈 카드 HTML이 동일함을 검증.
- V24 Supabase Edge Function 활성/소스 일치 확인.
- `anon`/`authenticated`가 서버 전용 갱신 함수 실행 불가.
- 안전 일괄 업데이트의 stale timestamp는 conflict 확인.
- 정상 일괄 업데이트는 history 기록을 포함해 단일 트랜잭션에서 확인하고 전체 ROLLBACK.
