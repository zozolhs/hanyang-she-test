
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const api=()=>window.SHESEC?.healthFollowup;
const STATUS={hold:'입사 보류',retest:'재검진·재측정',results:'결과 대기',cleared:'입사 가능 확인',entered:'입사 완료',closed:'기타 종결'};
const REASON={bp:'혈압 측정 입사 보류',retest:'건강검진 재검진',doctor:'의사 소견서 제출',treatment:'치료 및 경과 확인',result:'검진 결과 대기',other:'기타'};
const active=c=>!c.closed_on;
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const diff=(a,b)=>Math.round((Date.parse(a+'T00:00:00Z')-Date.parse(b+'T00:00:00Z'))/86400000);
const days=c=>Math.max(0,diff(c.closed_on||today(),c.planned_entry)||0);
const due=c=>active(c)&&c.next_action&&diff(c.next_action,today())>=0&&diff(c.next_action,today())<=7;
const overdue=c=>active(c)&&c.next_action&&c.next_action<today();
const long=c=>active(c)&&days(c)>=14;
const normalize=v=>String(v??'').normalize('NFKC').toLocaleLowerCase('ko').trim();
const birthText=w=>{const v=String(w?.birth??'').trim();return /^[0-9. /-]{6,12}$/.test(v)?v:'생년월일 미확인';};
const matchesCandidate=(w,term)=>!term||[w.name,w.no,w.company,w.job,w.birth].some(v=>normalize(v).includes(term))||(/^[0-9. /-]+$/.test(term)&&term.replace(/[^0-9]/g,'').length>0&&String(w.birth||'').replace(/[^0-9]/g,'').includes(term.replace(/[^0-9]/g,'')));

