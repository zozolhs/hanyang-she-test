import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Offline, read-only regression tests. Never contact production or use real credentials.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const load = (p) => readFileSync(resolve(root, p), "utf8");
const auth = load("supabase/functions/she-v24-auth/index.ts");
const store = load("supabase/functions/she-v24-store/index.ts");
const data = load("supabase/functions/she-v24-data/index.ts");
const bridge = load("she-v24-index.js");
const roster = load("roster.html");
const health = load("health_check.html");
const education = load("dashboard.html");
const index = load("index.html");
let passed = 0;
function test(name, fn) {
  try { fn(); console.log("PASS", name); passed++; }
  catch(error) { console.error("FAIL", name, error.message); process.exitCode = 1; }
}
const has = (source, text) => assert.ok(source.includes(text), `Expected to find: ${text}`);

test("6-character password policy and 8-hour session are preserved", () => {
  has(auth, "length < 6"); has(auth, "SESSION_HOURS = 8");
});
test("Existing registration / login / approval / password actions remain", () => {
  for(const action of ["register","login","set_user","delete_user","change_password","set_registration"])
    has(auth, `case "${action}"`);
});
test("Login and password-change abuse guards exist", () => {
  has(auth, 'she_v24_allow_login'); has(auth, 'she_v24_allow_password_change');
});
test("No JWT-only gate replaces the opaque V24 session", () => {
  for(const p of ["she-v24-auth","she-v24-store","she-v24-data"])
    has(load("supabase/config.toml"), `[functions.${p}]`);
  has(auth, "requireAccount(req"); has(store, "authenticate(req");
  has(data, "authenticatedAccount(req");
});
test("Business API authenticates BEFORE parsing large upload/save bodies", () => {
  const requestHandler = store.slice(store.lastIndexOf("Deno.serve"));
  const before = requestHandler.indexOf("const a=await authenticate(req);");
  const parse = requestHandler.indexOf("const raw=await req.text();");
  assert.ok(before>=0 && parse>=0 && before<parse);
});
test("Large Excel-backed saves keep the original 1.5 MB limit", () => {
  has(store, "MAX_BODY_BYTES = 1_500_000");
  has(store, "store_put_batch"); has(store, "store_put");
});
test("Server-only secret credentials, per-request token validation", () => {
  for(const s of [auth,store,data]) {
    has(s, 'Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")');
    has(s, "Access-Control-Allow-Origin");
  }
});
test("Cross-site framing and API responses get security headers", () => {
  for(const s of [auth,store,data]) {
    has(s, "X-Frame-Options");has(s, "Content-Security-Policy");
    has(s, "Cache-Control");
  }
});
test("Education-only roster view minimizes exposed fields", () => {
  const edu = store.slice(store.indexOf("function educationRosterView"),store.indexOf("async function educationRoster"));
  has(edu, "redacted_for_education:true");
  assert.doesNotMatch(edu, /"birth6"|"phone"|"bloodType"/i);
});
test("Business write rules retain version/concurrency control", () => {
  has(store, "she_v24_cas_update_store");
  has(store, "she_v24_cas_update_safety_batch");
  has(store, "she_v24_onepage_cas");
});
test("Excel import and export libraries and workflows remain reachable", () => {
  has(roster, "async function importRosterExcel(file)");
  has(roster, "function exportRosterExcel()");
  has(roster, "window.XLSX");
  has(roster, "window.ExcelJS");
  has(roster, 'window.SHESEC.canWrite(rosterState.user,"roster")');
  has(health, "exceljs");
  has(education, "xlsx");
});
test("Existing V24 portal session bridge is retained", () => {
  has(index, "she-v24-index.js");
  has(roster, "she-v24-index.js");
  has(health, "she-v24-index.js");
  has(bridge, "register,logout,users,setUser,deleteUser");
});
test("No raw secrets introduced in public script", () => {
  for (const s of [index,roster,health,education,bridge]) {
    assert.doesNotMatch(s, /sb_secret_[a-zA-Z0-9_-]{10,}/);
    assert.doesNotMatch(s, /SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*["'][^"']+["']/);
  }
});

// Execute the actual access-control helper source (after removing TypeScript types).
const a=store.indexOf("function canRead("), b=store.indexOf("function canWrite("), d=store.indexOf("function requireId(");
assert.ok(a>=0&&a<b&&b<d,"Missing access-control helper source");
const read=store.slice(a,b).replace("function canRead(a:Account,scope:Scope):boolean","function canRead(a,scope)");
const write=store.slice(b,d)
  .replace("function canWrite(a:Account,scope:Scope):boolean","function canWrite(a,scope)")
  .replace("scope as typeof EDIT_SCOPES[number]","scope");
const {canRead,canWrite} = new Function("EDIT_SCOPES",read+write+"return {canRead,canWrite};")(["safety","health","roster","education"]);
const acct=(role,permissions={})=>({role,status:"approved",permissions});
const permissions=[
 ["super_admin edits roster",canWrite(acct("super_admin"),"roster"),true],
 ["super_admin edits health",canWrite(acct("super_admin"),"health"),true],
 ["super_admin edits education",canWrite(acct("super_admin"),"education"),true],
 ["super_admin edits safety",canWrite(acct("super_admin"),"safety"),true],
 ["authorized admin edits roster",canWrite(acct("admin",{roster:true}),"roster"),true],
 ["authorized admin edits health",canWrite(acct("admin",{health:true}),"health"),true],
 ["authorized admin edits education",canWrite(acct("admin",{education:true}),"education"),true],
 ["authorized admin edits safety",canWrite(acct("admin",{safety:true}),"safety"),true],
 ["admin without rights cannot edit roster",canWrite(acct("admin"),"roster"),false],
 ["education admin can see limited roster",canRead(acct("admin",{education:true}),"roster"),true],
 ["education admin cannot edit roster",canWrite(acct("admin",{education:true}),"roster"),false],
 ["viewer with roster rights can read",canRead(acct("viewer_admin",{roster:true}),"roster"),true],
 ["viewer with roster rights cannot edit",canWrite(acct("viewer_admin",{roster:true}),"roster"),false],
 ["worker can read shared safety",canRead(acct("worker"),"safety"),true],
 ["worker cannot read private roster",canRead(acct("worker"),"roster"),false],
 ["worker cannot edit shared safety",canWrite(acct("worker"),"safety"),false],
 ["admin cannot write user master via store",canWrite(acct("admin",{roster:true}),"users_admin"),false],
 ["super admin cannot write user master via store",canWrite(acct("super_admin"),"users_admin"),false]
];
for (const [name,actual,expected] of permissions) test("Permissions: "+name,()=>assert.equal(actual,expected));
console.log(`Completed ${passed} security contract checks.`);
if (process.exitCode) process.exit(process.exitCode);
