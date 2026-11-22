import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import vm from "node:vm";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const read=(p)=>readFileSync(resolve(root,p),"utf8");
const source=read("mobile-export-guard.js");
const auth=read("supabase/functions/she-v24-auth/index.ts");
const migration=read("supabase/migrations/20261122_mobile_export_incident_guard.sql");
const pages=[
  ["index.html",["risk_template_excel"]],
  ["roster.html",["roster_excel","roster_audit_csv"]],
  ["dashboard.html",["education_match_csv","iris_match_csv","education_batch_csv","education_report_csv"]],
  ["health_check.html",["health_excel"]],
  ["onepage-integrated.html",["onepage_excel"]],
];
let passed=0;
async function test(name,fn){
  try{await fn();passed++;console.log("PASS",name);}
  catch(e){console.error("FAIL",name,e);process.exitCode=1;}
}
function browser(userAgent,mobileLayout){
  const token="S".repeat(43);
  const storage=new Map([["she_v24_opaque_session_test",token]]);
  const calls=[],alerts=[],redirects=[],listeners={};
  const sessionStorage={
    getItem:key=>storage.get(key)||null,
    removeItem:key=>storage.delete(key),
    setItem:(key,val)=>storage.set(key,val)
  };
  const window={
    matchMedia:()=>({matches:mobileLayout}),
    alert:message=>alerts.push(message),
    location:{assign:url=>redirects.push(url)}
  };
  window.top=window;
  const document={addEventListener:(event,handler,capture)=>{listeners[event]={handler,capture};}};
  const fetch=async(url,options)=>{
    calls.push({url,options});
    return {ok:true,json:async()=>({status:"session_revoked",enforced:true,count:1})};
  };
  const ctx=vm.createContext({window,document,navigator:{userAgent},sessionStorage,fetch,console});
  vm.runInContext(source,ctx,{filename:"mobile-export-guard.js"});
  return {window,calls,alerts,redirects,storage,listeners};
}
const android="Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36";
const desktop="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36";

await test("Mobile request is blocked before app Excel export can run",async()=>{
 const b=browser(android,true);
 assert.equal(b.window.SHEMobileExportGuard.block("roster_excel"),true);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(b.calls.length,1);
 const body=JSON.parse(b.calls[0].options.body);
 assert.equal(body.action,"mobile_export_attempt");
 assert.equal(body.export_key,"roster_excel");
 assert.equal(b.calls[0].options.headers.Authorization,"Bearer "+"S".repeat(43));
 assert.equal(b.storage.has("she_v24_opaque_session_test"),false);
 assert.ok(b.alerts[0]?.includes("종료"));
 assert.equal(b.redirects[0],"./index.html");
});
await test("Capture-phase listener traps forced click on CSS-hidden export button",async()=>{
 const b=browser(android,true);
 assert.equal(b.listeners.click.capture,true);
 let prevented=false,stopped=false;
 b.listeners.click.handler({
   target:{closest:()=>({getAttribute:()=> "health_excel"})},
   preventDefault:()=>{prevented=true;},
   stopImmediatePropagation:()=>{stopped=true;}
 });
 assert.equal(prevented,true);
 assert.equal(stopped,true);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(b.calls.length,1);
});
await test("Desktop export remains available with no security report",async()=>{
 const b=browser(desktop,false);
 assert.equal(b.window.SHEMobileExportGuard.block("roster_excel"),false);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(b.calls.length,0);
});
await test("Resized desktop blocks hidden button but never suspends desktop account",async()=>{
 const b=browser(desktop,true);
 assert.equal(b.window.SHEMobileExportGuard.block("roster_excel"),true);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(b.calls.length,0);
});
await test("Authenticated server report never accepts claimed account IDs",()=>{
 assert.match(auth,/case "mobile_export_attempt"/);
 assert.match(auth,/const \{ account, session \} = await requireAccount\(req\)/);
 assert.match(auth,/p_account_id:account\.id, p_session_id:session\.id/);
 assert.match(auth,/User-Agent/);
 assert.match(auth,/sec-ch-ua-mobile/);
});
await test("Database suspends only after 3 incidents and revokes sessions",()=>{
 assert.match(migration,/incident_count\s*>=\s*3/);
 assert.match(migration,/interval '24 hours'/);
 assert.match(migration,/interval '60 minutes'/);
 assert.match(migration,/SET revoked_at=now_at/);
 assert.match(migration,/ENABLE ROW LEVEL SECURITY/);
 assert.match(migration,/GRANT EXECUTE ON FUNCTION .* TO service_role/);
 assert.match(migration,/REVOKE ALL ON FUNCTION .* FROM PUBLIC, anon, authenticated/);
});
for(const [page,keys] of pages){
 await test(page+" contains all protected buttons with guard keys",()=>{
  const html=read(page);
  assert.match(html,/mobile-export-guard\.js\?v=20261122-1/);
  const tags=[...html.matchAll(/<button\b[^>]*data-mobile-spreadsheet-export[^>]*>/g)].map(m=>m[0]);
  assert.equal(tags.length,keys.length);
  for(const key of keys)assert.ok(tags.some(t=>t.includes('data-mobile-export-key="'+key+'"')),key);
 });
}
await test("Every application-owned Excel/CSV export function checks guard",()=>{
 assert.match(read("index.html"),/function downloadTemplateExcel\(\)\s*\{\s*if\s*\(window\.SHEMobileExportGuard\?\.block\("risk_template_excel"\)\)/);
 assert.match(read("roster.html"),/async function exportRosterExcel\(\)\s*\{\s*if\s*\(window\.SHEMobileExportGuard\?\.block\("roster_excel"\)\)/);
 assert.match(read("roster.html"),/function downloadRosterImportReport\(\)\s*\{\s*if\s*\(window\.SHEMobileExportGuard\?\.block\("roster_audit_csv"\)\)/);
 assert.match(read("health_check.html"),/async function downloadCompletedExcel\(\)\s*\{\s*if\s*\(window\.SHEMobileExportGuard\?\.block\("health_excel"\)\)/);
 assert.match(read("onepage-integrated.html"),/\$\('bExport'\)\.onclick=\(\)=>\{\s*if\s*\(window\.SHEMobileExportGuard\?\.block\('onepage_excel'\)\)/);
 const education=read("dashboard.html");
 for(const key of ["education_report_csv","education_batch_csv","education_generic_csv"])
   assert.ok(education.includes('SHEMobileExportGuard?.block("'+key+'")'));
 assert.match(education,/kind==="iris"\?"iris_match_csv":"education_match_csv"/);
});
await test("Spreadsheet imports, existing approval and Excel PC exports are unchanged",()=>{
 assert.match(read("roster.html"),/async function importRosterExcel\(file\)/);
 assert.match(read("index.html"),/id="excelFileInput"/);
 assert.match(read("onepage-integrated.html"),/id="bImport"/);
 assert.match(auth,/case "register"/);
 assert.match(auth,/case "login"/);
 assert.match(auth,/case "set_user"/);
});
console.log(`Completed ${passed} mobile export abuse regression checks.`);
if(process.exitCode)process.exit(process.exitCode);
