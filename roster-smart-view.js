/* SHE TEST 2026-11: additive smart roster. Server storage and existing editor unchanged. */
(()=>{
"use strict";
const host=document.getElementById("sheSmartRoster");
if(!host)return;
const q=id=>document.getElementById(id);
const transferKey="she_education_selected_workers_v1";
const irisTransferKey="she_iris_selected_workers_v1";
const selected=new Set();
const SMART_BATCH_SIZE=40;
let mode="",quick="active",openUid=null,pending=false,lastAccount=null;
let currentResults=[],renderedCount=0,resetScroll=true,scrollPending=false;
const eduFields=[
 ["eduCommon","공통교육"],["edu13ho","13호(운반)"],["edu38ho","38호(화재)"],
 ["edu4ho","4호(인화)"],["edu35ho","35호(허가)"],["eduClosed","34호(밀폐)"],
 ["edu2ho","2호(용접)"],["eduCrane","크레인"]
];
const must=["eduCommon","edu13ho","edu38ho","edu4ho","edu35ho"];
function node(tag,cls,txt){
 const n=document.createElement(tag);if(cls)n.className=cls;
 if(txt!==undefined)n.textContent=String(txt);return n;
}
function educationTypeLabel(value){
 const label=node("span","she-roster-education-label",String(value??"").trim()||"—");
 if(typeof applyRosterEducationTypeColor==="function")applyRosterEducationTypeColor(label,value);
 return label;
}
const healthAvailable=()=>typeof rosterHealthAvailable==="function"&&rosterHealthAvailable();
const healthLabel=rec=>healthAvailable()?rosterHealthLabel(rec):"";
function allowedToTransfer(){
 return rosterState.authorized&&rosterState.ready&&
   window.SHESEC?.canWrite(rosterState.user,"education")===true;
}
function setMode(next,remember=true){
 mode=next==="smart"?"smart":"full";
 document.body.classList.toggle("she-roster-smart",mode==="smart");
 q("sheSmartMode").setAttribute("aria-pressed",String(mode==="smart"));
 q("sheFullMode").setAttribute("aria-pressed",String(mode==="full"));
 if(remember&&rosterState.user?.id)sessionStorage.setItem("she_roster_view_"+rosterState.user.id,mode);
 if(mode==="smart")render();
 else hideDetail();
}
function status(rec){
 const r=recordState(rec);
 if(r.resigned)return ["퇴사","neutral"];
 if(r.expired)return ["교육 만료","danger"];
 if(r.soon)return ["7일 이내 도래","warning"];
 if(must.every(k=>parseEducation(rec[k]).completed))return ["필수교육 완료","success"];
 return ["교육 미이수","warning"];
}
function matches(rec,term,company){
 const st=recordState(rec);
 if(company&&rec.company!==company)return false;
 if(term&&![rec.name,rec.workerNo,rec.company,rec.job,rec.process,rec.phoneModel].join(" ").normalize("NFKC").toLowerCase().includes(term))return false;
 if(quick==="active"&&st.resigned)return false;
 if(quick==="resigned"&&!st.resigned)return false;
 if(quick==="iris"&&String(rec.samsungStartDate??"").trim())return false;
 if(quick==="health"&&!healthLabel(rec))return false;
 if(quick==="expired"&&(!st.expired||st.resigned))return false;
 if(quick==="soon"&&(!st.soon||st.resigned))return false;
 if(quick==="month1"&&(!st.month1||st.resigned))return false;
 if(quick==="month2"&&(!st.month2||st.resigned))return false;
 if(quick==="incomplete"&&(st.resigned||must.every(k=>parseEducation(rec[k]).completed)))return false;
 return true;
}
function hideDetail(){const side=q("sheRosterDetail");side.hidden=true;openUid=null;}
function detail(uid){
 if(!rosterState.authorized)return;
 const rec=rosterView.byId.get(uid);if(!rec)return;
 openUid=uid;
 const side=q("sheRosterDetail");
 side.classList.toggle("she-roster-resigned",Boolean(String(rec.resignDate||"").trim()));
 side.replaceChildren();
 const head=node("div","she-smart-detail-head");
 const title=node("h3","",rec.name||"성명 미입력");
 const close=node("button","she-smart-action","닫기");
 close.type="button";close.addEventListener("click",hideDetail);
 head.append(title,close);side.append(head);
 const [tag,kind]=status(rec);side.append(node("span","she-smart-state "+kind,tag));
 const general=[["근로번호",rec.workerNo],["업체",rec.company],["직종",rec.job],
   ["공종",rec.process],["재직 상태",recordState(rec).resigned?"퇴사":"재직"],
   ["성별",rec.gender],["생년월일",rec.birth],["혈액형",rec.blood],
   ["핸드폰 기종",rec.phoneModel],["연락처",rec.phone],["교육구분",rec.educationType],
   ["물산입사일",rec.samsungStartDate],["퇴사일",rec.resignDate],
   ["재입사",rec.rehireDate],["정기교육",rec.eduRegular],
   ["직변",rec.employeeId],["비고",rec.notes]];
 if(healthAvailable())general.push(["보건관리 상태",healthLabel(rec)||"—"]);
 const sections=[["기본 정보",general],["교육별 이수 현황",eduFields.map(([key,label])=>{
  const e=parseEducation(rec[key]);
  const value=String(rec[key]||"").trim()||"미이수";
  const irrelevant=key==="eduCrane"&&recordState(rec).welding;
  return [label,irrelevant?"해당 없음":value+(e.expired?" · 만료":e.soon?" · 도래 예정":"")];
 })]];
 const sectionsGrid=node("div","she-smart-detail-sections");
 for(const [heading,items] of sections){
  const section=node("section","she-smart-detail-section");
  section.append(node("h4","she-smart-detail-title",heading));
  const list=node("dl","she-smart-detail-list");
  for(const [label,value] of items){
   const dd=node("dd","",label==="교육구분"?undefined:(value||"—"));
   if(label==="교육구분")dd.append(educationTypeLabel(value));
   const dt=node("dt","",label);
   if(label==="보건관리 상태"){dt.dataset.rosterHealthOnly="true";dd.dataset.rosterHealthOnly="true";}
   list.append(dt,dd);
  }
  section.append(list);
  sectionsGrid.append(section);
 }
 side.append(sectionsGrid);
 if(window.SHESEC?.canWrite(rosterState.user,"roster")){
  const edit=node("button","she-smart-action primary","전체 표에서 수정");
  edit.type="button";edit.addEventListener("click",()=>{
   hideDetail();setMode("full");
   const input=q("searchInput");input.value=String(rec.workerNo||rec.name||"");
   for(const id of ["filterCompany","filterJob","filterProcess","filterResign","filterDueDate","filterEducationHours","filterHealthStatus"])if(q(id))q(id).value="";
   document.querySelectorAll(".edu-filter:checked").forEach(el=>el.checked=false);
   filterTable();
   requestAnimationFrame(()=>q("tableBody").querySelector('tr[data-uid="'+CSS.escape(rec.uid)+'"] input[data-field]')?.focus());
  });
  const actions=node("div","she-smart-detail-actions");
  actions.append(edit);
  side.append(actions);
 }
 side.hidden=false;
}
function render(){
 if(mode!=="smart"||!rosterState.ready||!rosterState.authorized)return;
 if(quick==="health"&&!healthAvailable()){
  quick="active";resetScroll=true;document.querySelectorAll("[data-she-roster-quick]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.sheRosterQuick==="active")));
 }
 const account=rosterState.user?.id||null;
 if(lastAccount!==account){selected.clear();lastAccount=account;resetScroll=true;hideDetail();}
 pruneSmartSelection();
 const all=rosterView.records||[];
 const companies=[...new Set(all.map(r=>r.company).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"ko"));
 const companyInput=q("sheSmartCompany"),prev=companyInput.value;
 companyInput.replaceChildren(node("option","","전체 업체"));
 companyInput.firstElementChild.value="";
 companies.forEach(name=>{const opt=node("option","",name);opt.value=name;companyInput.append(opt);});
 companyInput.value=companies.includes(prev)?prev:"";
 const term=q("sheSmartSearch").value.normalize("NFKC").toLowerCase().trim();
 const result=all.filter(rec=>matches(rec,term,companyInput.value));
 currentResults=result;
 const counts={active:0,expired:0,soon:0,incomplete:0};
 for(const rec of all){
  const st=recordState(rec);if(st.resigned)continue;
  counts.active++;
  if(st.expired)counts.expired++;
  if(st.soon)counts.soon++;
  if(!must.every(k=>parseEducation(rec[k]).completed))counts.incomplete++;
 }
 const root=q("sheSmartList"),previousScroll=root.scrollTop,previousCount=renderedCount;
 root.replaceChildren();
 const summary=q("sheSmartSummary");
 summary.textContent="조회 "+result.length.toLocaleString("ko-KR")+"명 / 전체 "+all.length.toLocaleString("ko-KR")+"명";
 q("sheSmartCounters").textContent="재직 "+counts.active+"명 · 교육 만료 "+counts.expired+"명 · 도래 예정 "+counts.soon+"명 · 필수교육 미이수 "+counts.incomplete+"명";
 const target=Math.min(result.length,resetScroll?SMART_BATCH_SIZE:Math.max(SMART_BATCH_SIZE,previousCount));
 renderedCount=0;
 appendSmartBatch(target);
 if(!result.length)root.append(node("div","she-smart-empty","해당 조건에 맞는 근로자가 없습니다."));
 root.scrollTop=resetScroll?0:previousScroll;
 resetScroll=false;
 queueSmartScroll();

 q("sheSmartTransfer").hidden=!allowedToTransfer();
 if(q("sheSmartIrisTransfer"))q("sheSmartIrisTransfer").hidden=!allowedToTransfer();
 updateTransfer();
 if(openUid&&rosterView.byId.has(openUid))detail(openUid);
}
function smartSelectable(rec){return Boolean(rec&&!recordState(rec).resigned);}
function pruneSmartSelection(){for(const uid of selected){if(!smartSelectable(rosterView.byId.get(uid)))selected.delete(uid);}}
function smartPersonCard(rec){
  const item=node("article","she-smart-person");
  if(String(rec.resignDate||"").trim()) item.classList.add("she-roster-resigned");
  const [tag,kind]=status(rec);
  if(allowedToTransfer()){
   const checkbox=node("input","she-smart-check");
   checkbox.type="checkbox";checkbox.disabled=!smartSelectable(rec);checkbox.checked=!checkbox.disabled&&selected.has(rec.uid);
   checkbox.dataset.uid=rec.uid;
   checkbox.setAttribute("aria-label",(rec.name||"근로자")+(checkbox.disabled?" 퇴사자 선택 불가":" 교육 대상 선택"));
   if(checkbox.disabled)checkbox.title="퇴사자는 교육 대상자로 선택할 수 없습니다.";
   checkbox.addEventListener("change",()=>{
    if(checkbox.checked&&allowedToTransfer()&&smartSelectable(rosterView.byId.get(rec.uid)))selected.add(rec.uid);else{selected.delete(rec.uid);checkbox.checked=false;}
    updateTransfer();
   });
   const hit=node("label","roster-check-hit");
   hit.append(checkbox);item.append(hit);
  }
  const main=node("button","she-smart-person-main");
  main.type="button";main.append(
   node("strong","",rec.name||"성명 미입력"),
   node("span","",rec.company||"업체 미입력"),
   node("small","",(rec.workerNo||"근로번호 미입력")+" · "+(rec.job||"직종 미입력")+(String(rec.phoneModel??"").trim()?" · "+String(rec.phoneModel).trim():""))
  );
  if(String(rec.educationType??"").trim()){
   const label=educationTypeLabel(rec.educationType);
   label.setAttribute("aria-label","교육구분: "+String(rec.educationType).trim());
   main.insertBefore(label,main.lastElementChild);
  }
  const health=healthLabel(rec);
  if(health){const badge=node("span","roster-health-badge",health);badge.dataset.state=health==="입사 가능 확인"?"cleared":"hold";main.insertBefore(badge,main.lastElementChild);}
  main.addEventListener("click",()=>detail(rec.uid));
  item.append(main,node("span","she-smart-state "+kind,tag));return item;
}
function updateSmartScrollStatus(){
 const status=q("sheSmartPage"),more=q("sheSmartMore");
 const remaining=renderedCount<currentResults.length;
 status.textContent=renderedCount.toLocaleString("ko-KR")+" / "+currentResults.length.toLocaleString("ko-KR")+"명 표시"+
  (remaining?" · 아래로 스크롤하면 계속 표시":" · 전체 표시 완료");
 if(more)more.hidden=!remaining;
 for(const id of ["sheSmartPrev","sheSmartNext"]){const old=q(id);if(old)old.hidden=true;}
}
function appendSmartBatch(count=SMART_BATCH_SIZE){
 if(mode!=="smart"||!rosterState.ready||!rosterState.authorized)return;
 const root=q("sheSmartList");
 const end=Math.min(currentResults.length,renderedCount+count);
 if(end>renderedCount){
  const frag=document.createDocumentFragment();
  for(let i=renderedCount;i<end;i++)frag.append(smartPersonCard(currentResults[i]));
  root.append(frag);renderedCount=end;
 }
 updateSmartScrollStatus();
}
function queueSmartScroll(){
 if(scrollPending)return;
 scrollPending=true;
 requestAnimationFrame(()=>{
  scrollPending=false;
  if(mode!=="smart"||!rosterState.ready||!rosterState.authorized||resetScroll||renderedCount>=currentResults.length)return;
  const root=q("sheSmartList");
  if(!root.clientHeight)return;
  if(root.scrollHeight-root.scrollTop-root.clientHeight<=320){
   appendSmartBatch();
   if(renderedCount<currentResults.length&&root.scrollHeight-root.scrollTop-root.clientHeight<=320)queueSmartScroll();
  }
 });
}
function toggleSmartResults(selection,records,checked){
 for(const rec of records){if(checked&&smartSelectable(rec))selection.add(rec.uid);else selection.delete(rec.uid);}
}
function smartSelectionState(selection,records){
 const eligible=records.filter(smartSelectable);
 const total=eligible.length,count=eligible.reduce((n,rec)=>n+Number(selection.has(rec.uid)),0);
 return {total,count,checked:total>0&&count===total,partial:count>0&&count<total};
}
function syncSmartChecks(){
 q("sheSmartList").querySelectorAll(".she-smart-check").forEach(cb=>{cb.disabled=!smartSelectable(rosterView.byId.get(cb.dataset.uid));cb.checked=!cb.disabled&&selected.has(cb.dataset.uid);});
}
function updateSmartSelection(){
 const master=q("sheSmartSelectAll"),bar=q("sheSmartSelectionBar");
 if(!master||!bar)return;
 const allowed=allowedToTransfer();
 bar.hidden=!allowed;
 const result=smartSelectionState(selected,currentResults);
 master.checked=result.checked;master.indeterminate=result.partial;
 master.disabled=!allowed||result.total===0;
 const total=[...selected].filter(uid=>rosterView.byId.has(uid)).length;
 q("sheSmartSelectedCount").textContent="조회 선택 "+result.count+"명 / 전체 선택 "+total+"명";
}
function currentSmartResults(){
 const term=q("sheSmartSearch").value.normalize("NFKC").toLowerCase().trim();
 const company=q("sheSmartCompany").value;
 return (rosterView.records||[]).filter(rec=>matches(rec,term,company));
}
function initSmartSelection(){
 const summary=q("sheSmartSummary");
 const bar=node("div","roster-smart-selection");bar.id="sheSmartSelectionBar";bar.hidden=true;
 const label=node("label","roster-smart-select-all");
 const master=node("input","");master.id="sheSmartSelectAll";master.type="checkbox";
 master.setAttribute("aria-label","현재 검색 결과 전체 선택 (아직 표시되지 않은 인원 포함)");
 label.append(master,node("span","","조회 결과 전체 선택"));
 const count=node("span","she-ux-muted");count.id="sheSmartSelectedCount";count.setAttribute("aria-live","polite");
 const hint=node("span","roster-smart-select-hint","미표시 재직자 포함 · 퇴사자 선택 불가 · 교육 전송은 재직자 150명 이하");
 bar.append(label,count,hint);summary.after(bar);
 master.addEventListener("change",()=>{
  if(!allowedToTransfer()){updateSmartSelection();return;}
  currentResults=currentSmartResults();
  if(master.checked)toggleSmartResults(selected,currentResults,true);
  else selected.clear();
  syncSmartChecks();updateTransfer();
 });
}
function updateTransfer(){
 pruneSmartSelection();
 updateSmartSelection();
 const eligible=[...selected].filter(uid=>rosterView.byId.has(uid));
 q("sheSmartTransfer").textContent="교육일정 등록 ("+eligible.length+"명)";
 q("sheSmartTransfer").disabled=eligible.length===0||!allowedToTransfer();
 const iris=q("sheSmartIrisTransfer");
 if(iris){iris.textContent="홍채일정 등록 ("+eligible.length+"명)";iris.disabled=eligible.length===0||!allowedToTransfer();}

}
function transfer(kind="education"){
 if(!allowedToTransfer()){alert("교육일정 수정 권한이 필요합니다.");return;}
 const keys=[...selected].map(uid=>rosterView.byId.get(uid)).filter(rec=>rec&&!recordState(rec).resigned)
  .map(rec=>String(rec.workerNo||"").trim()? "worker:"+String(rec.workerNo).trim()
    : rec.uid?"uid:"+rec.uid:null).filter(Boolean);
 if(!keys.length)return alert("근로번호 또는 고유 식별값이 있는 재직자를 선택해 주세요.");
 if(keys.length>150)return alert("한 번에 150명 이하를 선택해 주세요.");
 const route=kind==="iris"?"iris":"education";
 sessionStorage.removeItem(transferKey);
 sessionStorage.removeItem(irisTransferKey);
 sessionStorage.setItem(route==="iris"?irisTransferKey:transferKey,JSON.stringify({
  owner:rosterState.user.id,issued_at:Date.now(),kind:route,keys:[...new Set(keys)]
 }));
 location.href="dashboard.html?from=roster&register="+route;
}
function schedule(){if(pending)return;pending=true;requestAnimationFrame(()=>{pending=false;render();});}
function init(){
 initSmartSelection();
 q("sheSmartMode").addEventListener("click",()=>setMode("smart"));
 q("sheFullMode").addEventListener("click",()=>setMode("full"));
 q("sheSmartSearch").addEventListener("input",()=>{resetScroll=true;schedule();});
 q("sheSmartCompany").addEventListener("change",()=>{resetScroll=true;schedule();});
 document.querySelectorAll("[data-she-roster-quick]").forEach(button=>button.addEventListener("click",()=>{
  quick=button.dataset.sheRosterQuick;resetScroll=true;
  document.querySelectorAll("[data-she-roster-quick]").forEach(b=>b.setAttribute("aria-pressed",String(b===button)));
  schedule();
 }));
 q("sheSmartList").addEventListener("scroll",queueSmartScroll,{passive:true});
 q("sheSmartMore")?.addEventListener("click",()=>{if(!resetScroll){appendSmartBatch();queueSmartScroll();}});
 window.addEventListener("resize",queueSmartScroll,{passive:true});
 q("sheSmartTransfer").addEventListener("click",()=>transfer("education"));
 q("sheSmartIrisTransfer")?.addEventListener("click",()=>transfer("iris"));
 document.addEventListener("she:roster-view-updated",()=>{
  if(!mode&&rosterState.ready){
   const saved=sessionStorage.getItem("she_roster_view_"+(rosterState.user?.id||""));
   setMode(saved||((rosterState.user?.role==="viewer_admin"||matchMedia("(max-width:720px)").matches)?"smart":"full"),false);
  }
  schedule();
 });
 // Existing page performs its own async load. Don't initiate a second fetch.
 if(rosterState.ready){
  setMode("smart",false);
  schedule();
 }
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});
else init();
})();
