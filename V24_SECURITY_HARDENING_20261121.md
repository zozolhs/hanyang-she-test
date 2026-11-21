# SHE TEST V24 — 외부 침입·데이터 유출 방어 강화 기록 (2026-11-21)

## 유지한 사용자 인증 방식
- 기존 **고유 아이디 + 최소 6자리 비밀번호** 로그인/회원가입 화면 유지
- 이메일 인증 없음; 최고관리자 가입 승인 유지
- 기존 업무별 조회·수정 권한, 8시간 세션, 서비스 데이터 그대로 유지
- 로그인 폼/근로자 자료/비밀번호/기존 세션 **수정하지 않음**

## 적용 변경
1. `supabase/migrations/20261121_v24_login_rate_guard.sql`
   - DB에서 원자적으로 5분당 동일 아이디 최대 12회, 전체 로그인 최대 600회 허용.
   - `service_role`만 검사 함수 호출 가능. 애플리케이션 비밀번호 해시 계산 전에 검사.
   - 실제 사용 아이디 대신 비식별 MD5 버킷값 기록. 계정 비밀번호 해시는 변경 없음.
   - 반복 공격 방어 수단이며 외부 공격을 전부 차단하는 WAF를 대체하지는 않음.
2. `supabase/functions/she-v24-auth/index.ts`
   - 로그인 시 서버 전용 위의 제한 함수 호출. 일반 가입/로그인/승인 절차는 동일.
   - 보안 JSON 헤더(캐시 금지, 콘텐츠 유형, referrer, frame, CSP) 추가.
3. `supabase/migrations/20261121_v24_close_legacy_data_api.sql`
   - 현재 V24 브라우저가 사용하지 않는 구형 Supabase Auth 직통 DB 권한 회수.
   - `authenticated` 역할의 `hanyang_safety_store` CRUD 및 `she_profiles` SELECT 권한 회수.
   - `authenticated`에서 고권한 PUBLIC `SECURITY DEFINER` RPC 12개 EXECUTE 회수.
   - 현재 Edge Functions의 `service_role` DB 읽기/쓰기·RPC 권한은 그대로 유지.
4. `she-v24-store`, `she-v24-data`
   - 서버 응답 보안 헤더 및 명시된 큰 요청 크기 조기 거절 추가.
5. `index.html`, `roster.html`, `dashboard.html`, `health_check.html`, `onepage-integrated.html`
   - 기존 JS를 허용하는 최소 CSP(`object-src 'none'; base-uri 'self'; form-action 'self'`)와 no-referrer 추가.

## 검증
- 로그인 제한 함수는 5분 동일 시험 아이디 요청 12회 허용, 13회 차단 테스트 통과.
- RPC `service_role` 실행 허용, `anon`/`authenticated` 직접 실행 거부 확인.
- 업무 저장소 직접 SELECT/UPDATE의 `authenticated` 거부, `service_role` 허용 확인.
- Supabase 보안 Advisor의 exposed SECURITY DEFINER 경고 12개 해소 확인.
- 활성 Edge Function 버전: she-v24-auth v9, she-v24-store v4, she-v24-data v2.
- 5개 HTML 인라인 스크립트 문법 점검 통과.
- **실제 관리자/근로자 계정 로그인과 모바일 브라우저 E2E 실사용 시험은 수행하지 못함.**

## 참고/잔여 위험
- GitHub Pages 공개 HTML/JS는 누구나 읽을 수 있으며 서버 인증을 대신할 수 없음.
- 사이트는 인라인 스크립트와 외부 CDN을 많이 사용하므로 강한 `script-src` CSP·SRI는 별도 검증 뒤 적용해야 함.
- 암호화된 통신, RLS, 서버 권한 검사가 중요. Origin/CORS는 API 인증의 대체물이 아님.
- DB/업무 저장에 대한 정기 백업, 로그 모니터링, 의존성 고정과 XSS 점검은 이후 단계.
- 구형 Supabase Auth 직접 연결 클라이언트는 의도적으로 더 이상 원본 데이터/RPC에 접근할 수 없음.

