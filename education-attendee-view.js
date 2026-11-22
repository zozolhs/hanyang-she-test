/* Read-only attendee overview for registered and completed education events. */
(()=>{
"use strict";
let overlay, search, tableBody, summary, heading, currentId=null;
const el=(tag,cls,txt)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(txt!==undefined)n.textContent=String(txt);return n;};
const css=`
.she-attendee-overlay{position:fixed;inset:0;z-index:12000;background:rgba(15,23,42,.65);display:flex;align-items:center;justify-content:center;padding:16px}
.she-attendee-panel{background:#fff;color:#172033;width:min(960px,100%);max-height:92vh;overflow:auto;border-radius:14px;padding:22px;box-shadow:0 18px 60px #0004}
.she-attendee-top{display:flex;justify-content:space-between;align-items:start;gap:16px}
.she-attendee-top h2{margin:0 0 8px;font-size:21px}
.she-attendee-meta{color:#526178;margin:8px 0 18px}
.she-attendee-search{width:100%;padding:12px;border:1px solid #94a3b8;border-radius:8px;margin:10px 0 14px;font:inherit}
.she-attendee-table-wrap{overflow:auto;max-height:55vh;border:1px solid #dce3ed;border-radius:8px}
.she-attendee-table{width:100%;border-collapse:collapse;min-width:620px;text-align:left}
.she-attendee-table th,.she-attendee-table td{padding:11px 13px;border-bottom:1px solid #e5eaf1}
.she-attendee-table th{position:sticky;top:0;background:#f1f5f9;z-index:1}
.she-attendee-summary{font-weight:600;margin:8px 0}
.she-attendee-close{border:1px solid #cbd5e1;background:white;border-radius:7px;padding:8px 12px;cursor:pointer}
@media(max-width:640px){.she-attendee-panel{padding:14px}.she-attendee-top h2{font-size:17px}}
`;
function ensure(){
 if(overlay)return;
 const style=el("style");style.textContent=css;document.head.append(style);
 overlay=el("div","she-attendee-overlay");overlay.hidden=true;overlay.style.display="none";
 overlay.setAttribute("role","presentation");
 const panel=el("section","she-attendee-panel");panel.setAttribute("role","dialog");panel.setAttribute("aria-modal","true");panel.setAttribute("aria-labelledby","sheAttendeeHeading");
 const top=el("div","she-attendee-top");heading=el("h2");heading.id="sheAttendeeHeading";
 const close=el("button","she-attendee-close","닫기");close.type="button";close.addEventListener("click",hide);
 top.append(heading,close);
 const meta=el("p","she-attendee-meta");meta.id="sheAttendeeMeta";
 search=el("input","she-attendee-search");search.type="search";search.placeholder="이름 · 업체 · 생년월일 · 근로자번호 검색";search.setAttribute("aria-label","수강자 검색");
 summary=el("p","she-attendee-summary");summary.setAttribute("aria-live","polite");
 const wrap=el("div","she-attendee-table-wrap");const table=el("table","she-attendee-table");
 const thead=el("thead"),tr=el("tr");
 ["번호","이름","업체","생년월일","근로자번호","구분"].forEach(t=>tr.append(el("th","",t)));
 thead.append(tr);tableBody=el("tbody");table.append(thead,tableBody);wrap.append(table);
 panel.append(top,meta,search,summary,wrap);overlay.append(panel);document.body.append(overlay);
 search.addEventListener("input",render);
 overlay.addEventListener("click",e=>{if(e.target===overlay)hide();});
 document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!overlay.hidden)hide();});
}
function hide(){if(!overlay)return;overlay.hidden=true;overlay.style.display="none";currentId=null;}
function render(){
 if(!currentId||!window.state?.authorized){hide();return;}
 const event=state.events?.find(e=>String(e.id)===String(currentId));
 if(!event){hide();return;}
 heading.textContent=event.title+" · 수강자 명단";
 document.getElementById("sheAttendeeMeta").textContent=event.date+" · "+(event.status==="completed"?"교육 완료":"교육 등록")+" · "+(event.location||"장소 미정");
 const roster=new Map((state.roster||[]).map((w,i)=>[attendeeKey(w,i),w]));
 const registered=Array.isArray(event.attendeeKeys)?event.attendeeKeys:[];
 const confirmed=Array.isArray(event.confirmedKeys)?new Set(event.confirmedKeys):null;
 const keys=event.status==="completed"&&confirmed?Array.from(confirmed):registered;
 const rows=keys.map(k=>{const w=roster.get(k);return {name:w?.name||"연명부에서 확인 불가",company:w?.company||"—",birth:w?.birth||w?.birthDate||"—",number:w?.workerNo||"—",kind:w?"연명부":"연결 확인 필요"};});
 for(const guest of event.guests||[])rows.push({name:guest,company:"—",birth:"—",number:"—",kind:"외부 수강자"});
 const q=search.value.trim().normalize("NFKC").toLowerCase();
 const visible=rows.filter(r=>!q||[r.name,r.company,r.birth,r.number].some(v=>String(v).normalize("NFKC").toLowerCase().includes(q)));
 summary.textContent="전체 "+rows.length+"명 · 검색 결과 "+visible.length+"명"+(event.status==="completed"&&confirmed?" (완료 확정 기준)":" (등록 기준)");
 const frag=document.createDocumentFragment();
 visible.forEach((r,i)=>{const tr=el("tr");[i+1,r.name,r.company,r.birth,r.number,r.kind].forEach(v=>tr.append(el("td","",v)));frag.append(tr);});
 if(!visible.length){const tr=el("tr"),td=el("td","",rows.length?"검색 결과가 없습니다.":"등록된 수강자가 없습니다.");td.colSpan=6;tr.append(td);frag.append(tr);}
 tableBody.replaceChildren(frag);
}
function open(id){
 if(!window.state?.authorized)return;
 ensure();currentId=id;search.value="";render();
 if(!currentId)return;
 overlay.hidden=false;overlay.style.display="flex";search.focus();
}
window.SHEEducationAttendees={open,close:hide};
document.addEventListener("she:edu-schedule-updated",()=>{if(currentId)render();});
document.addEventListener("she:edu-roster-ready",()=>{if(currentId)render();});
})();
