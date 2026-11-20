# HANYANG SHE V24 — TEST 통합 포털

## 환경과 목적

- Target database: Supabase project **HANYANG-SHE-TEST** (ref \`ahmqthuympannqsrszvv\`)
- Existing repository: \`zozolhs/hanyang-she-test\` / GitHub Pages
- New test portal URL (once merged): \`https://zozolhs.github.io/hanyang-she-test/v24-portal.html\`
- Existing \`index.html\` **unchanged** (legacy site remains separately available)
- Existing V23 RLS policies, existing data, existing \`she-v24-data\` **unchanged**
- This is a **new V24 test portal**, not yet a full UI port of every legacy feature.

## New capabilities

1. Unique username/password login, six-character minimum; no email.
2. Super-admin account approval and per-module read/write roles.
3. User-visible current role/permissions, password change, logout and server-side session check.
4. Safety: read/search 1,258 stored assessment rows; authorized admin edits.
5. Roster: read/search 463 rows; authorized roster admin edits.
6. Education: list/search 5 events; authorized education admin creates/edits schedule metadata.
7. Health: health-authorized section showing existing health store IDs/counts; no health store IDs were present when inspected; **health checkup operations have not been integrated**.
8. New account applications can be opened by super-admin for 2 hours; automatically disabled thereafter. New applications are limited to 30 per hour **globally** in TEST.

## Data authorization

\`supabase/functions/she-v24-store/index.ts\` validates hashed V24 bearer session against DB on **every request**, requires approved account and no maintenance lockout, checks a fixed allowlist of record IDs and roles, and only then uses the server-only service role to query data.

- \`safety\` reads: any approved account; \`admin\` with safety permission may write; super-admin may write.
- \`roster\` reads: admin/viewer_admin with roster permission, or education permission; **education-only reads are field-redacted** and do not include birth date, phone number, blood group, employee ID or free-text notes.
- \`education\` reads: education permission for admin/viewer_admin.
- \`health\` reads: health permission for admin/viewer_admin.
- \`main_v12_users_master\`: super-admin only; **no write via this endpoint**.
- \`worker\`: only baseline safety viewing, not data editing.
- \`viewer_admin\`: server-side read only.
- \`store_put\`: only super-admin or admin with the relevant module permission; never client-authoritative role values; fixed id allowlist; valid JSON arrays.
- No direct RLS/Data API access with the V24 opaque bearer token.

## Write integrity

Database migration \`20261120_v24_atomic_store_history.sql\` creates a service-only \`she_v24_cas_update_store\` compare-and-swap function and \`she_v24_store_history\` rollback history table. Stale \`updated_at\` returns a conflict without overwriting another user's changes. Backups contain potentially sensitive complete previous rows and are inaccessible to normal clients (RLS + role grants). This is not a full export/restore solution.

## Verification conducted

- All 5 original store rows, 1,258 safety items, 463 roster items, 5 education events and 2 V24 accounts remained intact after migrations and function deployment.
- DB grants: anon/authenticated cannot execute CAS function, service role can; history table RLS enabled.
- CAS outdated expected timestamp returned \`conflict\`; tested inside rollback transaction.
- Signup gate function returned true within the cap when called as service role in rollback transaction.
- JS syntax parsed successfully.
- Edge Functions \`she-v24-auth\` (updated) and \`she-v24-store\` (new) active with internal opaque bearer checks, not Supabase JWT verification.

## Still required before real operational use

- **Human browser end-to-end test** against the new \`v24-portal.html\` site, including login, read-only accounts, admin changes and conflicts.
- **Complete legacy module feature parity:** original \`index.html\` contains extensive document upload/search, risk-assessment workflows, reports, education attendance confirmation, health/checkup flows and more. These are **not fully ported**. The new portal supports the narrower workflows listed above.
- Test account-only sample data edits. Avoid editing real employee data until browser verification, backup/restore drill and audit review.
- Per-user/IP throttling and security event monitoring, request/body denial-of-service controls, rate limits on login and read endpoints (registration has a global hourly cap only).
- Security review of existing V23 SECURITY DEFINER functions and old email/PIN flows. Existing portal remains accessible and has not been secured by new V24 code.
- Operational acceptance of access scope, sensitive roster fields and security regression tests.

## Launching controlled staff signup

1. Super-admin signs into \`v24-portal.html\`, selects **최고관리자 / 회원 승인**.
2. Click **신규 가입 접수 2시간 열기**.
3. Staff register with unique IDs and 6+ character passwords. Request quota is 30/hour across the site.
4. Super-admin approves specific users and grants the minimum required permissions.
5. Window closes after two hours; admin can close sooner.

Avoid copying tokens or real passwords into chat or public logs.