## 되돌릴 때
- GitHub 수정은 해당 커밋 이전 버전으로 복구.
- Edge Functions는 DB 로그인 제한 함수와 호환되는 V24 인증 함수 버전으로 재배포.
- DB 접근 권한 복구는 매우 민감하므로 사용자 승인 없이 일괄 GRANT하지 말 것.
- **기존 비밀번호/회원 권한/업무 데이터 삭제가 포함되지 않음.**

## 2차 보안 보강 및 회귀검증 (2026-11-21)

### 추가 배포
- DB `supabase/migrations/20261121_v24_sensitive_action_guard.sql`:
  관리자/승인 사용자 계정의 비밀번호 변경 시도에 한하여 동일 계정당 5분 30회 원자적 제한. 일반 로그인·업무 저장·엑셀 처리에는 적용하지 않음.
- `she-v24-auth` v10: 서버 비밀번호 변경 제한과 비정상 요청 보안 로그, JSON 요청의 UTF-8 바이트 기준 크기 검사.
- `she-v24-store` v5: 큰 업무 저장 요청의 JSON 본문 파싱 전에 유효한 V24 세션 확인, 개인정보 조회/쓰기 감사 로그, 비정상 요청의 샘플링 로그. 기존 1,500,000바이트 요청 크기 제한 유지.
- `tests/security-regression.mjs`: 인증·가입·승인·Excel 경로·업무별 접근통제 31개 오프라인 테스트.
- `tests/security-live-smoke.mjs`: 실제 배포 API 3개에서 총 18개 무자격/허위 토큰/악성 Origin/비정상 Method 차단을 확인하는 인증정보 없는 안전한 테스트.
- `.github/workflows/security-regression.yml`: 관련 파일이 변경될 때 GitHub Actions로 두 테스트 자동 실행. GitHub Actions 콘텐츠 권한 read-only.

### 검증
- 권한별 시나리오 18/18 통과(최고관리자, 관리자 권한별 조회·수정, viewer_admin, worker).
- GitHub Actions 전체 검사 **성공**:
  https://github.com/zozolhs/hanyang-she-test/actions/runs/44884501220
  (오프라인 31개 + 인증정보 없는 실서버 음성 테스트 18개).
- 비밀번호 변경 공격 시뮬레이션: 실제 계정이 아닌 시험용 UUID로 5분 30회 허용, 31회 차단, 시험 버킷 삭제.
- `she_v24_allow_password_change`는 `service_role`만 실행 가능 확인. 업무 저장소 서버 조회/저장 권한은 그대로, 구형 인증 역할의 직접 조회는 차단된 상태 확인.
- 실사용자 계정 2개, 업무 데이터셋 5개, 유효 세션 6개 유지 확인(검증 시점).
- 실제 Supabase 배포 상태: auth v10, store v5, data v2 모두 ACTIVE.

### 호환성 및 남은 검증
- 엑셀 import/export 프런트엔드 코드는 수정하지 않음. 실제 DB 연명부 463명의 원본 JSON은 약 252 KB로 기존 1.5 MB 저장 한도 이하.
- **실제 최고관리자·관리자 계정으로 브라우저에 로그인해 대량 엑셀 업로드/다운로드 및 자동저장을 수행한 종단간 시험은 미실시**. 오프라인 검사 성공은 브라우저 UI 전체 정상동작의 보증이 아님.
- 강한 CSP(인라인 JS/CDN 차단), 세션 탈취·XSS 방어, 외부 WAF, 실시간 보안 경보, 로그인된 계정의 부하/한달 내구시험은 별도 검증과 운영 준비가 필요함.
- 외부에서 운영 API에 직접 요청할 수 있다는 사실은 차단 대상이 아니며, 요청마다 유효 세션과 정확한 권한을 확인하는 것이 보안 경계임.
