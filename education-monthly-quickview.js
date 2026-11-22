/* SHE TEST: month-by-month completed regular-education quick view.
 * Uses dashboard authorized in-memory schedule and roster only; no additional requests or writes.
 */
(()=>{
"use strict";
const q=id=>document.getElementById(id);
const el=(tag,cls,content)=>{
 const x=document.createElement(tag);
 if(cls)x.className=cls;
 if(content!==undefined)x.textContent=String(content);
 return x;
};
const normalize=value=>String(value??"").normalize("NFKC").toLocaleLowerCase("ko").trim();
const currentMonth=()=>{
 if(typeof kstClock==="function")return kstClock().date.slice(0,7);
 const now=new Date();return now.getFullYear()+"-"+String(now.getMonth()+1).padStart(2,"0");
};
const correctMonth=value=>/^\d{4}-(0[1-9]|1[0-2])$/.test(value)?value:currentMonth();
let panel=null,month=currentMonth(),page=0,previousFocus=null;
const perPage=50;
function isReady(){
 return typeof state!=="undefined"&&state.authorized===true&&state.ready===true&&state.rosterReady===true;
}
function changeMonth(delta){
 const [year,part]=correctMonth(month).split("-").map(Number);
 const shifted=new Date(year,part-1+delta,1);
 month=shifted.getFullYear()+"-"+String(shifted.getMonth()+1).padStart(2,"0");
 page=0;render();
}
function close(){
 if(!panel)return;
 panel.hidden=true;panel.style.display="none";
 if(previousFocus?.isConnected)previousFocus.focus();
 previousFocus=null;
}
function ensure(){
 if(panel)return;
 panel=el("div","she-regular-quick-overlay");
 panel.hidden=true;panel.style.display="none";
 const dialog=el("section","she-regular-quick-dialog");
 dialog.setAttribute("role","dialog");dialog.setAttribute("aria-modal","true");
 dialog.setAttribute("aria-labelledby","sheRegularQuickTitle");
 const head=el("div","she-regular-quick-head");
 const titles=el("div");const h=el("h2","","정기안전교육 · 월별 간편 보기");h.id="sheRegularQuickTitle";
 titles.append(h,el("p","she-regular-quick-note","조회 월별 실제 참석·완료 확정 기준 / 현재 재직자 대상"));
 const closeBtn=el("button","btn btn-outline btn-sm","닫기");closeBtn.type="button";closeBtn.addEventListener("click",close);
 head.append(titles,closeBtn);
 const toolbar=el("div","she-regular-quick-toolbar");
 const prev=el("button","btn btn-outline btn-sm","‹ 이전 달");prev.type="button";prev.addEventListener("click",()=>changeMonth(-1));
 const displayed=el("strong");displayed.id="sheRegularQuickMonth";
 const next=el("button","btn btn-outline btn-sm","다음 달 ›");next.type="button";next.addEventListener("click",()=>changeMonth(1));
 const now=el("button","btn btn-outline btn-sm","이번 달");now.type="button";now.addEventListener("click",()=>{month=currentMonth();page=0;render();});
 toolbar.append(prev,displayed,next,now);
 const stats=el("p","she-regular-quick-stats");stats.id="sheRegularQuickStats";stats.setAttribute("aria-live","polite");
 const filters=el("div","she-regular-quick-filters");
 const search=el("input");search.type="search";search.id="sheRegularQuickSearch";
 search.placeholder="근로자번호 · 이름 · 업체 · 생년월일 검색";
 search.setAttribute("aria-label","정기교육 이수자 검색");
 const select=el("select");select.id="sheRegularQuickStatus";select.setAttribute("aria-label","이수 상태 필터");
 [["all","전체 인원"],["completed","이수 완료"],["pending","미이수"]].forEach(([value,name])=>{
  const option=el("option","",name);option.value=value;select.append(option);
 });
 search.addEventListener("input",()=>{page=0;render();});
 select.addEventListener("change",()=>{page=0;render();});
 filters.append(search,select);
 const wrap=el("div","she-regular-quick-table-wrap");
 const table=el("table","she-regular-quick-table"),thead=el("thead"),headers=el("tr");
 ["근로자번호","이름","업체","생년월일","교육일","이수 상태"].forEach(v=>headers.append(el("th","",v)));
 thead.append(headers);const tbody=el("tbody");tbody.id="sheRegularQuickRows";
 table.append(thead,tbody);wrap.append(table);
 const footer=el("div","she-regular-quick-footer");
 const shown=el("span");shown.id="sheRegularQuickPage";
 const back=el("button","btn btn-outline btn-sm","이전");back.type="button";back.id="sheRegularQuickPrev";
 back.addEventListener("click",()=>{page=Math.max(0,page-1);render();});
 const forward=el("button","btn btn-outline btn-sm","다음");forward.type="button";forward.id="sheRegularQuickNext";
 forward.addEventListener("click",()=>{page++;render();});
 footer.append(shown,back,forward);
 const footnote=el("p","she-regular-quick-note",
  "월별 이수 현황은 교육일정의 완료 확정 기록으로 판정합니다. 연명부의 정기교육 칸은 가장 최근에 이수한 날짜만 보관합니다.");
 dialog.append(head,toolbar,stats,filters,wrap,footer,footnote);
 panel.append(dialog);document.body.append(panel);
 panel.addEventListener("click",event=>{if(event.target===panel)close();});
 document.addEventListener("keydown",event=>{
  if(panel&&!panel.hidden&&event.key==="Escape"){event.preventDefault();close();}
 });
}
function entries(){
 const latestByKey=new Map();
 for(const event of state.events||[]){
  if(event.kind!=="education"||event.category!=="regular"||event.status!=="completed"||
     !event.confirmedAt||!Array.isArray(event.confirmedKeys)||!String(event.date||"").startsWith(month+"-"))continue;
  for(const key of event.confirmedKeys){
   const prev=latestByKey.get(key);
   if(!prev||event.date>prev)latestByKey.set(key,event.date);
  }
 }
 const people=state.workerIndex instanceof Map?[...state.workerIndex.entries()]:[];
 return people.map(([key,worker])=>({
  workerNo:String(worker.workerNo||"—"),name:String(worker.name||"—"),
  company:String(worker.company||"—"),birth:String(worker.birth||"—"),
  date:latestByKey.get(key)||"—",completed:latestByKey.has(key)
 }));
}
function render(){
 if(!panel||panel.hidden||!isReady())return;
 const people=entries();
 const complete=people.filter(p=>p.completed).length;
 const ym=month.split("-");
 q("sheRegularQuickMonth").textContent=ym[0]+"년 "+Number(ym[1])+"월";
 q("sheRegularQuickStats").textContent=
  "재직 "+people.length.toLocaleString("ko-KR")+"명 · 이수 "+complete.toLocaleString("ko-KR")+
  "명 · 미이수 "+(people.length-complete).toLocaleString("ko-KR")+"명"+
  " · 이수율 "+(people.length?((complete/people.length)*100).toFixed(1):"0.0")+"% · 미이수 우선 정렬";
 const search=normalize(q("sheRegularQuickSearch").value);
 const status=q("sheRegularQuickStatus").value;
 const found=people.filter(p=>
  (status==="all"||(status==="completed"&&p.completed)||(status==="pending"&&!p.completed))&&
  (!search||[p.workerNo,p.name,p.company,p.birth].some(value=>normalize(value).includes(search)))
 );
 // Uncompleted workers first, completed workers last; stable company/worker-number ordering within each group.
 found.sort((a,b)=>Number(a.completed)-Number(b.completed)||
  a.company.localeCompare(b.company,"ko")||
  a.workerNo.localeCompare(b.workerNo,"ko",{numeric:true}));
 const pages=Math.max(1,Math.ceil(found.length/perPage));page=Math.max(0,Math.min(page,pages-1));
 const frag=document.createDocumentFragment();
 for(const p of found.slice(page*perPage,(page+1)*perPage)){
  const tr=el("tr");
  for(const value of [p.workerNo,p.name,p.company,p.birth,p.date]){
   tr.append(el("td","",value));
  }
  const statusCell=el("td",p.completed?"she-regular-quick-done":"she-regular-quick-pending",
   p.completed?"이수 완료":"미이수");
  tr.append(statusCell);frag.append(tr);
 }
 if(!found.length){const tr=el("tr"),td=el("td","","조건에 맞는 재직 근로자가 없습니다.");td.colSpan=6;tr.append(td);frag.append(tr);}
 q("sheRegularQuickRows").replaceChildren(frag);
 q("sheRegularQuickPage").textContent="검색 "+found.length+"명 · "+(page+1)+"/"+pages+" 페이지";
 q("sheRegularQuickPrev").disabled=page===0;
 q("sheRegularQuickNext").disabled=page>=pages-1;
}
function open(){
 if(!isReady()){alert("교육관리 및 근로자연명부 조회가 완료된 후 이용해 주세요.");return;}
 ensure();
 previousFocus=document.activeElement;
 month=correctMonth(state.regularSelectedMonth==="all"?currentMonth():state.regularSelectedMonth);
 page=0;q("sheRegularQuickSearch").value="";q("sheRegularQuickStatus").value="all";
 panel.hidden=false;panel.style.display="flex";render();q("sheRegularQuickSearch").focus();
}
function init(){
 const button=q("sheRegularQuickBtn");
 if(button)button.addEventListener("click",open);
}
window.SHERegularMonthlyQuickView=Object.freeze({open,close});
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});
else init();
for(const name of ["she:edu-schedule-updated","she:edu-roster-ready"]){
 document.addEventListener(name,()=>{if(panel&&!panel.hidden)render();});
}
document.addEventListener("visibilitychange",()=>{if(panel&&!panel.hidden&&!document.hidden)render();});
})();
