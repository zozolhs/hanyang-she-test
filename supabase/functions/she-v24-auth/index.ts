// HANYANG SHE V24 - TEST username/password API.
// Independent from V23 Supabase Auth. Never expose the service-role key to browsers.
// This API DOES NOT grant a Supabase Auth JWT or direct PostgREST/RLS access.
// Application data must later be served through separately authorized server endpoints.
import { createClient } from "npm:@supabase/supabase-js@2";

const TABLE = "she_v24_accounts";
const SESSIONS = "she_v24_sessions";
const ITERATIONS = 310000;
const SESSION_HOURS = 8;
const enc = new TextEncoder();
const ALLOWED_ORIGIN = Deno.env.get("SHE_V24_ALLOWED_ORIGIN") || "https://zozolhs.github.io";
// Registration is controlled by the super-admin from the portal, and expires automatically.
const LOGIN_ID = /^[a-z0-9][a-z0-9._-]{3,31}$/;
const MODULES = ["safety", "health", "roster", "education"];

const url = Deno.env.get("SUPABASE_URL");
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!url || !serviceKey) throw new Error("Supabase server credentials not configured");
const db = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function headers(req: Request): HeadersInit {
  const origin = req.headers.get("Origin");
  return {
    ...(origin === ALLOWED_ORIGIN ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Headers": "authorization,content-type,x-she-bootstrap-secret",
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
function reply(req: Request, code: number, data: Record<string, unknown>): Response {
  // Security telemetry is intentionally sampled and never records bodies, passwords,
  // session tokens, account IDs, or full URLs. No changes to the client API contract.
  if (code === 413 || code === 429 ||
      ([400, 401, 403, 405].includes(code) && Math.random() < 0.05)) {
    console.warn("SHE_V24_SECURITY", JSON.stringify({
      service: "auth", event: "request_rejected", code, method: req.method,
      has_origin: req.headers.has("Origin"),
    }));
  }
  return new Response(JSON.stringify(data), { status: code, headers: headers(req) });
}
class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
function requiredString(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== "string" || value.length > maxLength) throw new ApiError(400, name + " 입력 오류");
  return value;
}
function credentials(body: Record<string, unknown>) {
  const loginId = requiredString(body.login_id, "아이디", 32);
  const password = requiredString(body.password, "비밀번호", 256);
  if (!LOGIN_ID.test(loginId)) throw new ApiError(400, "아이디는 영문 소문자·숫자로 시작하는 4~32자리여야 합니다.");
  if ([...password].length < 6 || [...password].length > 128) throw new ApiError(400, "비밀번호는 6~128자리여야 합니다.");
  return { loginId, password };
}
function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}
function fromHex(hex: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) throw new Error("invalid hex");
  return new Uint8Array((hex.match(/.{2}/g) || []).map(v => parseInt(v, 16)));
}
async function digest(value: string): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(value))));
}
async function pbkdf2(password: string, salt: string, rounds: number): Promise<string> {
  if (!Number.isInteger(rounds) || rounds < ITERATIONS || rounds > 1000000) throw new Error("invalid rounds");
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: fromHex(salt), iterations: rounds, hash: "SHA-256" }, key, 256
  );
  return toHex(new Uint8Array(bits));
}
function equalHex(a: string, b: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(a) || !/^[a-f0-9]{64}$/i.test(b)) return false;
  const aa = fromHex(a), bb = fromHex(b);
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}
async function newCredential(password: string) {
  const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
  return { pwd_salt: salt, pwd_hash: await pbkdf2(password, salt, ITERATIONS), pwd_iterations: ITERATIONS };
}
function publicAccount(a: Record<string, unknown>) {
  return {
    id: a.id, login_id: a.login_id, name: a.display_name, department: a.department,
    role: a.role, status: a.status, permissions: a.permissions,
  };
}
async function maintenance(): Promise<boolean> {
  const { data, error } = await db.from("she_settings").select("maintenance_mode").limit(1);
  if (error) throw new ApiError(503, "점검 상태 확인 실패");
  return Array.isArray(data) && data.some(row => row.maintenance_mode === true);
}
async function requireAccount(req: Request, onlySuper = false) {
  const header = req.headers.get("Authorization") || "";
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(header);
  if (!match) throw new ApiError(401, "로그인이 필요합니다.");
  const hash = await digest(match[1]);
  const { data: session, error } = await db.from(SESSIONS)
    .select("id,account_id,expires_at,revoked_at").eq("refresh_hash", hash).maybeSingle();
  if (error || !session || session.revoked_at || Date.parse(session.expires_at) <= Date.now())
    throw new ApiError(401, "로그인 세션이 만료되었습니다.");
  const { data: account, error: accountError } = await db.from(TABLE)
    .select("id,login_id,display_name,department,role,status,permissions")
    .eq("id", session.account_id).maybeSingle();
  if (accountError || !account || account.status !== "approved")
    throw new ApiError(403, "승인된 계정이 아닙니다.");
  if (await maintenance() && account.role !== "super_admin")
    throw new ApiError(503, "시스템 점검 중입니다.");
  if (onlySuper && account.role !== "super_admin")
    throw new ApiError(403, "최고관리자만 이용할 수 있습니다.");
  return { account, session };
}
async function register(body: Record<string, unknown>) {
  const { data: registration, error: windowError } = await db.from("she_v24_signup_config")
    .select("enabled_until").eq("id","main").maybeSingle();
  if (windowError) throw new ApiError(503, "회원가입 접수 설정을 확인할 수 없습니다.");
  if (!registration?.enabled_until || Date.parse(registration.enabled_until) <= Date.now())
    throw new ApiError(503, "신규 가입 접수가 현재 비활성화되어 있습니다.");
  const { loginId, password } = credentials(body);
  const displayName = requiredString(body.display_name, "성명", 100).trim();
  const department = typeof body.department === "string" ? body.department.trim() : "";
  if (!displayName || department.length > 80) throw new ApiError(400, "성명 또는 소속 입력 오류");
  // Atomic global TEST signup cap: 30 applications per hour. This bounds
  // public registration flooding regardless of spoofed client IP headers.
  // The server-only database function never accepts a caller-supplied bucket.
  const { data: allowed, error: guardError } = await db.rpc("she_v24_allow_signup");
  if (guardError) throw new ApiError(503, "회원가입 제한 기능을 확인할 수 없습니다.");
  if (allowed !== true) throw new ApiError(429, "회원가입 신청이 많습니다. 잠시 후 다시 신청하세요.");
  const hashFields = await newCredential(password);
  const { error } = await db.from(TABLE).insert({
    login_id: loginId, display_name: displayName, department, ...hashFields,
    role: "worker", status: "pending",
  });
  if (error) {
    if (error.code === "23505") throw new ApiError(409, "이미 사용 중인 아이디입니다.");
    throw new ApiError(503, "가입 신청을 처리할 수 없습니다.");
  }
  return { message: "가입 신청이 접수되었습니다. 최고관리자 승인 후 로그인할 수 있습니다." };
}
async function login(body: Record<string, unknown>) {
  const { loginId, password } = credentials(body);
  // Atomic server-side throttling is applied BEFORE expensive PBKDF2 work.
  // Existing username/password, approval and 8-hour session behavior are unchanged.
  const { data: allowed, error: limitError } = await db.rpc("she_v24_allow_login", {
    p_login_id: loginId,
  });
  if (limitError) throw new ApiError(503, "로그인 보호 기능을 확인할 수 없습니다.");
  if (allowed !== true) throw new ApiError(429, "로그인 요청이 많습니다. 잠시 후 다시 시도하세요.");
  const { data: account, error } = await db.from(TABLE)
    .select("id,login_id,display_name,department,role,status,permissions,pwd_salt,pwd_hash,pwd_iterations,failed_attempts,locked_until")
    .eq("login_id", loginId).maybeSingle();
  if (error) throw new ApiError(503, "인증 서버 연결 실패");
  // Uniform failure response; run a dummy KDF for unknown/locked users.
  const dummySalt = "00000000000000000000000000000000";
  const checkSalt = account?.pwd_salt || dummySalt;
  const rounds = account?.pwd_iterations || ITERATIONS;
  let verified = false;
  try { verified = equalHex(await pbkdf2(password, checkSalt, rounds), account?.pwd_hash || "0".repeat(64)); }
  catch { verified = false; }
  const locked = account?.locked_until && Date.parse(account.locked_until) > Date.now();
  if (!verified || !account || locked || account.status !== "approved") {
    if (account && !locked && !verified) {
      const { error: failError } = await db.rpc("she_v24_record_failed_login", { p_account_id: account.id });
      if (failError) throw new ApiError(503, "인증 제한 기능을 확인할 수 없습니다.");
    }
    throw new ApiError(401, "아이디·비밀번호 또는 계정 상태를 확인하세요.");
  }
  if (await maintenance() && account.role !== "super_admin") throw new ApiError(503, "시스템 점검 중입니다.");
  const { error: resetError } = await db.from(TABLE).update({ failed_attempts: 0, locked_until: null })
    .eq("id", account.id);
  if (resetError) throw new ApiError(503, "인증 처리 실패");
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const token = btoa(String.fromCharCode(...raw)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600000).toISOString();
  const { error: sessionError } = await db.from(SESSIONS).insert({
    account_id: account.id, refresh_hash: await digest(token), expires_at: expiresAt,
  });
  if (sessionError) throw new ApiError(503, "로그인 세션 생성 실패");
  return { token, expires_at: expiresAt, account: {...publicAccount(account),maintenance:await maintenance()} };
}
async function bootstrap(req: Request, body: Record<string, unknown>) {
  const secret = Deno.env.get("SHE_V24_BOOTSTRAP_SECRET") || "";
  const supplied = req.headers.get("x-she-bootstrap-secret") || "";
  // Require independent, high-entropy secret; never pass this from browser UI or commit it.
  if (secret.length < 48 || supplied.length !== secret.length) throw new ApiError(403, "초기 등록 허용 안 됨");
  let diff = 0;
  for (let i = 0; i < secret.length; i++) diff |= secret.charCodeAt(i) ^ supplied.charCodeAt(i);
  if (diff) throw new ApiError(403, "초기 등록 허용 안 됨");
  const { loginId, password } = credentials(body);
  const displayName = requiredString(body.display_name, "성명", 100).trim();
  if (!displayName) throw new ApiError(400, "성명을 입력하세요.");
  const { data, error: selectError } = await db.from(TABLE).select("id").eq("role", "super_admin").limit(1);
  if (selectError) throw new ApiError(503, "초기 상태 확인 실패");
  if (data && data.length) throw new ApiError(409, "최고관리자 계정이 이미 있습니다.");
  // she_v24_one_super partial unique index also guards concurrent bootstrap attempts.
  const { error } = await db.from(TABLE).insert({
    login_id: loginId, display_name: displayName, department: "",
    ...await newCredential(password), role: "super_admin", status: "approved",
    permissions: { safety: true, health: true, roster: true, education: true },
  });
  if (error) throw new ApiError(409, "초기 최고관리자 등록 실패");
  return { message: "최고관리자 계정 등록 완료. 초기 등록 비밀값을 즉시 폐기하세요." };
}
async function setMaintenance(req: Request, body: Record<string,unknown>) {
  const {account}=await requireAccount(req,true);
  if (typeof body.enabled !== "boolean")throw new ApiError(400,"점검 설정 형식 오류");
  const {error}=await db.from("she_settings")
    .update({maintenance_mode:body.enabled,updated_by:account.id,updated_at:new Date().toISOString()})
    .eq("singleton",true);
  if(error)throw new ApiError(503,"서버 점검 설정 저장 실패");
  return {enabled:body.enabled,maintenance:body.enabled};
}
async function registrationStatus(req: Request) {
  await requireAccount(req,true);
  const { data, error } = await db.from("she_v24_signup_config")
    .select("enabled_until").eq("id","main").maybeSingle();
  if (error) throw new ApiError(503, "회원가입 접수 설정을 확인할 수 없습니다.");
  const expiresAt = data?.enabled_until || null;
  return { enabled: !!expiresAt && Date.parse(expiresAt)>Date.now(), expires_at: expiresAt };
}
async function setRegistration(req: Request, body: Record<string, unknown>) {
  const { account }=await requireAccount(req,true);
  if(typeof body.enabled !== "boolean")throw new ApiError(400,"회원가입 설정 형식 오류");
  // Automatically expires after 2 hours even if the admin closes their browser.
  const enabled_until=body.enabled ? new Date(Date.now()+2*3600_000).toISOString() : null;
  const {error}=await db.from("she_v24_signup_config")
    .update({enabled_until,changed_by:account.id,updated_at:new Date().toISOString()}).eq("id","main");
  if(error)throw new ApiError(503,"회원가입 접수 설정 변경 실패");
  return {enabled:body.enabled,expires_at:enabled_until};
}
async function updateUser(body: Record<string, unknown>) {
  const accountId = requiredString(body.account_id, "계정", 64);
  if (!/^[a-f0-9-]{36}$/i.test(accountId)) throw new ApiError(400, "계정 식별자 오류");
  const role = body.role, status = body.status, permissions = body.permissions;
  if (!["worker", "admin", "viewer_admin"].includes(String(role)) ||
      !["pending", "approved", "blocked", "rejected"].includes(String(status)))
    throw new ApiError(400, "역할 또는 승인 상태 오류");
  if (!permissions || typeof permissions !== "object" || Array.isArray(permissions) ||
      MODULES.some(key => typeof (permissions as Record<string, unknown>)[key] !== "boolean"))
    throw new ApiError(400, "메뉴 접근 권한 형식 오류");
  const normalized = Object.fromEntries(MODULES.map(key => [key, (permissions as Record<string, boolean>)[key]]));
  const { data: target, error: targetError } = await db.from(TABLE)
    .select("role").eq("id", accountId).maybeSingle();
  if (targetError || !target || target.role === "super_admin")
    throw new ApiError(403, "변경할 수 없는 계정입니다.");
  const { error } = await db.from(TABLE)
    .update({ role, status, permissions: normalized, updated_at: new Date().toISOString() })
    .eq("id", accountId).neq("role", "super_admin");
  if (error) throw new ApiError(503, "계정 권한 변경 실패");
  if (status !== "approved") {
    await db.from(SESSIONS).update({ revoked_at: new Date().toISOString() })
      .eq("account_id", accountId).is("revoked_at", null);
  }
  return { message: "계정 권한 변경 완료" };
}
async function deleteUser(req: Request, body: Record<string, unknown>) {
  // The opaque bearer session is freshly validated for super_admin privileges.
  const { account } = await requireAccount(req, true);
  const accountId = requiredString(body.account_id, "삭제 계정", 64);
  const expectedLoginId = requiredString(body.expected_login_id, "확인 아이디", 32);
  if (!/^[a-f0-9-]{36}$/i.test(accountId) ||
      !LOGIN_ID.test(expectedLoginId) || accountId === account.id)
    throw new ApiError(400, "삭제 계정 또는 확인 아이디가 올바르지 않습니다.");

  // Atomic server-only procedure verifies both role and target ID again,
  // permanently deletes the account, cascades its sessions, and records
  // a minimal audit entry. No client-provided role or status is trusted.
  const { data, error } = await db.rpc("she_v24_delete_account", {
    p_actor_id: account.id,
    p_target_id: accountId,
    p_expected_login_id: expectedLoginId,
  });
  if (error) throw new ApiError(503, "계정 삭제를 처리할 수 없습니다.");
  if (data?.status === "forbidden") throw new ApiError(403, "최고관리자 계정만 삭제를 실행할 수 있습니다.");
  if (data?.status === "not_found") throw new ApiError(409, "계정이 없거나 아이디가 변경되었습니다. 회원 목록을 새로고침하세요.");
  if (data?.status !== "deleted") throw new ApiError(400, "삭제 요청이 올바르지 않습니다.");
  return { message: "계정이 삭제되고 기존 로그인 세션이 종료되었습니다.", login_id: data.login_id };
}
async function changePassword(req: Request, body: Record<string, unknown>) {
  const { account } = await requireAccount(req);
  // A stolen session cannot request unlimited PBKDF2 password guesses.
  // The 30-per-5-minute ceiling applies only to changing a password.
  const { data: permitted, error: limitError } = await db.rpc("she_v24_allow_password_change", {
    p_account_id: account.id,
  });
  if (limitError) throw new ApiError(503, "비밀번호 변경 보호 기능을 확인할 수 없습니다.");
  if (permitted !== true) throw new ApiError(429, "비밀번호 변경 요청이 많습니다. 잠시 후 다시 시도하세요.");
  const oldPassword = requiredString(body.old_password, "현재 비밀번호", 256);
  const newPassword = requiredString(body.new_password, "새 비밀번호", 256);
  if ([...newPassword].length < 6 || [...newPassword].length > 128)
    throw new ApiError(400, "새 비밀번호는 6~128자리여야 합니다.");
  const { data: existing, error } = await db.from(TABLE)
    .select("pwd_salt,pwd_hash,pwd_iterations").eq("id", account.id).single();
  if (error || !existing || !equalHex(
    await pbkdf2(oldPassword, existing.pwd_salt, existing.pwd_iterations), existing.pwd_hash
  )) throw new ApiError(401, "현재 비밀번호가 일치하지 않습니다.");
  const { error: updateError } = await db.from(TABLE).update({
    ...await newCredential(newPassword), updated_at: new Date().toISOString(),
  }).eq("id", account.id);
  if (updateError) throw new ApiError(503, "비밀번호 변경 실패");
  const { error: revokeError } = await db.from(SESSIONS)
    .update({ revoked_at: new Date().toISOString() }).eq("account_id", account.id).is("revoked_at", null);
  if (revokeError) throw new ApiError(503, "기존 세션 해제 실패. 관리자에게 문의하세요.");
  return { message: "비밀번호가 변경되었습니다. 다시 로그인하세요." };
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, {
    status: req.headers.get("Origin") === ALLOWED_ORIGIN ? 204 : 403, headers: headers(req),
  });
  if (req.method !== "POST") return reply(req, 405, { error: "POST 요청만 허용됩니다." });
  const origin = req.headers.get("Origin");
  if (origin && origin !== ALLOWED_ORIGIN) return reply(req, 403, { error: "허용되지 않은 출처입니다." });
  try {
    const lengthHint = req.headers.get("Content-Length");
    if (lengthHint && /^\d+$/.test(lengthHint) && Number(lengthHint) > 8192)
      throw new ApiError(413, "요청 크기 초과");
    const raw = await req.text();
    if (enc.encode(raw).byteLength > 8192) throw new ApiError(413, "요청 크기 초과");
    const body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new ApiError(400, "요청 형식 오류");
    let result: Record<string, unknown>;
    switch (body.action) {
      case "register": result = await register(body); break;
      case "login": result = await login(body); break;
      case "bootstrap": result = await bootstrap(req, body); break;
      case "me": {
        const { account } = await requireAccount(req);
        result = { account: {...publicAccount(account),maintenance:await maintenance()} }; break;
      }
      case "logout": {
        const { session } = await requireAccount(req);
        const { error } = await db.from(SESSIONS).update({ revoked_at: new Date().toISOString() })
          .eq("id", session.id);
        if (error) throw new ApiError(503, "로그아웃 처리 실패");
        result = { message: "로그아웃 완료" }; break;
      }
      case "users": {
        await requireAccount(req, true);
        const { data, error } = await db.from(TABLE)
          .select("id,login_id,display_name,department,role,status,permissions,created_at")
          .order("created_at", { ascending: false }).limit(500);
        if (error) throw new ApiError(503, "회원 목록 확인 실패");
        result = { users: data }; break;
      }
      case "set_user": {
        await requireAccount(req, true);
        result = await updateUser(body); break;
      }
      case "delete_user": result = await deleteUser(req, body); break;
      case "set_maintenance": result = await setMaintenance(req, body); break;
      case "registration_status": result = await registrationStatus(req); break;
      case "set_registration": result = await setRegistration(req, body); break;
      case "change_password": result = await changePassword(req, body); break;
      default: throw new ApiError(400, "지원하지 않는 요청입니다.");
    }
    return reply(req, 200, result);
  } catch (err) {
    if (err instanceof ApiError) return reply(req, err.status, { error: err.message });
    if (err instanceof SyntaxError) return reply(req, 400, { error: "JSON 형식 오류" });
    console.error("V24 auth internal error", err instanceof Error ? err.name : "unknown");
    return reply(req, 500, { error: "서버 인증 오류" });
  }
});
