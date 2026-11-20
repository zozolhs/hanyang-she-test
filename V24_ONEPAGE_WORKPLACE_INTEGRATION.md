# HANYANG SHE TEST — ONE-PAGE 통합 (2026-11-20)

## 사용자 진입 경로
`index.html` → SAFETY 위험성평가 검색기 → **작업장 평가** → **ONE-PAGE 수시 위험성평가**.
같은 작업장 평가 탭의 **기존 작업장 평가서**에서 기존 문서 카드/항목 조회로 즉시 복귀 가능. 메인 배너·CSS·원본 위험성평가 검색 화면 유지.

## 원본으로부터 보존한 기능
- 28개 업로드 ONE-PAGE 초기 평가 기록(월별 수시 위험성평가 현황)
- 월별·공종별 분류, 미비점/제출 현황 집계, 상세 내용 수정, 행 등록/삭제
- 사진 첨부·보기·설명 변경·삭제, 월별 현장사진 PDF
- 엑셀 가져오기/내보내기, 월간 한페이지 보기·디자인·이미지 저장·인쇄

## 인증/저장 방식의 변경
원본 파일의 `HANYANG_SESSION` · `HANYANG_TOKEN` · `/api/store` 서버 저장, 브라우저 전역 IndexedDB 동기화 제거.
- `onepage-integrated.html`: 기존 ONE-PAGE UI를 iframe으로 **작업장 평가 탭 내부에서만 지연 로드**. V24 세션 없으면 업무 데이터 접근 안 됨.
- `she-v24-store`: 요청마다 현재 세션, 가입 승인, 점검 상태, safety 권한 서버 검증.
- 모든 승인된 V24 사용자: ONE-PAGE 읽기.
- 최고관리자 또는 `admin`이면서 SAFETY 권한을 가진 사용자: 기록/사진 수정.
- `she_v24_onepage_state`: 기존 5개 `hanyang_safety_store`와 분리된 업무 행.
- `she_v24_onepage_cas`: 버전 충돌 시 변경 거부 및 이전 자료 이력 저장.
- `she_v24_onepage_photos`: RLS/권한 차단된 서버 사진 원본·미리보기.
- 관리자 변경 내용 자동 저장. 실패 또는 충돌 시 덮어쓰지 않고 경고, 화면 이탈시 확인.

## 자료 안전
- TEST DB에는 업로드한 초기 28건이 이관돼 있음. 공개 GitHub의 SQL migration에는 이름이 포함된 실제 기록을 저장하지 않고, 신규 환경에는 빈 구조만 생성. `ON CONFLICT DO NOTHING`으로 기존 ONE-PAGE 상태는 보존.
- 업로드 HTML에 포함된 28개 초기 기록은 공개 `onepage-integrated.html`에서 제거해 비로그인 상태에서 노출되지 않음.
- 업로드된 HTML 파일에는 **IndexedDB에 저장된 과거 실제 사진 파일이 포함되어 있지 않음**. 초기 사진 수는 0. 원본 기기·옛 서버 사진이 필요하면 별도 백업/이관 절차가 필요함.
- 기존 안전자료 1,258건·연명부 463명·교육 일정 5건은 변경하지 않음.
- 위 migration, Edge Function은 TEST 프로젝트 `HANYANG-SHE-TEST`에만 배포.

## 확인한 테스트
- V24 승인 계정 역할 4종(client mock): super_admin/admin SAFETY는 쓰기, viewer_admin/worker는 읽기 전용.
- stale timestamp 저장 시 DB `conflict` 반환.
- 동일 데이터 원자 저장/이력 생성 시험은 `ROLLBACK` 처리.
- 사진 메타데이터 DB insert 및 공개 role 권한 차단은 ROLLBACK 시험.
- 원본 메인 CSS·배너·위험성평가 문서 검색 UI 원형 유지 비교.
- 신규 ONE-PAGE 파일의 JS 파싱 성공. 신규 파일에서 예전 /api/store/인증/IndexedDB 코드 제거.
- 실사용 브라우저에서 사진 업로드, 인쇄·PDF·Excel 기능 전체 E2E는 최종 미확인. 월요일 실제 직원 사용 전 대표 계정으로 반드시 확인.

## 제한
사진 1장 약 1MB 이하의 데이터 URL로 전송(서버 요청 최대 1.5MB). 대용량 사진은 다시 압축 필요.
저장 충돌 발생 후에는 관리자가 화면을 닫지 말고 충돌을 해결할 때까지 원본을 유지해야 함.
긴급한 복구/감사는 `she_v24_onepage_history`의 서비스 전용 이력을 사용.
