/* SHE EDUCATION TEST: read-only history and upcoming expiry lookup.
 * Reuses authenticated education roster already fetched by dashboard.
 * Does not issue new API calls, mutate saved data, or change ROSTER permissions.
 */
(()=>{
"use strict";
const COURSE_FIELDS=[
 ["eduCommon","공통교육"],["edu13ho","13호(운반)"],["edu38ho","38호(화재)"],
 ["edu4ho","4호(인화)"],["edu35ho","35호(허가)"],["eduClosed","34호(밀폐)"],
 ["eduMsds","MSDS"],["edu2ho","2호(용접)"],["eduCrane","크레인"]
];
const REQUIRED=["eduCommon","edu13ho","edu38ho","edu4ho","edu35ho"];
const MAX_ROWS=35;
let overlay=null,mode=null,range="nearest",status="all",page=0,returnFocus=null;
let title,description,filters,search,summary,tableHead,tableBody,pagerInfo,prev,next;
const e=(tag,cls,value)=>{
 const element=document.createElement(tag);
 if(cls)element.className=cls;
 if(value!==undefined)element.textContent=String(value);
 return element;
};
const textVal=v=>String(v??"").trim();
const normalize=v=>textVal(v).normalize("NFKC").toLocaleLowerCase("ko");
const canRead=()=>typeof state!=="undefined"&&state.authorized===true&&state.ready===true&&
 state.rosterReady===true&&state.rosterAllowed===true&&Array.isArray(state.roster);
function workers(){
 return state.roster.filter(w=>w&&typeof w==="object");
}
function nextDate(value){
 return value instanceof Date&&!Number.isNaN(value.getTime())?formatDate(value):"—";
}
function setRange(value){
 range=value;page=0;render();
}
function setStatus(value){
 status=value;page=0;render();
}
function close(){
 if(!overlay)return;
 overlay.hidden=true;overlay.style.display="none";mode=null;
 if(returnFocus?.isConnected)returnFocus.focus();
 returnFocus=null;
}
function ensure(){
 if(overlay)return;
 overlay=e("div","she-lookup-overlay");overlay.hidden=true;overlay.style.display="none";
 const dialog=e("section","she-lookup-dialog");
 dialog.setAttribute("role","dialog");dialog.setAttribute("aria-modal","true");
 dialog.setAttribute("aria-labelledby","sheLookupTitle");
 const header=e("div","she-lookup-header");
 const headings=e("div");title=e("h2");title.id="sheLookupTitle";
 description=e("p","she-lookup-note");
 headings.append(title,description);
 const closeBtn=e("button","btn btn-outline btn-sm","닫기");
 closeBtn.type="button";closeBtn.addEventListener("click",close);
 header.append(headings,closeBtn);
 filters=e("div","she-lookup-filters");
 const searchWrap=e("div","she-lookup-search");
 search=e("input");search.type="search";search.id="sheLookupSearch";
 search.placeholder="근로자번호 · 이름 · 업체 · 생년월일 검색";
 search.setAttribute("aria-label","근로자 검색");
 search.addEventListener("input",()=>{page=0;render();});
 searchWrap.append(search);
 summary=e("p","she-lookup-summary");summary.setAttribute("aria-live","polite");
 const wrap=e("div","she-lookup-table-wrap");
 const table=e("table","she-lookup-table");
 tableHead=e("thead");tableBody=e("tbody");table.append(tableHead,tableBody);wrap.append(table);
 const footer=e("div","she-lookup-footer");
 pagerInfo=e("span");
 prev=e("button","btn btn-outline btn-sm","이전");prev.type="button";
 prev.addEventListener("click",()=>{page=Math.max(0,page-1);render();});
 next=e("button","btn btn-outline btn-sm","다음");next.type="button";
 next.addEventListener("click",()=>{page++;render();});
 footer.append(pagerInfo,prev,next);
 const note=e("p","she-lookup-note");
 note.id="sheLookupFootnote";
 dialog.append(header,filters,searchWrap,summary,wrap,footer,note);
 overlay.append(dialog);document.body.append(overlay);
 overlay.addEventListener("click",event=>{if(event.target===overlay)close();});
 document.addEventListener("keydown",event=>{
  if(overlay&&!overlay.hidden&&event.key==="Escape"){event.preventDefault();close();}
 });
}
function setColumns(labels){
 const tr=e("tr");
 labels.forEach(label=>tr.append(e("th","",label)));
 tableHead.replaceChildren(tr);
}
function addTextCells(tr,values){
 for(const value of values)tr.append(e("td","",value));
}
function renderEmpty(text,columns){
 const tr=e("tr"),td=e("td","she-lookup-empty",text);
 td.colSpan=columns;tr.append(td);tableBody.replaceChildren(tr);
}
function pageRows(rows){
 const count=Math.max(1,Math.ceil(rows.length/MAX_ROWS));
 page=Math.max(0,Math.min(page,count-1));
 pagerInfo.textContent="조회 "+rows.length.toLocaleString("ko-KR")+"건 · "+(page+1)+" / "+count+" 페이지";
 prev.disabled=page===0;next.disabled=page>=count-1;
 return rows.slice(page*MAX_ROWS,(page+1)*MAX_ROWS);
}
function badge(value){
 const node=e("span","she-lookup-pill "+value.kind,value.label);
 if(value.tooltip)node.title=value.tooltip;
 return node;
}
function statusOf(worker,key,today){
 const raw=textVal(worker[key]);
 const v=educationState(raw,today);
 if(v.completed)return {label:"8h 이수",kind:"done",tooltip:raw};
 if(v.expired)return {label:"만료",kind:"expired",tooltip:raw+" / 만료일 "+nextDate(v.dueDate)};
 if(v.hours>0)return {label:v.hours+"h 진행",kind:"partial",tooltip:raw+" / 만료 예정 "+nextDate(v.dueDate)};
 return {label:"미이수",kind:"none",tooltip:raw||"교육기록 없음"};
}
function buildHistoryFilters(){
 filters.replaceChildren();
 const choices=[["all","전체"],["active","재직자"],["resigned","퇴사자"],["complete","5종 8h 이수"],["incomplete","5종 미이수"]];
 choices.forEach(([key,label])=>{
  const b=e("button","she-lookup-filter",label);b.type="button";
  b.setAttribute("aria-pressed",String(status===key));
  b.addEventListener("click",()=>setStatus(key));filters.append(b);
 });
}
function buildExpiryFilters(){
 filters.replaceChildren();
 const choices=[["nearest","가장 빠른 만료순"],["week","7일 이내"],["month1","1개월 이내"],["month2","2개월 이내"]];
 choices.forEach(([key,label])=>{
  const b=e("button","she-lookup-filter",label);b.type="button";
  b.setAttribute("aria-pressed",String(range===key));
  b.addEventListener("click",()=>setRange(key));filters.append(b);
 });
}
function renderHistory(){
 const today=strictDate(todayString());
 const all=workers();
 const q=normalize(search.value);
 const people=all.filter(w=>{
  const resigned=Boolean(textVal(w.resignDate));
  if(status==="active"&&resigned)return false;
  if(status==="resigned"&&!resigned)return false;
  if(status==="complete"||status==="incomplete"){
   const complete=REQUIRED.every(key=>educationState(w[key],today).completed);
   if(status==="complete"&&!complete)return false;
   if(status==="incomplete"&&complete)return false;
  }
  return !q||[w.workerNo,w.name,w.company,w.birth].some(v=>normalize(v).includes(q));
 });
 people.sort((a,b)=>Number(Boolean(textVal(a.resignDate)))-Number(Boolean(textVal(b.resignDate)))||
  textVal(a.company).localeCompare(textVal(b.company),"ko")||
  textVal(a.workerNo).localeCompare(textVal(b.workerNo),"ko",{numeric:true}));
 title.textContent="교육이력관리 상세보기";
 description.textContent="근로자별 교육 항목의 8h 이수·진행·만료·미이수 상태를 한눈에 확인합니다.";
 buildHistoryFilters();
 setColumns(["근로자번호","이름","업체","생년월일",...COURSE_FIELDS.map(([,label])=>label),"정기교육(최근)"]);
 const visible=pageRows(people),frag=document.createDocumentFragment();
 for(const w of visible){
  const tr=e("tr",textVal(w.resignDate)?"she-lookup-retired":"");
  addTextCells(tr,[textVal(w.workerNo)||"—",textVal(w.name)||"—",textVal(w.company)||"—",textVal(w.birth)||"—"]);
  for(const [key] of COURSE_FIELDS){
   const td=e("td");td.append(badge(statusOf(w,key,today)));tr.append(td);
  }
  tr.append(e("td","",textVal(w.eduRegular)||"—"));frag.append(tr);
 }
 if(!people.length)renderEmpty("해당 조건에 맞는 근로자가 없습니다.",14);
 else tableBody.replaceChildren(frag);
 const retired=all.filter(w=>Boolean(textVal(w.resignDate))).length;
 summary.textContent="전체 "+all.length.toLocaleString("ko-KR")+"명 · 재직 "+(all.length-retired).toLocaleString("ko-KR")+
 "명 · 퇴사 "+retired.toLocaleString("ko-KR")+"명 · 검색 "+people.length.toLocaleString("ko-KR")+"명";
 document.getElementById("sheLookupFootnote").textContent=
  "교육별 8h 이수 기준이며, 만료는 기존 연명부 규칙(교육일 + 2개월, 8h 미만)을 따릅니다. 정기교육 칸은 가장 최근 날짜로 월별 이수 판정과 구분됩니다. 퇴사일 입력자는 회색 표시합니다.";
}
function expiryEntries(today){
 const items=[];
 for(const w of workers()){
  if(textVal(w.resignDate))continue; // upcoming education concerns active workers only
  if(textVal(w.job).replace(/\s/g,"")==="용접공"){
   // crane education is inapplicable to welders, mirroring current roster rules
  }
  for(const [key,label] of COURSE_FIELDS){
   if(key==="eduCrane"&&textVal(w.job).replace(/\s/g,"")==="용접공")continue;
   const raw=textVal(w[key]),info=educationState(raw,today);
   if(info.completed||!(info.dueDate instanceof Date)||info.dueDate<=today)continue;
   const dueMs=info.dueDate.getTime();
   const days=Math.round((dueMs-today.getTime())/86400000);
   items.push({worker:w,label,key,raw,info,days,dueMs,due:nextDate(info.dueDate)});
  }
 }
 items.sort((a,b)=>a.dueMs-b.dueMs||
  textVal(a.worker.company).localeCompare(textVal(b.worker.company),"ko")||
  textVal(a.worker.workerNo).localeCompare(textVal(b.worker.workerNo),"ko",{numeric:true})||
  a.label.localeCompare(b.label,"ko"));
 return items;
}
function renderExpiry(){
 const today=strictDate(todayString());
 if(!today){renderEmpty("현재 날짜를 확인할 수 없습니다.",9);return;}
 const all=expiryEntries(today);
 const end7=today.getTime()+7*86400000;
 const end1=addCalendarMonths(today,1).getTime();
 const end2=addCalendarMonths(today,2).getTime();
 const upper=range==="week"?end7:range==="month1"?end1:range==="month2"?end2:Infinity;
 const q=normalize(search.value);
 const rows=all.filter(item=>item.dueMs<=upper&&(!q||
  [item.worker.workerNo,item.worker.name,item.worker.company,item.worker.birth,item.label].some(v=>normalize(v).includes(q))));
 title.textContent="만료일자 바로 확인";
 description.textContent="현재 기준 아직 만료되지 않은 8h 미만 교육을, 가장 빨리 도래하는 만료일자부터 보여줍니다.";
 buildExpiryFilters();
 setColumns(["근로자번호","이름","업체","생년월일","교육 항목","교육일","이수시간","만료 예정일","남은 일수"]);
 const visible=pageRows(rows),frag=document.createDocumentFragment();
 for(const item of visible){
  const tr=e("tr");
  const dateMatch=item.raw.match(/\b\d{4}-\d{2}-\d{2}\b/);
  addTextCells(tr,[textVal(item.worker.workerNo)||"—",textVal(item.worker.name)||"—",
   textVal(item.worker.company)||"—",textVal(item.worker.birth)||"—",item.label,
   dateMatch?dateMatch[0]:"—",item.info.hours+"h",item.due]);
  const td=e("td");
  td.append(badge({kind:item.days<=7?"expired":"partial",label:"D-"+item.days}));
  tr.append(td);frag.append(tr);
 }
 if(!rows.length)renderEmpty("해당 기간에 만료 예정인 교육이 없습니다.",9);
 else tableBody.replaceChildren(frag);
 const distinct=new Set(rows.map(x=>textVal(x.worker.workerNo)||[x.worker.name,x.worker.birth,x.worker.company].join("|")));
 summary.textContent="조회 "+distinct.size.toLocaleString("ko-KR")+"명 · 만료 예정 교육 "+rows.length.toLocaleString("ko-KR")+"건"+
  (rows.length?" · 가장 빠른 만료일 "+rows[0].due:"");
 document.getElementById("sheLookupFootnote").textContent=
  "재직 근로자 중 교육일이 입력되어 있고 8h 미만인 교육만 대상으로 합니다. 날짜 미입력 교육, 이미 만료된 교육, 이수 완료 교육, 용접공의 크레인 교육은 제외됩니다. 한 근로자에게 여러 교육이 예정되어 있으면 교육별로 표시합니다.";
}
function render(){
 if(!overlay||overlay.hidden)return;
 if(!canRead()){close();return;}
 if(mode==="history")renderHistory();
 else if(mode==="expiry")renderExpiry();
}
function open(which){
 if(!["history","expiry"].includes(which))return;
 if(!canRead()){
  if(typeof notify==="function")notify("근로자 교육 상세 조회 권한이 없거나 연명부를 불러오는 중입니다.");
  return;
 }
 ensure();
 mode=which;range="nearest";status="all";page=0;
 search.value="";
 returnFocus=document.activeElement;
 overlay.hidden=false;overlay.style.display="flex";
 render();search.focus();
}
window.SHEEducationLookup=Object.freeze({open,close});
for(const name of ["she:edu-roster-ready","she:edu-schedule-updated"]){
 document.addEventListener(name,()=>{if(overlay&&!overlay.hidden)render();});
}
document.addEventListener("visibilitychange",()=>{if(overlay&&!overlay.hidden&&!document.hidden)render();});
})();
