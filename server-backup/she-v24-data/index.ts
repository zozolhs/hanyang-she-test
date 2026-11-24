// HANYANG SHE V24 — TEST read-only application data API.
// Deliberately separate from the deployed she-v24-auth function.
// No client-side service-role credentials, legacy PIN, or Supabase Auth JWT required.
// IMPORTANT: This service uses the service role internally, so EVERY request must
// validate the V24 opaque session AND authorize the exact data identifier.
//
// Deploy only to HANYANG-SHE-TEST after review and negative authorization tests.
// This is NOT a replacement for the existing V23 RLS policies.
import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigin = Deno.env.get("SHE_V24_ALLOWED_ORIGIN") || "https://zozolhs.github.io";
const dbURL = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!dbURL || !serviceRoleKey) throw new Error("Server credentials not configured");
const db = createClient(dbURL, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const encoder = new TextEncoder();

class APIError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
function responseHeaders(req: Request): HeadersInit {
  const origin = req.headers.get("Origin");
  return {
    ...(origin === allowedOrigin ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Headers": "authorization,content-type",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    "Vary": "Origin",
  };
}
function respond(req: Request, status: number, result: Record<string, unknown>) {
  return new Response(JSON.stringify(result), { status, headers: responseHeaders(req) });
}
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}
type Account = {
  id: string;
  status: string;
  role: string;
  permissions: Record<string, boolean> | null;
};
async function authenticatedAccount(req: Request): Promise<Account> {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.get("Authorization") || "");
  if (!match) throw new APIError(401, "로그인이 필요합니다.");
  const hash = await sha256Hex(match[1]);
  const { data: session, error: sessionError } = await db
    .from("she_v24_sessions")
    .select("account_id,expires_at,revoked_at")
    .eq("refresh_hash", hash)
    .maybeSingle();
  if (sessionError) throw new APIError(503, "세션 확인 실패");
  if (!session || session.revoked_at || !Number.isFinite(Date.parse(session.expires_at)) ||
      Date.parse(session.expires_at) <= Date.now())
    throw new APIError(401, "로그인 세션이 만료되었습니다.");

  const { data: account, error: accountError } = await db
    .from("she_v24_accounts")
    .select("id,role,status,permissions")
    .eq("id", session.account_id)
    .maybeSingle();
  if (accountError) throw new APIError(503, "계정 확인 실패");
  if (!account || account.status !== "approved")
    throw new APIError(403, "승인된 계정이 아닙니다.");

  const { data: settings, error: settingsError } = await db
    .from("she_settings").select("maintenance_mode").limit(100);
  if (settingsError) throw new APIError(503, "시스템 점검 상태 확인 실패");
  if (Array.isArray(settings) && settings.some(r => r.maintenance_mode === true) &&
      account.role !== "super_admin")
    throw new APIError(503, "시스템 점검 중입니다.");

  return account as Account;
}
type DataScope = "safety_view" | "roster" | "education" | "health" | "users_admin";
function scopeForId(id: string): DataScope | null {
  if (id === "main_v10_meta" || /^main_v10_chunk_(0|[1-9][0-9]{0,3})$/.test(id))
    return "safety_view";
  if (id === "main_v1_roster_master") return "roster";
  if (id === "main_v1_edu_schedule") return "education";
  if (/^main_v1_health(?:_[a-z0-9_-]{1,48})?$/.test(id)) return "health";
  if (id === "main_v12_users_master") return "users_admin";
  return null;
}
function permit(account: Account, scope: DataScope): boolean {
  if (account.role === "super_admin") return true;
  if (scope === "users_admin") return false;
  // Preserve the legacy worker safety search, but honor selectable
  // SAFETY read permission for administrators and viewer administrators.
  if (scope === "safety_view")
    return account.role === "worker" ||
      ((account.role === "admin" || account.role === "viewer_admin") &&
        account.permissions?.safety === true);
  if (account.role !== "admin" && account.role !== "viewer_admin") return false;
  if (scope === "roster")
    return account.permissions?.roster === true || account.permissions?.education === true;
  return account.permissions?.[scope] === true;
}
async function readStore(
  account: Account, action: "store_counts" | "store_get", data: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const id = data.id;
  if (typeof id !== "string" || id.length > 80) throw new APIError(400, "데이터 ID 입력 오류");
  const scope = scopeForId(id);
  if (!scope || !permit(account, scope)) throw new APIError(403, "해당 데이터 조회 권한이 없습니다.");

  // Fixed table, fixed column selection, exact equality. No arbitrary SQL,
  // URL, table, filter, role, or column is accepted from the caller.
  const { data: row, error } = await db
    .from("hanyang_safety_store")
    .select("id,documents,items,users,updated_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new APIError(503, "업무 데이터 조회 실패");
  if (!row) throw new APIError(404, "해당 데이터가 없습니다.");
  if (!Array.isArray(row.documents) || !Array.isArray(row.items) ||
      !Array.isArray(row.users)) throw new APIError(503, "저장 데이터 형식 오류");

  if (action === "store_counts") {
    return {
      id: row.id, scope, updated_at: row.updated_at,
      documents_count: row.documents.length,
      items_count: row.items.length,
      users_count: row.users.length,
    };
  }
  // A full row is returned only after the identical auth, status,
  // maintenance, fixed-ID and module-permission checks above.
  return { row };
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: req.headers.get("Origin") === allowedOrigin ? 204 : 403,
      headers: responseHeaders(req),
    });
  }
  if (req.method !== "POST") return respond(req, 405, { error: "POST 요청만 허용됩니다." });
  const origin = req.headers.get("Origin");
  if (origin && origin !== allowedOrigin)
    return respond(req, 403, { error: "허용되지 않은 출처입니다." });

  try {
    const sizeHint = req.headers.get("Content-Length");
    if (sizeHint && /^\d+$/.test(sizeHint) && Number(sizeHint) > 2048)
      throw new APIError(413, "요청 크기 초과");
    const raw = await req.text();
    if (raw.length > 2048) throw new APIError(413, "요청 크기 초과");
    let body: unknown;
    try { body = JSON.parse(raw); } catch { throw new APIError(400, "JSON 형식 오류"); }
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new APIError(400, "요청 형식 오류");
    const request = body as Record<string, unknown>;
    // Authentication is mandatory for every operation (including counts).
    const account = await authenticatedAccount(req);
    if (request.action !== "store_counts" && request.action !== "store_get")
      throw new APIError(400, "지원하지 않는 요청입니다.");
    return respond(req, 200, await readStore(account, request.action, request));
  } catch (e) {
    if (e instanceof APIError) return respond(req, e.status, { error: e.message });
    // Do not log request headers, tokens, personally identifying data or row contents.
    console.error("V24 data internal error", e instanceof Error ? e.name : "unknown");
    return respond(req, 500, { error: "업무 데이터 서버 오류" });
  }
});