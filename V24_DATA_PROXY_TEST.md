# HANYANG SHE V24 — read-only data proxy (TEST ONLY)

This branch contains a **separate** Edge Function \`she-v24-data\`. The existing deployed
\`she-v24-auth\` function, legacy \`index.html\`, V23 RLS policies, database tables, and
user credentials **are not changed**.

## Purpose

The current V24 username session token is **opaque**, NOT a Supabase Auth JWT. Calling
PostgREST with it will not satisfy existing RLS. This read-only proxy instead verifies the
hashed V24 session in \`she_v24_sessions\`, checks that the account is approved, checks system
maintenance mode, and authorizes each exact \`hanyang_safety_store.id\` before allowing a
service-role query.

**Never expose SUPABASE_SERVICE_ROLE_KEY in GitHub Pages or browser code.**
CORS origin checks alone are not authentication.

## Exact scopes

- \`main_v10_meta\`, \`main_v10_chunk_0\` etc: \`safety_view\`, every approved account (matching existing RLS).
- \`main_v1_roster_master\`: super_admin or admin/viewer_admin with roster **or education** permission.
- \`main_v1_edu_schedule\`: super_admin or admin/viewer_admin with education permission.
- \`main_v1_health\`, \`main_v1_health_...\`: super_admin or admin/viewer_admin with health permission.
- \`main_v12_users_master\`: super_admin **only**.
- Any other ID: deny.

Viewer admins cannot modify data: this endpoint has **no write operation**.
The current account and permissions are re-read on EVERY request; UI-supplied role and
permissions are ignored. Denied/expired/unapproved/unknown IDs return 401/403/404.
Maintenance blocks non-super accounts.

## Actions

POST \`/functions/v1/she-v24-data\`

Header: \`Authorization: Bearer <V24-login-issued-token>\`
Content-Type: application/json

\`{"action":"store_counts","id":"main_v10_chunk_0"}\`: authorized counts + timestamp only.
\`{"action":"store_get","id":"main_v10_chunk_0"}\`: authorized full row.

## Required tests before data-read deployment or website integration

1. No token: 401.
2. Expired/revoked token: 401.
3. Logged in \`viewer_admin\` with only safety true: safety count 200; roster/edu/health and users master 403.
4. Logged in \`worker\`: safety count 200, roster count 403.
5. Approved admin with roster only: roster count 200, health and education 403.
6. Education permission (viewer/admin): roster and education counts 200.
7. Super admin: all existing known IDs allowed.
8. Unrecognized ID: 403; malformed oversized request: 400/413.
9. Account blocked/maintenance enabled: cannot read.
10. After these pass, test \`store_get\` with only non-sensitive or approved test account; inspect exposed field contents for cross-module PII before enabling regular staff.

**Privacy warning:** \`store_get\` returns entire JSON columns. They have not been redacted
for personal data inside otherwise permitted records. The read scope matches current
record-level V23 policy, not item-level confidentiality. Before production, audit the data
for sensitive cross-module information, implement server-side redaction if needed, rate
limiting, audit logging and regression tests.

## Deployment

Review the code and tests first. Then deploy as a **separate** function on the TEST project,
name \`she-v24-data\`; paste the contents of
\`supabase/functions/she-v24-data/index.ts\` into its editor. Disable the dashboard's
legacy JWT verification for THIS function (the function itself verifies the opaque bearer
token and approvals). Built-in Supabase secrets SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
remain server-side; \`SHE_V24_ALLOWED_ORIGIN\` should equal https://zozolhs.github.io.

Do not remove the existing RLS policies, grant direct table access, replace
\`she-secure.js\`, or modify production login yet.
