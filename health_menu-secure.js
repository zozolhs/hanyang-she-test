
(()=>{
"use strict";
const $=id=>document.getElementById(id);
let seq=0,pending=null,allowed=false,writable=false;
function locked(message){
 allowed=writable=false;
 $("converter").disabled=$("followup").disabled=true;
 $("menu").hidden=true;$("gate").hidden=false;$("gateText").textContent=message;$("retry").hidden=false;
}
function apply(result){
 if(!result?.ok){
  locked(result?.reason==="maintenance"?"현재 서버 점검 중입니다.": "승인된 보건 권한이 필요합니다. EHS 메인에서 로그인 또는 권한을 확인해 주세요.");
  return false;
 }
 allowed=true;writable=window.SHESEC.canWrite(result.profile,"health");
 $("converter").disabled=false;$("followup").disabled=!writable;
 $("followupLabel").textContent=writable?"사후관리 열기":"보건 수정 권한 필요";
 $("accessNote").textContent=writable?"보건 관리 권한으로 두 기능을 이용할 수 있습니다.":"변환기 열람 전용입니다. 사후관리 상세정보는 보건 수정 담당자만 이용할 수 있습니다.";
 $("gate").hidden=true;$("menu").hidden=false;
 return true;
}
async function verify(){
 if(pending)return pending;
 const n=++seq;
 const task=(async()=>{
  try{
   if(!window.SHESEC)throw Error("auth");
   const r=await window.SHESEC.guard("health",true);
   return n===seq&&apply(r);
  }catch(e){if(n===seq)locked("권한 확인에 실패했습니다. 다시 확인해 주세요.");return false;}
 })();
 pending=task;
 try{return await task;}finally{if(pending===task)pending=null;}
}
function open(kind){
 if(!allowed||(kind==="followup"&&!writable))return;
 const path=kind==="followup"?"health_followup.html":"health_check.html";
 try{sessionStorage.setItem("she_nav_from_portal",path);}catch(e){}
 location.href=path;
}
$("converter").addEventListener("click",()=>open("converter"));
$("followup").addEventListener("click",()=>open("followup"));
$("retry").addEventListener("click",verify);
document.addEventListener("she:session-reset",()=>{seq++;pending=null;locked("로그인 세션이 변경되었습니다. 다시 로그인해 주세요.");});
document.addEventListener("visibilitychange",()=>{if(!document.hidden)verify();});
window.addEventListener("pageshow",e=>{if(e.persisted){locked("접속 권한을 다시 확인합니다.");verify();}});
setInterval(()=>{if(!document.hidden&&allowed)verify();},45000);
verify();
})();
