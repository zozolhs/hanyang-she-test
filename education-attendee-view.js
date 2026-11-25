/* Hanyang SHE: read-only complete attendee list for each existing education schedule.
 * Uses the already-authorized dashboard state; no server writes or new data endpoint.
 */
(()=>{
"use strict";
let overlay=null, heading=null, meta=null, search=null, summary=null, tableBody=null;
let selectedEventId=null, focusReturn=null;
const create=(tag,className,text)=>{
 const element=document.createElement(tag);
 if(className)element.className=className;
 if(text!==undefined)element.textContent=String(text);
 return element;
};
const isAuthorized=()=>typeof state!=="undefined" && state.authorized===true && state.ready===true;
const educationEvent=id=>isAuthorized()?state.events?.find(e=>String(e.id)===String(id)&&e.kind==="education"):null;
const normalize=value=>String(value??"").normalize("NFKC").toLocaleLowerCase("ko").trim();
function ensureDialog(){
 if(overlay)return;
 overlay=create("div","she-attendee-overlay");
 overlay.hidden=true;overlay.style.display="none";
 const panel=create("section","she-attendee-panel");
 panel.setAttribute("role","dialog");
 panel.setAttribute("aria-modal","true");
 panel.setAttribute("aria-labelledby","sheAttendeeHeading");
 const top=create("div","she-attendee-top");
 heading=create("h2");heading.id="sheAttendeeHeading";
 const close=create("button","she-attendee-close","닫기");
 close.type="button";close.addEventListener("click",hide);
 top.append(heading,close);
 meta=create("p","she-attendee-meta");
 search=create("input","she-attendee-search");
 search.type="search";search.placeholder="이름 · 업체 · 생년월일 · 근로자번호 검색";
 search.setAttribute("aria-label","수강자 전체 명단 검색");
 summary=create("p","she-attendee-summary");
 summary.setAttribute("role","status");summary.setAttribute("aria-live","polite");
 const wrap=create("div","she-attendee-table-wrap"),table=create("table","she-attendee-table");
 const head=create("thead"),headRow=create("tr");
 ["번호","이름","업체","생년월일","근로자번호","수강 상태","실제 시간","사유"].forEach(label=>headRow.append(create("th","",label)));
 head.append(headRow);tableBody=create("tbody");table.append(head,tableBody);wrap.append(table);
 panel.append(top,meta,search,summary,wrap);overlay.append(panel);document.body.append(overlay);
 search.addEventListener("input",render);
 overlay.addEventListener("click",event=>{if(event.target===overlay)hide();});
 document.addEventListener("keydown",event=>{
  if(!overlay.hidden && event.key==="Escape"){event.preventDefault();hide();}
 });
}
function hide(){
 if(!overlay)return;
 overlay.hidden=true;overlay.style.display="none";
 selectedEventId=null;
 if(focusReturn?.isConnected)focusReturn.focus();
 focusReturn=null;
}
function rosterLookup(){
 const map=new Map();
 if(!Array.isArray(state.roster))return map;
 state.roster.forEach((raw,index)=>{
  if(!raw || typeof raw!=="object")return;
  const key=typeof attendeeKey==="function"?attendeeKey(raw,index):
   (raw.workerNo?"worker:"+String(raw.workerNo).trim():raw.uid?"uid:"+String(raw.uid).trim():"legacy:"+index);
  if(!map.has(key))map.set(key,raw);
 });
 return map;
}
function attendeeRows(event){
 const registered=Array.isArray(event.attendeeKeys)?event.attendeeKeys:[];
 const guests=Array.isArray(event.guests)?event.guests:[];
 const confirmed=Array.isArray(event.confirmedKeys)?new Set(event.confirmedKeys):null;
 const completed=event.status==="completed";
 const workers=rosterLookup();
 const outcomes=event.attendeeOutcomes || {};
 const statusText={attended:"참석·이수",partial:"부분 이수(조퇴)",absent:"미참석",postponed:"연기",cancelled:"취소"};
 const reasonText={personal:"개인사정",company:"업체 요청",work:"현장 업무 복귀",health:"건강상 사유",no_notice:"사전 연락 없음",other:"기타"};
 const rows=registered.map(key=>{
  const worker=workers.get(key);
  let attendance="등록";
  if(completed){
   const outcome=outcomes[key];
   attendance=statusText[outcome]||((confirmed===null||confirmed.has(key))?"참석·이수":"미참석");
   if(confirmed && !confirmed.has(key) && attendance==="참석·이수")attendance="미참석";
  }
  const part=completed&&outcomes[key]==="partial"?Number(event.attendeeActualHours?.[key]??event.attendeeDetails?.[key]?.hours)||0:0;
  const details=event.attendeeDetails?.[key];
  const counted=completed&&(attendance==="참석·이수"||part>0);
  return {
   name:String(worker?.name||"연명부 확인 불가"),
   company:String(worker?.company||"—"),
   birth:String(worker?.birth||worker?.birthDate||"—"),
   workerNo:String(worker?.workerNo||(/^worker:/.test(key)?key.slice(7):"—")),
   attendance,
   countedAttended:counted,partial:part>0,hours:completed?(part|| (counted?Number(event.hours)||0:0))+"h":"—",
   reason:completed&&details?[reasonText[details.reason],details.note].filter(Boolean).join(" · "):"—"
  };
 });
 guests.forEach(name=>rows.push({
  name:String(name),company:"—",birth:"—",workerNo:"—",
  attendance:"외부 수강자 · 출석 미연계",countedAttended:false,partial:false,hours:"—",reason:"—"
 }));
 return {rows,registeredCount:registered.length,guestCount:guests.length,completed};
}
function render(){
 const event=educationEvent(selectedEventId);
 if(!event){hide();return;}
 heading.textContent=event.title+" · 수강자 전체 명단";
 meta.textContent=event.date+" · "+(event.status==="completed"?"교육완료 확정":event.status==="cancelled"?"취소된 교육":"등록된 교육")+" · "+(event.location||"장소 미정");
 const info=attendeeRows(event);
 const term=normalize(search.value);
 const filtered=info.rows.filter(row=>!term ||
  [row.name,row.company,row.birth,row.workerNo].some(value=>normalize(value).includes(term)));
 const attended=info.rows.filter(row=>row.countedAttended).length;
 const partial=info.rows.filter(row=>row.partial).length;
 summary.textContent="등록 "+info.rows.length+"명 (연명부 "+info.registeredCount+"명 · 외부 "+info.guestCount+"명)"
  +(info.completed?" · 실제 참석 "+attended+"명 (부분 "+partial+"명)":"")
  +" · 검색 결과 "+filtered.length+"명";
 const fragment=document.createDocumentFragment();
 filtered.forEach((row,index)=>{
  const tr=create("tr");
  [index+1,row.name,row.company,row.birth,row.workerNo,row.attendance,row.hours,row.reason].forEach(cell=>tr.append(create("td","",cell)));
  fragment.append(tr);
 });
 if(!filtered.length){
  const tr=create("tr"),td=create("td","",info.rows.length?"검색된 수강자가 없습니다.":"등록된 수강자가 없습니다.");
  td.colSpan=8;tr.append(td);fragment.append(tr);
 }
 tableBody.replaceChildren(fragment);
}
function open(eventId){
 if(!educationEvent(eventId))return;
 ensureDialog();
 focusReturn=document.activeElement;
 selectedEventId=eventId;
 search.value="";
 render();
 if(selectedEventId===null)return;
 overlay.hidden=false;overlay.style.display="flex";
 search.focus();
}
function init(){
 const button=document.getElementById("sheAttendeeOverviewBtn");
 if(button)button.addEventListener("click",()=>{
  if(typeof state!=="undefined"&&state.editingId)open(state.editingId);
 });
}
window.SHEEducationAttendees=Object.freeze({open,close:hide});
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});
else init();
document.addEventListener("she:edu-schedule-updated",()=>{if(selectedEventId!==null)render();});
document.addEventListener("she:edu-roster-ready",()=>{if(selectedEventId!==null)render();});
document.addEventListener("visibilitychange",()=>{if(selectedEventId!==null && !document.hidden)render();});
})();
