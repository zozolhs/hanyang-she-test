# HANYANG SHE V24 — 별도 TEST 인증 서버 준비

**현재 상태: 구현 초안 / 미배포.** 기존 V23.1 페이지 및 \`main\`은 그대로 유지한다.
이 브랜치의 Edge Function은 V24 계정 테이블에 대한 별도 세션 API다. **이 토큰은 Supabase JWT가 아니며, V23.1 RLS 또는 기존 \`she_v24_can_access\` 함수가 검증하는 JWT를 대체하지 않는다.** 기존 \`hanyang_safety_store\`를 이 토큰으로 직접 조회하거나 수정해서는 안 된다.

## 현재 추가된 항목

- \`supabase/functions/she-v24-auth/index.ts\`: 계정 등록(관리자가 허용한 경우에만), 로그인, 내 계정, 로그아웃, 최고관리자 회원 목록/승인·권한 수정, 비밀번호 변경, 초기 최고관리자 등록을 제공한다.
- \`supabase/migrations/20261120_v24_login_failure_guard.sql\`: 로그인 실패 횟수 증가/잠금 함수 추가. 기존 V23 테이블과 함수는 수정하지 않는다.
- \`supabase/config.toml\`: 이 함수에 한하여 자체 토큰 검증을 쓰도록 JWT 게이트를 해제한다.

## TEST 배포 전 필수 조건

1. TEST 프로젝트만 대상으로 Supabase CLI를 연결한다. 잘못된 프로젝트에 배포하지 않는다.
2. SQL Editor에서 먼저 \`20261120_v24_login_failure_guard.sql\` 실행.
3. 서버 환경변수 \`SUPABASE_URL\`, \`SUPABASE_SERVICE_ROLE_KEY\`, \`SHE_V24_ALLOWED_ORIGIN=https://zozolhs.github.io\` 설정. Service-role 키는 절대로 GitHub, 정적 페이지, 브라우저 또는 채팅에 게시하지 않는다.
4. 가입 접수를 시험할 때에만 \`SHE_V24_ALLOW_REGISTRATION=true\`를 설정한다. 초기값은 비활성이다.
5. 최초 최고관리자 등록용 고엔트로피 \`SHE_V24_BOOTSTRAP_SECRET\`을 서버 비밀값으로 임시 설정. 비밀값을 포함한 요청은 신뢰할 수 있는 로컬 서버/CLI에서만 보내고 웹 프런트엔드에서 사용하지 않는다. 초기 등록 후 즉시 폐기한다.
6. TEST 프로젝트에 한해 배포: \`supabase functions deploy she-v24-auth --no-verify-jwt\`. 배포 전 테스트 환경변수·프로젝트 ID 확인.
7. 서버 배포 후 정상/오류 경로, 계정 승인, 세션 폐기, 잠금, 유지보수, 권한변경, 콘솔 로그 노출 여부를 검증한다.

## 중요한 미완료 작업

- IP 기반 rate limiting, 이상 로그인 감지, 감사 로그, CSRF/Origin 위협 모델, 백업·복구, 운영키 관리 검증.
- 기존 HTML의 노출된 고정 관리자 암호와 4자리 PIN 인증 루틴 제거 및 강제 서버 권한 확인.
- \`she-secure.js\` / \`index.html\` / 각 업무 페이지의 인증 흐름을 일원화해야 한다.
- 기존 V23.1 RLS와 V24 자체 세션은 별개다. 모든 업무 데이터 접근을 Edge Function 경유로 보호하거나, 올바른 서명 JWT·인증 연동·RLS를 별도로 완성해야 한다. 현재로서는 **V24 사용자로 기존 업무 데이터 접근 불가**를 정상/안전한 초기 상태로 본다.
- 공개 Pages 사이트의 로그인 UI/기존 V23 인증 경로는 **수정하지 않았다.**
- 배포, 사용자 등록, 로그인 기능 전환, main 병합 모두 별도 검증 이후 진행.

## API
모든 호출: \`POST /functions/v1/she-v24-auth\`, JSON \`action\`.
- 비로그인: \`register\` (신규 가입 활성화 필요), \`login\`; 초기 등록 \`bootstrap\` (서버 비밀값 필요).
- \`Authorization: Bearer <opaque-token>\` 필수: \`me\`, \`logout\`, \`change_password\`.
- 최고관리자만: \`users\`, \`set_user\`.
- 토큰은 JWT가 아니므로 PostgREST 직접 호출의 Authorization에 사용하면 안 된다.

실서비스 전환이나 사용 안내 시 위 미완료 항목을 먼저 해결해야 한다.