function el(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);if(cls)n.className=cls;return n;}
let authorized=false,account=null,generation=0,cases=[],workers=new Map(),offset=0,total=0,selected=null,historyOffset=0,historyTotal=0,formMode='',busy=false,dirty=false,loading=false,verifying=false,historySeq=0,listSeq=0,searchTimer=null,workersReady=false,scopeStats={scopeTotal:0,due:0,overdue:0,longDelay:0};
function message(text,kind=''){const box=$('message');box.textContent=text;box.className='msg '+kind;box.hidden=!text;}
function closeDetail(force=false){
 if(!force&&(busy||dirty&&!confirm('작성 중인 내용을 닫으시겠습니까?')))return false;
 selected=null;formMode='';dirty=false;historySeq++;$('caseForm').reset();$('candidateSearch').value='';$('worker').replaceChildren();
 $('personSummary').replaceChildren();$('historyRows').replaceChildren();$('detailBody').hidden=true;$('detailEmpty').hidden=false;$('closeDetail').hidden=true;$('detailTitle').textContent='개인별 관리 이력';return true;
}
function lock(reason){
 authorized=false;account=null;generation++;listSeq++;clearTimeout(searchTimer);loading=false;dirty=false;cases=[];workers.clear();workersReady=false;offset=0;total=0;scopeStats={scopeTotal:0,due:0,overdue:0,longDelay:0};
 $('caseRows').replaceChildren();$('worker').replaceChildren();$('search').value='';$('candidateSearch').value='';closeDetail(true);
 $('app').hidden=true;$('gate').hidden=false;$('gateText').textContent=reason;message('');
}
async function verify(){
 if(verifying)return authorized;
 verifying=true;
 try{
  if(!window.SHESEC||!api())throw Error('보건 연결 모듈을 불러오지 못했습니다.');
  const r=await window.SHESEC.guard('health',true);
  if(!r.ok||!window.SHESEC.canWrite(r.profile,'health')){lock('승인된 보건 수정 담당자 또는 최고관리자만 사후관리 상세정보를 볼 수 있습니다.');return false;}
  if(account&&account!==r.profile.id)lock('계정 변경으로 기존 화면을 정리했습니다.');
  account=r.profile.id;authorized=true;$('gate').hidden=true;$('app').hidden=false;return true;
 }catch(e){lock(e.message||'보건 권한 확인 실패');return false;}
 finally{verifying=false;}
}
async function loadPage({candidates=false}={}){
 if(!authorized)return;
 const epoch=generation,seq=++listSeq;
 loading=true;$('refresh').disabled=true;$('prev').disabled=true;$('next').disabled=true;$('newCase').disabled=!workersReady;
 $('listHint').textContent='전체 관리대상 조회 중…';
 try{
  const candidateRequest=candidates?api().candidates().then(result=>{
    if(epoch===generation&&authorized){workers=new Map((result.workers||[]).map(w=>[w.uid,w]));workersReady=true;$('newCase').disabled=false;if(formMode==='new')renderCandidates();}
  }):Promise.resolve();
  const [result]=await Promise.all([api().list(offset,$('scope').value==='active',$('search').value.trim().slice(0,100),$('quick').value),candidateRequest]);
  if(epoch!==generation||seq!==listSeq||!authorized)return;
  total=Number(result.total)||0;scopeStats=result;
  if(offset>=total&&offset>0){offset=Math.max(0,Math.floor(Math.max(0,total-1)/200)*200);return loadPage();}
  cases=Array.isArray(result.cases)?result.cases:[];renderList();
 }catch(e){if(epoch===generation&&seq===listSeq){if(e.status===401||e.status===403)lock('보건 권한이 만료되거나 변경되었습니다.');else{message(e.message||'목록 조회 실패','error');$('listHint').textContent='최신 조회 실패 · 이전 조회 결과일 수 있습니다.';}}}
 finally{if(epoch===generation&&seq===listSeq){loading=false;$('refresh').disabled=false;$('newCase').disabled=!workersReady;updatePager();}}
}
function updatePager(){$('prev').disabled=loading||offset===0;$('next').disabled=loading||offset+200>=total;$('pageInfo').textContent=total?(offset+1)+'~'+Math.min(total,offset+200)+' / '+total+'건':'0건';}
function renderList(){
 const filtered=cases;
 $('totalLabel').textContent=$('scope').value==='active'?'현재 관리 건수':'누적 관리 건수';$('total').textContent=(Number(scopeStats.scopeTotal)||0)+'건';
 $('due').textContent=(Number(scopeStats.due)||0)+'건';$('overdue').textContent=(Number(scopeStats.overdue)||0)+'건';$('longDelay').textContent=(Number(scopeStats.longDelay)||0)+'건';
 $('listHint').textContent='전체 관리대상 검색 결과 '+total+'건 · 현재 '+filtered.length+'건 표시 · 상단 통계는 선택한 관리 범위 전체 기준';
 const frag=document.createDocumentFragment();
 for(const c of filtered){
  const tr=el('tr');if(selected?.id===c.id)tr.className='selected';
  const name=el('td');name.append(el('strong',c.worker_name+' · '+birthText(workers.get(c.worker_uid))),el('div',c.company+' · '+(c.worker_no||'근로번호 없음'),'hint'));tr.append(name);
  tr.append(el('td',REASON[c.reason]||'기타'),el('td',days(c)+'일',long(c)?'overdue':''),el('td',c.next_action||'—',overdue(c)?'overdue':''));
  const st=el('td');st.append(el('span',STATUS[c.status]||'확인 필요','tag '+c.status));tr.append(st);
  const cell=el('td'),b=el('button','이력 보기');b.type='button';b.addEventListener('click',()=>openCase(c));cell.append(b);tr.append(cell);frag.append(tr);
 }
 if(!filtered.length){const tr=el('tr'),td=el('td','해당 조건의 관리 건이 없습니다.','empty');td.colSpan=6;tr.append(td);frag.append(tr);}
 $('caseRows').replaceChildren(frag);updatePager();
}
function renderCandidates(){
 const term=normalize($('candidateSearch').value),previous=$('worker').value;
 const result=[...workers.values()].filter(w=>w.complete&&!w.entered&&!w.resigned&&w.name&&matchesCandidate(w,term)).sort((a,b)=>String(a.name).localeCompare(String(b.name),'ko'));
 const opts=result.map(w=>new Option(w.name+' | '+birthText(w)+' | '+(w.company||'업체 미입력')+' | '+(w.no||'번호 없음'),w.uid));
 $('worker').replaceChildren(new Option('근로자 선택',''),...opts);
 if(result.some(w=>w.uid===previous))$('worker').value=previous;
 $('candidateHint').textContent='등록 가능 대상 '+result.length+'명. 이미 관리 중인 사람은 서버에서 중복 등록을 차단합니다.';
}
function displayForm(mode,c=null){
 formMode=mode;dirty=false;$('caseForm').reset();$('caseForm').hidden=false;$('save').disabled=false;
 for(const id of ['candidateFields','plannedField','openedField','reasonField'])$(id).hidden=mode!=='new';
 $('worker').required=$('planned').required=$('opened').required=mode==='new';
 const statuses=Object.entries(STATUS).filter(([key])=>mode!=='new'||!['entered','closed'].includes(key));
 $('status').replaceChildren(...statuses.map(([key,t])=>new Option(t,key)));
 $('planned').value=today();$('opened').value=today();$('opened').max=today();$('planned').max=today();
 $('status').value=c?.status||'hold';$('actionDate').min=today();$('actionDate').value=c?.next_action&&c.next_action>=today()?c.next_action:today();
 $('note').required=mode==='update';
 updateStatusForm();if(mode==='new')renderCandidates();
}
function updateStatusForm(){
 const final=['entered','closed'].includes($('status').value);
 $('actionDate').disabled=final;$('actionDate').required=!final;
}
function showDetail(title){
 $('detailEmpty').hidden=true;$('detailBody').hidden=false;$('closeDetail').hidden=false;$('detailTitle').textContent=title;
}
function newCase(){
 if(!authorized||!workersReady||!closeDetail())return;
 showDetail('신규 사후관리 등록');$('personSummary').textContent='연명부에서 필수 5종 교육 완료 및 물산입사일 미입력 근로자를 선택합니다.';
 $('historySection').hidden=true;displayForm('new');
}
async function openCase(c){
 if(!authorized||!closeDetail())return;
 selected=c;historyOffset=0;showDetail(c.worker_name+' · 개인별 이력');
 const w=workers.get(c.worker_uid);
 $('personSummary').textContent=c.worker_name+' / '+birthText(w)+' / '+c.company+' / '+(c.worker_no||'근로번호 없음')+'\n최초 발생 '+c.opened_on+' · 입사 예정 '+c.planned_entry+' · 지연 '+days(c)+'일\n현재 상태: '+(STATUS[c.status]||'확인 필요')+' · 실제 물산입사일: '+(w?.entered||'미입력/연명부 미확인');
 $('personSummary').style.whiteSpace='pre-wrap';
 $('caseForm').hidden=!active(c);if(active(c))displayForm('update',c);
 $('historySection').hidden=false;renderList();await loadHistory();
}
async function loadHistory(){
 if(!authorized||!selected)return;
 const epoch=generation,seq=++historySeq,id=selected.id;
 $('historyRows').replaceChildren(el('div','조치 이력을 불러오는 중…','hint'));$('histPrev').disabled=$('histNext').disabled=true;
 try{
  const res=await api().history(id,historyOffset);
  if(epoch!==generation||seq!==historySeq||selected?.id!==id)return;
  historyTotal=Number(res.total)||0;const frag=document.createDocumentFragment();
  for(const h of res.actions||[]){
   const article=el('article');article.append(el('strong',h.action_on+' · '+(STATUS[h.status]||'조치')),el('div','담당: '+h.actor+(h.next_action?' · 다음 조치 '+h.next_action:''),'hint'),el('p',h.note||'—'));frag.append(article);
  }
  $('historyRows').replaceChildren(frag);$('histPrev').disabled=historyOffset===0;$('histNext').disabled=historyOffset+200>=historyTotal;
  $('histPage').textContent=historyTotal?(historyOffset+1)+'~'+Math.min(historyOffset+200,historyTotal)+' / '+historyTotal+'건':'0건';
 }catch(e){if(epoch===generation&&seq===historySeq){if(e.status===401||e.status===403)lock('보건 권한이 변경되었습니다.');else $('historyRows').replaceChildren(el('div',e.message||'조회 실패','hint'));}}
}
$('caseForm').addEventListener('input',()=>{dirty=true;});
$('status').addEventListener('change',updateStatusForm);
$('candidateSearch').addEventListener('input',renderCandidates);
$('caseForm').addEventListener('submit',async e=>{
 e.preventDefault();if(!authorized||busy)return;
 const mode=formMode,c=selected;
 const status=$('status').value,final=['entered','closed'].includes(status);
 const payload={status,next_action:final?null:$('actionDate').value,note:$('note').value.trim()};
 if(mode==='new')Object.assign(payload,{worker_uid:$('worker').value,planned_entry:$('planned').value,opened_on:$('opened').value,reason:$('reason').value});
 else if(mode==='update'&&c)Object.assign(payload,{case_id:c.id,version:Number(c.version)});
 else return;
 if(mode==='update'&&!payload.note){message('조치사항을 입력하세요.','error');return;}
 if(final&&!confirm('이 관리 건을 종결하시겠습니까? 종결된 이력은 보존되며 수정할 수 없습니다.'))return;
 busy=true;$('save').disabled=true;$('save').textContent='저장 중…';const epoch=generation;
 try{
  await api().append(payload);
  if(epoch!==generation||!authorized)return;
  dirty=false;closeDetail(true);message('사후관리 이력을 저장했습니다.','success');await loadPage({candidates:true});
 }catch(err){
  if(epoch!==generation)return;
  if(err.status===401||err.status===403)lock('보건 권한이 변경되었습니다.');
  else message(err.message||'저장 실패','error');
 }finally{busy=false;$('save').disabled=false;$('save').textContent='저장 및 이력 추가';}
});
function searchPage(){clearTimeout(searchTimer);offset=0;loadPage();}
$('scope').addEventListener('change',searchPage);$('quick').addEventListener('change',searchPage);
$('search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(searchPage,200);});
$('prev').addEventListener('click',()=>{if(loading)return;offset=Math.max(0,offset-200);loadPage();});
$('next').addEventListener('click',()=>{if(loading||offset+200>=total)return;offset+=200;loadPage();});
$('histPrev').addEventListener('click',()=>{historyOffset=Math.max(0,historyOffset-200);loadHistory();});
$('histNext').addEventListener('click',()=>{if(historyOffset+200<historyTotal){historyOffset+=200;loadHistory();}});
$('newCase').addEventListener('click',newCase);$('closeDetail').addEventListener('click',()=>{if(closeDetail())renderList();});$('cancelDetail').addEventListener('click',()=>{if(closeDetail())renderList();});
$('refresh').addEventListener('click',async()=>{if(!closeDetail())return;if(await verify())await loadPage({candidates:true});});
document.addEventListener('she:session-reset',()=>lock('로그인 세션이 변경되었습니다.'));
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&authorized)verify();});
window.addEventListener('pageshow',e=>{if(e.persisted)verify();});
setInterval(()=>{if(!document.hidden&&authorized)verify();},45000);
window.addEventListener('beforeunload',e=>{if(dirty||busy){e.preventDefault();e.returnValue='';}});
document.addEventListener('DOMContentLoaded',async()=>{if(await verify())await loadPage({candidates:true});},{once:true});
})();
