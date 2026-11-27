/* SHE TEST 2026-11: education queue, enrollment handoff, conflicts.
 * Uses existing application identity/authorization, records and save logic.
 * No new DB tables, no changes to attendance confirmation or automatic sync.
 */
(()=>{
"use strict";
const $id=id=>document.getElementById(id);
const handoffKey="she_education_selected_workers_v1";
const irisHandoffKey="she_iris_selected_workers_v1";
const required=["eduCommon","edu13ho","edu38ho","edu4ho","edu35ho"];
let pending=false,handoffDone=false;
const node=(tag,cls,text)=>{
 const n=document.createElement(tag);if(cls)n.className=cls;
 if(text!==undefined)n.textContent=String(text);return n;
};
function canEdit(){
 return state.authorized && window.SHESEC?.canWrite(state.user,"education")===true;
}
function today(){return todayString();}
function metrics(){
 const now=today();
 const weekEnd=new Date(now+"T00:00:00");weekEnd.setDate(weekEnd.getDate()+7);
 const end=formatDate(weekEnd);
 const events=state.events||[];
 const pending=events.filter(e=>e.kind==="education"&&pastEducationEnd(e));
 const upcoming=events.filter(e=>e.status==="scheduled"&&e.date>=now&&e.date<end);
 const active=[...(state.workerIndex?.values()||[])];
 const incomplete=active.filter(w=>!required.every(key=>educationState(w[key]).completed));
 const completed=active.length-incomplete.length;
 return {pending,upcoming,incomplete:incomplete.length,
  rate:active.length?Math.round(completed/active.length*100):0,
  active:active.length};
}
function render(){
 if(!state.authorized||!state.ready)return;
 const m=metrics();
 const display=[["sheEduUpcoming",m.upcoming.length],["sheEduPending",m.pending.length],
  ["sheEduIncomplete",m.incomplete],["sheEduRate",m.active?m.rate+"%":"—"]];
 for(const [id,value] of display)$id(id).textContent=value;
 const list=$id("sheEduPendingList");list.replaceChildren();
 const pendingItems=m.pending.slice(0,12).sort((a,b)=>a.date.localeCompare(b.date));
 if(!pendingItems.length)list.append(node("div","she-ux-muted","완료 확정을 기다리는 교육이 없습니다."));
 for(const event of pendingItems){
  const item=node("div","she-edu-pending-item");
  const info=node("div","she-edu-pending-text");
  info.append(node("strong","",event.title||"교육"),node("small","",
   event.date+" · "+(event.attendeeKeys?.length||0)+"명 등록 · "+(event.location||"장소 미정")));
  item.append(info);
  if(canEdit()){
   const action=node("button","","출석 확인·완료 확정");action.type="button";
   action.addEventListener("click",()=>openConfirm(event.id));item.append(action);
  }else item.append(node("span","she-ux-muted","열람 전용"));
  list.append(item);
 }
}
function schedule(){
 if(pending)return;pending=true;
 requestAnimationFrame(()=>{pending=false;render();});
}
function suggestCourseAttendees(){
 if(!canEdit()||!state.rosterReady)return;
 const course=$id("eventCourse").value;
 if(!course)return alert("연명부 교육 항목을 먼저 선택해 주세요.");
 if(course==="eduMsds")return alert("MSDS는 연명부 교육이력과 연동하지 않습니다. 수강자를 직접 선택해 주세요.");
 const todayDate=strictDate(today());
 const todayPlus7=new Date(todayDate);todayPlus7.setDate(todayPlus7.getDate()+7);
 let eligible=0;
 for(const [key,worker] of state.workerIndex||[]){
  if(!workerEligible(worker,course))continue;
  const st=educationState(worker[course]);
  if(!st.completed && (!st.dueDate||st.dueDate<=todayPlus7)){
   state.draftAttendees.add(key);eligible++;
  }
 }
 renderAttendeeOptions();
 $id("sheEduPresetInfo").textContent="미이수·만료·7일 이내 도래 대상 "+eligible+
 "명 자동 선택. 실제 교육 대상 적합성을 확인 후 저장하세요.";
}
function findConflicts(){
 const id=state.editingId,date=$id("eventDate").value;
 const start=timeMinutes($id("eventStart").value),end=timeMinutes($id("eventEnd").value);
 if(start===null||end===null||end<=start)return [];
 const location=$id("eventLocation").value.trim().toLowerCase();
 const attendees=new Set(state.draftAttendees);
 const conflicts=[];
 for(const e of state.events){
  if(e.id===id||e.kind!=="education"||e.status==="cancelled"||e.date!==date)continue;
  const first=timeMinutes(e.startTime),last=timeMinutes(e.endTime);
  if(first===null||last===null||start>=last||end<=first)continue;
  const sameLocation=Boolean(location&&String(e.location||"").trim().toLowerCase()===location);
  const duplicated=(e.attendeeKeys||[]).filter(key=>attendees.has(key)).length;
  const sameCourse=Boolean(
    $id("eventCourse").value && e.courseKey===$id("eventCourse").value &&
    String(e.title||"").trim().toLowerCase()===$id("eventTitle").value.trim().toLowerCase()
  );
  if(sameLocation||duplicated||sameCourse)
    conflicts.push({title:e.title,location:sameLocation,workers:duplicated,sameCourse});
 }
 return conflicts;
}
function preventConflicts(event){
 if(!canEdit())return;
 const conflicts=findConflicts();
 if(!conflicts.length)return;
 const txt=conflicts.slice(0,5).map(c=>
  c.title+(c.location?" · 교육장 중복":"")+(c.workers?" · 수강자 "+c.workers+"명 중복":"")+(c.sameCourse?" · 동일 과정 중복":"")).join("\n");
 const ok=window.confirm("같은 시간대의 일정과 중복이 있습니다.\n"+txt+
  "\n\n중복을 확인했고 그래도 저장하시겠습니까?");
 if(!ok){event.preventDefault();event.stopImmediatePropagation();}
}
function applyHandoff(){
 if(handoffDone||!state.authorized||!state.ready||!state.rosterReady)return;
 handoffDone=true;
 const params=new URLSearchParams(location.search);
 const route=params.get("register");
 const irisRaw=sessionStorage.getItem(irisHandoffKey);
 const educationRaw=sessionStorage.getItem(handoffKey);
 // Separate storage keys prevent an old education-only script consuming an iris handoff.
 const raw=route==="iris"?irisRaw:route==="education"?educationRaw:irisRaw||educationRaw;
 const source=route==="iris"||(!route&&irisRaw)?"iris":"education";
 sessionStorage.removeItem(irisHandoffKey);
 sessionStorage.removeItem(handoffKey);
 if(!raw){
  if(params.get("from")==="roster"&&route==="iris")notify("홍채등록 전달 정보가 없습니다. 연명부에서 다시 선택해 주세요.");
  return;
 }
 let payload;try{payload=JSON.parse(raw);}catch{return;}
 if(!canEdit()||payload.owner!==state.user?.id ||
  !Number.isFinite(payload.issued_at)||Date.now()-payload.issued_at>5*60*1000 ||
  !Array.isArray(payload.keys)||payload.keys.length>150)return;
 const kind=payload.kind==="iris"?"iris":"education";
 if((route&&route!==kind)||(source==="iris"&&kind!=="iris"))return notify("일정 등록 구분이 일치하지 않습니다. 연명부에서 다시 선택해 주세요.");
 const matched=[...new Set(payload.keys)].filter(key=>typeof key==="string"&&
  state.workerIndex?.has(key)&&workerEligible(state.workerIndex.get(key),"",kind));
 if(!matched.length)return notify(kind==="iris"?"홍채등록 가능 인원이 없습니다. 필수 5종 이수, 물산입사일 및 등록 가능 상태를 확인하세요.":"전달받은 인원이 현재 연명부와 일치하지 않습니다.");
 if(kind==="iris"){
  openIris(null,today());
  if($id("irisModal").hidden)return;
  state.irisDraft=new Set(matched);
  renderIrisAttendees();
  $id("irisHint").textContent="연명부 선택 "+matched.length+"명 불러옴"+(matched.length!==payload.keys.length?" · 등록 불가 "+(payload.keys.length-matched.length)+"명 제외":"")+" · 실제 홍채 대상자를 확인한 후 저장하세요.";
 }else{
  openEventModal(null,today());
  if($id("eventModal").hidden)return;
  state.draftAttendees=new Set(matched);
  renderAttendeeOptions();
  const hint=$id("sheRosterHandoffHint");
  hint.hidden=false;
  hint.textContent="연명부에서 선택한 "+matched.length+"명을 불러왔습니다. 교육 항목·일정·실제 대상자를 확인한 뒤 저장하세요.";
 }
 if(matched.length!==payload.keys.length)notify("등록 가능 조건에 맞지 않거나 연명부가 변경된 "+(payload.keys.length-matched.length)+"명은 제외되었습니다.");
}
function init(){
 $id("sheEduAutoSelect").addEventListener("click",suggestCourseAttendees);
 $id("eventForm").addEventListener("submit",preventConflicts,true);
 $id("sheEduPendingJump").addEventListener("click",()=>{
  $id("sheEduPendingList").scrollIntoView({behavior:"smooth",block:"start"});
 });
 $id("sheEduUpcomingJump").addEventListener("click",()=>{
  $id("calendarTitle").scrollIntoView({behavior:"smooth",block:"start"});
 });
 document.addEventListener("she:edu-schedule-updated",()=>{
  schedule();
  if(!handoffDone && state.rosterReady && state.ready)applyHandoff();
 });
 document.addEventListener("she:edu-roster-ready",()=>{schedule();applyHandoff();});
 // The existing async initialization/permission flow controls when data is usable.
 if(state.ready){schedule();applyHandoff();}
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});
else init();
})();
