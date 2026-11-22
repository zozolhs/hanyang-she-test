/* SHE V24 mobile spreadsheet export guard.
 * Blocks application-owned Excel/CSV export actions on mobile layouts.
 * Server records authenticated mobile user-agent attempts and revokes the
 * current session; 3 incidents within 24h temporarily lock the account.
 * Device/User-Agent and browser JS can be spoofed: this is not DRM or proof
 * that arbitrary local exports cannot occur.
 */
(()=>{
"use strict";
if(window.SHEMobileExportGuard)return;
const TOKEN_KEY="she_v24_opaque_session_test";
const AUTH_URL="https://ahmqthuympannqsrszvv.supabase.co/functions/v1/she-v24-auth";
const KEYS=new Set([
  "risk_template_excel","roster_excel","roster_audit_csv",
  "education_match_csv","iris_match_csv","education_batch_csv",
  "education_report_csv","education_generic_csv","health_excel","onepage_excel"
]);
let reporting=false;
function isMobileLayout(){
  return typeof window.matchMedia==="function"
    ? window.matchMedia("(max-width: 900px), (hover: none) and (pointer: coarse)").matches
    : /Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(navigator.userAgent||"");
}
function looksLikeMobileDevice(){
  return /Android|iPhone|iPad|iPod|Mobile|Tablet|Windows Phone/i.test(navigator.userAgent||"") ||
    navigator.userAgentData?.mobile===true;
}
async function report(key){
  if(reporting||!KEYS.has(key)||!looksLikeMobileDevice())return;
  const token=sessionStorage.getItem(TOKEN_KEY);
  if(!token||!/^[A-Za-z0-9_-]{43}$/.test(token))return;
  reporting=true;
  try{
    const response=await fetch(AUTH_URL,{
      method:"POST",
      credentials:"omit",
      cache:"no-store",
      headers:{"Content-Type":"application/json","Authorization":"Bearer "+token},
      body:JSON.stringify({action:"mobile_export_attempt",export_key:key})
    });
    if(!response.ok)throw new Error("Mobile export guard rejected security report");
    const data=await response.json();
    if(data?.enforced!==true)return;
    // Only this authenticated session is affected on its first incident.
    // The backend, not the client, decides if repeated incidents lock account.
    sessionStorage.removeItem(TOKEN_KEY);
    const message=data.status==="locked"
      ? "모바일 엑셀·CSV 다운로드 반복 시도가 감지되어 계정이 60분간 잠겼습니다. 최고관리자에게 문의하세요."
      : "모바일 엑셀·CSV 다운로드 시도가 감지되어 현재 로그인 세션이 종료되었습니다.";
    window.alert(message);
    try{
      if(window.top&&window.top!==window)window.top.location.assign("./index.html");
      else window.location.assign("./index.html");
    }catch{window.location.assign("./index.html");}
  }catch(e){
    // Fail closed for mobile export execution; do not log tokens or user data.
    console.warn("모바일 다운로드 보호 보고 실패:",e instanceof Error?e.name:"unknown");
  }finally{
    reporting=false;
  }
}
function block(key){
  if(!isMobileLayout())return false;
  if(KEYS.has(key))void report(key);
  return true;
}
// Capture force-clicks on CSS-hidden buttons before their registered handlers.
// Direct calls to each export handler are separately checked by block(key).
document.addEventListener("click",(event)=>{
  const button=event.target?.closest?.("[data-mobile-spreadsheet-export]");
  if(!button)return;
  if(block(button.getAttribute("data-mobile-export-key"))){
    event.preventDefault();
    event.stopImmediatePropagation();
  }
},true);
Object.defineProperty(window,"SHEMobileExportGuard",{
  value:Object.freeze({block,isMobileLayout}),writable:false,configurable:false
});
})();
