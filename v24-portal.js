// V24 integrated portal — all business reads and writes go through she-v24-store.
// No Supabase service key, direct PostgREST, V23 session keys, or 4-digit PIN login.
(()=>{
"use strict";
const API="https://ahmqthuympannqsrszvv.supabase.co/functions/v1/";
const MODS=["safety","health","roster","education"];
const NAMES={safety:"안전",health:"보건",roster:"인원",education:"교육",admin:"회원 승인",password:"비밀번호"};
const $=id=>document.getElementById(id);
const panel=$("modulePanel");
let token=null,account=null,mode="login",active="safety",busy=false;
let safetyData=[],rosterData=null,educationData=null,healthData=null;
const rowCache=new Map(),listCache={value:null};
let riskLimit=50,rosterLimit=50,educationLimit=50;
function show(text,kind=""){const m=$("message");m.textContent=text;m.dataset.kind=kind;}
function element(tag,value,cls){const e=document.createElement(tag);if(value!=null)e.textContent=String(value);if(cls)e.className=cls;return e;}
function cleanPanel(title,desc=""){panel.replaceChildren(element("h2",title));if(desc)panel.append(element("p",desc,"muted"));}
function button(text,callback,cls=""){const b=element("button",text,cls);b.type="button";b.addEventListener("click",callback);return b;}
function field(label,value="",type="text",max=200){
  const lab=element("label",label,"field");
  const inp=type==="textarea"?document.createElement("textarea"):document.createElement("input");
  if(type!=="textarea")inp.type=type;
  inp.value=value==null?"":String(value);
  inp.maxLength=max;
  lab.append(inp);
  return {lab,input:inp};
}
function selectField(label,opts,chosen){
  const lab=element("label",label,"field"),sel=document.createElement("select");
  for(const [value,text] of opts){const op=element("option",text);op.value=value;sel.append(op);}
  sel.value=chosen;lab.append(sel);return {lab,input:sel};
}
function can(mod){
  if(!account)return false;
  if(account.role==="super_admin")return true;
  if(mod==="safety")return true; // Supabase safety_view semantics
  if(mod==="admin")return false;
  if(account.role!=="admin"&&account.role!=="viewer_admin")return false;
  if(mod==="roster")return account.permissions?.roster===true||account.permissions?.education===true;
  return account.permissions?.[mod]===true;
}
function canEdit(mod){
  return account?.role==="super_admin" ||
    account?.role==="admin" && account.permissions?.[mod]===true;
}
async function api(kind,action,data={}){
  const headers={"Content-Type":"application/json"};
  if(token)headers.Authorization="Bearer "+token;
  let res;
  try{res=await fetch(API+(kind==="auth"?"she-v24-auth":"she-v24-store"),{
    method:"POST",headers,credentials:"omit",cache:"no-store",body:JSON.stringify({action,...data})
  });}catch{throw new Error("서버와 연결할 수 없습니다. 네트워크 또는 배포 상태를 확인하세요.");}
  let payload;
  try{payload=await res.json();}catch{throw new Error("서버가 올바른 응답을 보내지 않았습니다.");}
  if(!res.ok)throw new Error(String(payload.error||"요청을 처리하지 못했습니다.").slice(0,240));
  return payload;
}
function modeSwitch(value){
  mode=value;
  $("modeLogin").setAttribute("aria-pressed",String(value==="login"));
  $("modeRegister").setAttribute("aria-pressed",String(value==="register"));
  $("registerFields").hidden=value!=="register";
  $("registerName").required=value==="register";
  $("authSubmit").textContent=value==="register"?"회원가입 신청":"로그인";
  $("loginPassword").autocomplete=value==="register"?"new-password":"current-password";
  $("loginPassword").value="";
  show("");
}
function clearData(){
  safetyData=[];rosterData=null;educationData=null;healthData=null;
  rowCache.clear();listCache.value=null; riskLimit=50;rosterLimit=50;educationLimit=50;
}
function presentUser(a){
  account=a;
  $("guest").hidden=!!a;
  $("workApp").hidden=!a;
  if(!a){token=null;clearData();$("loginPassword").value="";return;}
  $("userLabel").textContent=(a.name||"사용자")+" ("+a.login_id+")";
  $("roleLabel").textContent=a.role+" · "+a.status+" · "+(a.department||"소속 미입력");
  const place=$("accessBadges");place.replaceChildren();
  for(const mod of MODS){
    const card=element("div",null,"stat");
    card.append(element("strong",NAMES[mod]));
    const granted=can(mod),edit=canEdit(mod);
    card.append(element("span",granted?(edit?"조회·수정 가능":"조회 가능"):"접근 불가",
      "status "+(granted?"yes":"no")));
    place.append(card);
  }
  for(const b of document.querySelectorAll(".nav button[data-mod]")){
    const name=b.dataset.mod;
    b.hidden=name==="admin"&&a.role!=="super_admin";
    b.disabled=name!=="password"&&name!=="admin"&&!can(name);
  }
}
async function signout(){
  if(token)try{await api("auth","logout");show("로그아웃 완료","ok");}
  catch(e){show("세션 종료: "+e.message,"error");}
  finally{presentUser(null);panel.replaceChildren();}
}
async function onAuth(ev){
  ev.preventDefault();if(busy)return;
  const login_id=$("loginId").value.trim(),password=$("loginPassword").value;
  if(!/^[a-z0-9][a-z0-9._-]{3,31}$/.test(login_id))return show("아이디 형식을 확인하세요.","error");
  if(Array.from(password).length<6||Array.from(password).length>128)
    return show("비밀번호는 6~128자리여야 합니다.","error");
  busy=true;$("authSubmit").disabled=true;
  try{
    if(mode==="register"){
      const n=$("registerName").value.trim(),d=$("registerDept").value.trim();
      if(!n||n.length>100||d.length>80)throw new Error("성명과 소속을 확인하세요.");
      const res=await api("auth","register",{login_id,password,display_name:n,department:d});
      $("loginPassword").value="";
      show(res.message||"가입 신청이 접수됐습니다. 최고관리자 승인을 기다리세요.","ok");
    }else{
      const res=await api("auth","login",{login_id,password});
      if(!res.token||res.account?.status!=="approved")throw new Error("승인된 계정을 확인할 수 없습니다.");
      token=res.token;presentUser(res.account);
      show("로그인 성공. 서버 권한을 확인했습니다.","ok");
      await open("safety");
    }
  }catch(e){$("loginPassword").value="";show(e.message,"error");}
  finally{busy=false;$("authSubmit").disabled=false;}
}
async function getList(){
  if(listCache.value)return listCache.value;
  const res=await api("store","store_list");
  listCache.value=res.rows||[];
  return listCache.value;
}
async function getRow(id,force=false){
  if(!force&&rowCache.has(id))return rowCache.get(id);
  const data=await api("store","store_get",{id});
  rowCache.set(id,data.row);
  return data.row;
}
async function writeRow(row){
  if(!row?.id)throw new Error("저장할 데이터가 없습니다.");
  const out=await api("store","store_put",{
    id:row.id,expected_updated_at:row.updated_at,
    documents:row.documents,items:row.items,users:row.users
  });
  row.updated_at=out.updated_at;
  rowCache.delete(row.id);
  await getRow(row.id,true);
  return out;
}
function makeTable(headings){
  const wrap=element("div",null,"tablewrap"),tbl=document.createElement("table");
  const thead=document.createElement("thead"),tr=document.createElement("tr");
  headings.forEach(h=>tr.append(element("th",h)));
  thead.append(tr);
  const body=document.createElement("tbody");
  tbl.append(thead,body);wrap.append(tbl);return {wrap,body};
}
function cell(text){
  const td=document.createElement("td"),div=element("div",text==null?"":text,"clamp");td.append(div);return td;
}
function fit(v,n=140){
  const s=String(v??"").replace(/\s+/g," ").trim();
  return s.length>n?s.slice(0,n)+"…":s;
}
function addToolSearch(name,placeholder,callback){
  const row=element("div",null,"toolrow");
  const input=document.createElement("input");
  input.type="search";input.setAttribute("aria-label",name);
  input.placeholder=placeholder;input.addEventListener("input",()=>callback(input.value));
  row.append(input);panel.append(row);return input;
}
function editForm(title,fields,onSave){
  const section=element("section",null,"editor");
  section.append(element("h3",title));
  const form=document.createElement("form"),inputs={};
  for(const def of fields){
    const item=field(def.label,def.value,def.type||"text",def.max||3000);
    item.lab.classList.toggle("full",def.full===true);
    if(def.required)item.input.required=true;
    if(def.type==="date")item.input.type="date";
    inputs[def.key]=item.input;form.append(item.lab);
  }
  const save=element("button","변경사항 저장","primary");
  save.type="submit";save.className="primary full";
  form.append(save);
  form.addEventListener("submit",async e=>{
    e.preventDefault();save.disabled=true;
    try{await onSave(Object.fromEntries(Object.entries(inputs).map(([key,i])=>[key,i.value])));}
    catch(err){show(err.message,"error");}
    finally{save.disabled=false;}
  });
  section.append(form);
  panel.append(section);section.scrollIntoView({block:"nearest",behavior:"smooth"});
}
async function safety(){
  cleanPanel("안전 · 위험성평가 자료","안전 자료는 승인된 직원에게 조회 가능하며, 수정은 안전 권한을 가진 관리자만 가능합니다.");
  if(!safetyData.length){
    const list=await getList(),ids=list.filter(r=>/^main_v10_chunk_\d+$/.test(r.id)).map(r=>r.id);
    const rows=await Promise.all(ids.map(id=>getRow(id)));
    safetyData=rows.flatMap(row=>row.items.map((item,index)=>({row,index,item})));
  }
  panel.append(element("p","총 "+safetyData.length.toLocaleString("ko-KR")+"개 위험성평가 항목","muted"));
  const input=addToolSearch("위험성평가 검색","작업명, 위험요인, 대책, 구역 검색",text=>{riskLimit=50;render(text);});
  const output=element("div");panel.append(output);
  function render(query){
    output.replaceChildren();
    const q=query.trim().toLocaleLowerCase("ko");
    const items=q?safetyData.filter(o=>([o.item.taskTitle,o.item.hazardText,o.item.measureText,o.item.areaTag,o.item.docName].join(" ")).toLocaleLowerCase("ko").includes(q)):safetyData;
    const shown=items.slice(0,riskLimit),t=makeTable(["작업명 / 위치","유해·위험요인","안전보건대책",""]);
    for(const o of shown){
      const tr=document.createElement("tr");
      tr.append(cell(fit(o.item.taskTitle,130)+"\n"+fit(o.item.areaTag,60)),cell(fit(o.item.hazardText,190)),cell(fit(o.item.measureText,190)));
      const actions=document.createElement("td");
      if(canEdit("safety"))actions.append(button("수정",()=>riskEdit(o)));
      tr.append(actions);t.body.append(tr);
    }
    output.append(element("p","검색 결과 "+items.length+"건 · "+shown.length+"건 표시","muted"),t.wrap);
    if(items.length>riskLimit)output.append(button("50건 더 보기",()=>{riskLimit+=50;render(input.value);}));
  }
  render("");
}
function riskEdit(o){
  if(!canEdit("safety"))return show("수정 권한이 없습니다.","error");
  editForm("위험성평가 항목 수정",[
    {key:"taskTitle",label:"작업명",value:o.item.taskTitle,required:true,max:500,full:true},
    {key:"hazardText",label:"유해·위험요인",value:o.item.hazardText,type:"textarea",max:10000,full:true},
    {key:"measureText",label:"안전보건대책",value:o.item.measureText,type:"textarea",max:10000,full:true}
  ],async values=>{
    const latest=await getRow(o.row.id);
    const item=latest.items[o.index];
    if(!item || item.id!==o.item.id)throw new Error("항목 위치가 변경되었습니다. 자료를 다시 불러오세요.");
    latest.items[o.index]={...item,...values};
    await writeRow(latest);clearData();show("위험성평가 항목 수정 완료. 이전 버전은 서버에 보관했습니다.","ok");
    await safety();
  });
}
async function roster(){
  cleanPanel("인원 · 근로자 연명부","근로자 개인정보를 포함할 수 있습니다. 교육 권한만 있는 계정은 개인정보를 제외한 교육 대상 정보만 받습니다.");
  rosterData=await getRow("main_v1_roster_master");
  const redacted=rosterData.redacted_for_education===true;
  if(redacted)panel.append(element("p","교육 권한 전용 조회: 생년월일·연락처·혈액형·사번 등은 서버에서 제외되었습니다.","notice"));
  panel.append(element("p","총 "+rosterData.items.length+"명","muted"));
  const input=addToolSearch("연명부 검색","이름, 소속, 공종 검색",text=>{rosterLimit=50;render(text);});
  const output=element("div");panel.append(output);
  function render(query){
    output.replaceChildren();
    const q=query.trim().toLocaleLowerCase("ko");
    const items=rosterData.items.map((item,index)=>({item,index}))
      .filter(({item})=>[item.name,item.company,item.job,item.process,item.workerNo].join(" ").toLocaleLowerCase("ko").includes(q));
    const t=makeTable(["성명","소속","공종","직책 / 작업",""]);
    for(const {item,index} of items.slice(0,rosterLimit)){
      const tr=document.createElement("tr");tr.append(cell(item.name),cell(item.company),cell(item.process),cell(item.job));
      const td=document.createElement("td");
      if(canEdit("roster")&&!redacted)td.append(button("수정",()=>rosterEdit(item,index)));
      tr.append(td);t.body.append(tr);
    }
    output.append(element("p","검색 결과 "+items.length+"명","muted"),t.wrap);
    if(items.length>rosterLimit)output.append(button("50명 더 보기",()=>{rosterLimit+=50;render(input.value);}));
  }
  render("");
}
function rosterEdit(item,index){
  if(!canEdit("roster")||rosterData.redacted_for_education)return show("인원 수정 권한이 없습니다.","error");
  editForm("근로자 연명부 정보 수정",[
    {key:"name",label:"성명",value:item.name,max:100,required:true},
    {key:"company",label:"소속",value:item.company,max:150},
    {key:"job",label:"직책 / 직종",value:item.job,max:120},
    {key:"process",label:"공종",value:item.process,max:150},
    {key:"workerNo",label:"근로자 번호",value:item.workerNo,max:100}
  ],async values=>{
    const row=await getRow("main_v1_roster_master");
    const current=row.items[index];
    if(!current||current.uid!==item.uid)throw new Error("해당 근로자가 변경되었습니다. 연명부를 다시 불러오세요.");
    row.items[index]={...current,...values};
    await writeRow(row);clearData();show("근로자 정보 수정 완료. 변경 전 데이터는 서버에 보관했습니다.","ok");
    await roster();
  });
}
async function education(){
  cleanPanel("교육 · 교육 일정","교육 권한이 있는 계정만 접근할 수 있습니다. 조회 관리자는 읽기 전용입니다.");
  educationData=await getRow("main_v1_edu_schedule");
  if(canEdit("education"))panel.append(button("교육 일정 등록",()=>educationEdit(null,-1),"primary"));
  const input=addToolSearch("교육 일정 검색","교육명, 날짜, 장소 검색",q=>{educationLimit=50;render(q);});
  const out=element("div");panel.append(out);
  function render(query){
    out.replaceChildren();const q=query.trim().toLocaleLowerCase("ko");
    const events=educationData.items.map((item,index)=>({item,index}))
      .filter(({item})=>[item.title,item.date,item.location,item.category].join(" ").toLocaleLowerCase("ko").includes(q))
      .sort((a,b)=>String(b.item.date||"").localeCompare(String(a.item.date||"")));
    const t=makeTable(["일자","교육명","장소 / 담당","상태 / 대상",""]);
    for(const {item,index} of events.slice(0,educationLimit)){
      const tr=document.createElement("tr");
      tr.append(cell(item.date),cell(item.title),
        cell([item.location,item.instructor].filter(Boolean).join(" / ")),
        cell([item.status,Array.isArray(item.attendeeKeys)?item.attendeeKeys.length+"명":""].filter(Boolean).join(" / ")));
      const td=document.createElement("td");
      if(canEdit("education"))td.append(button("수정",()=>educationEdit(item,index)));
      tr.append(td);t.body.append(tr);
    }
    out.append(element("p","총 "+events.length+"개 교육 일정","muted"),t.wrap);
    if(events.length>educationLimit)out.append(button("더 보기",()=>{educationLimit+=50;render(input.value);}));
  }
  render("");
}
function educationEdit(item,index){
  if(!canEdit("education"))return show("교육 수정 권한이 없습니다.","error");
  editForm(item?"교육 일정 수정":"신규 교육 일정 등록",[
    {key:"title",label:"교육명",value:item?.title,max:200,required:true,full:true},
    {key:"date",label:"교육일",value:item?.date,type:"date",required:true},
    {key:"location",label:"교육 장소",value:item?.location,max:150},
    {key:"startTime",label:"시작 시각",value:item?.startTime,max:20},
    {key:"endTime",label:"종료 시각",value:item?.endTime,max:20},
    {key:"instructor",label:"강사 / 담당자",value:item?.instructor,max:150},
    {key:"notes",label:"비고",value:item?.notes,type:"textarea",max:4000,full:true}
  ],async values=>{
    if(!values.title.trim()||!/^\d{4}-\d{2}-\d{2}$/.test(values.date))throw new Error("교육명과 교육일을 확인하세요.");
    const row=await getRow("main_v1_edu_schedule");
    if(item){
      const old=row.items[index];
      if(!old||old.id!==item.id)throw new Error("교육 일정이 변경되었습니다. 다시 불러오세요.");
      row.items[index]={...old,...values};
    }else{
      row.items.push({...values,id:crypto.randomUUID(),kind:"regular",
        category:"일반교육",status:"scheduled",createdAt:new Date().toISOString(),
        attendeeKeys:[],confirmedKeys:[]});
    }
    if(row.documents[0] && typeof row.documents[0]==="object")
      row.documents[0]={...row.documents[0],itemCount:row.items.length};
    await writeRow(row);clearData();
    show(item?"교육 일정 수정 완료":"교육 일정 등록 완료","ok");await education();
  });
}
async function health(){
  cleanPanel("보건 · 업무 자료","보건 메뉴는 보건 권한이 있는 관리자에게만 표시됩니다. 보건정보는 특히 민감한 자료이므로 접근을 엄격히 제한합니다.");
  const rows=(await getList()).filter(r=>r.scope==="health");
  if(!rows.length){
    panel.append(element("div","현재 V24에서 조회 가능한 보건 데이터 행이 없습니다. 기존 보건 기능의 자료 구조를 검증한 후 연동해야 합니다.","empty"));
    return;
  }
  panel.append(element("p","보건 데이터 행 "+rows.length+"개","muted"));
  for(const ref of rows){
    const card=element("div",null,"member");
    card.append(element("strong",ref.id),element("p","자료 내용은 권한이 확인된 사용자에게만 표시됩니다.","muted"));
    card.append(button("자료 개수 확인",async()=>{
      try{const data=await api("store","store_counts",{id:ref.id});
        show(ref.id+": 문서 "+data.documents_count+" / 항목 "+data.items_count,"ok");}
      catch(err){show(err.message,"error");}
    }));
    panel.append(card);
  }
}
async function admin(){
  cleanPanel("최고관리자 · 가입 승인 / 직원별 권한","이 화면에서 회원가입 승인 및 메뉴별 권한을 서버에 저장합니다.");
  const signup=element("section",null,"member");
  signup.append(element("h3","신규 회원가입 접수 관리"));
  const [res, windowState] = await Promise.all([
    api("auth","users"), api("auth","registration_status")
  ]);
  const active=windowState.enabled===true;
  const expires=windowState.expires_at?new Date(windowState.expires_at).toLocaleString("ko-KR",{timeZone:"Asia/Seoul"}):"없음";
  signup.append(element("p",active?"현재 가입 신청 접수 중 · 자동 종료: "+expires:"현재 신규 가입 접수 중지","muted"));
  const toggle=button(active?"신규 가입 접수 닫기":"신규 가입 접수 2시간 열기",async()=>{
    toggle.disabled=true;
    try{
      await api("auth","set_registration",{enabled:!active});
      show(active?"신규 가입 접수를 종료했습니다.":"신규 가입 접수를 2시간 동안 열었습니다.","ok");
      await admin();
    }catch(err){show(err.message,"error");}
    finally{toggle.disabled=false;}
  },active?"danger":"primary");
  signup.append(toggle);
  panel.append(signup);
  const reload=button("회원 목록 새로고침",()=>admin());panel.append(reload);
  for(const u of res.users||[]){
    const card=element("div",null,"member");
    card.append(element("strong",(u.display_name||"이름 없음")+" · "+u.login_id));
    card.append(element("p",(u.department||"소속 없음")+" / "+u.role+" / "+u.status,"meta"));
    if(u.role==="super_admin"){
      card.append(element("p","최고관리자 계정은 변경할 수 없습니다.","muted"));panel.append(card);continue;
    }
    const row=element("div",null,"split");
    const role=selectField("역할",[["worker","근로자"],["viewer_admin","조회 관리자"],["admin","관리자"]],u.role);
    const status=selectField("상태",[["pending","승인 대기"],["approved","승인"],["blocked","차단"],["rejected","거절"]],u.status);
    row.append(role.lab,status.lab);card.append(row);
    const perm=element("div",null,"permission-set"),checks={};
    for(const mod of MODS){
      const lab=element("label",NAMES[mod]),cb=document.createElement("input");
      cb.type="checkbox";cb.checked=u.permissions?.[mod]===true;checks[mod]=cb;
      lab.prepend(cb);perm.append(lab);
    }
    card.append(perm);
    const save=button("가입 승인·권한 저장",async()=>{
      save.disabled=true;
      try{
        await api("auth","set_user",{account_id:u.id,role:role.input.value,
          status:status.input.value,permissions:Object.fromEntries(MODS.map(m=>[m,checks[m].checked]))});
        show(u.login_id+" 계정 설정 저장 완료","ok");await admin();
      }catch(err){show(err.message,"error");}
      finally{save.disabled=false;}
    },"primary");
    card.append(save);panel.append(card);
  }
}
function password(){
  cleanPanel("내 비밀번호 변경","현재 비밀번호 확인 후 변경합니다. 변경하면 모든 기존 로그인 세션이 해제됩니다.");
  const fields=[field("현재 비밀번호","","password",128),field("새 비밀번호 (최소 6자리)","","password",128),field("새 비밀번호 확인","","password",128)];
  const form=element("form",null,"form");
  fields.forEach(x=>{x.input.required=true;x.input.minLength=6;form.append(x.lab);});
  const submit=element("button","비밀번호 변경","primary");
  submit.type="submit";form.append(submit);
  form.addEventListener("submit",async ev=>{
    ev.preventDefault();submit.disabled=true;
    try{
      const old_password=fields[0].input.value,new_password=fields[1].input.value;
      if(new_password!==fields[2].input.value)throw new Error("새 비밀번호가 일치하지 않습니다.");
      if(Array.from(new_password).length<6)throw new Error("비밀번호는 최소 6자리여야 합니다.");
      await api("auth","change_password",{old_password,new_password});
      presentUser(null);show("비밀번호 변경 완료. 새 비밀번호로 다시 로그인하세요.","ok");
    }catch(e){show(e.message,"error");}
    finally{fields.forEach(f=>f.input.value="");submit.disabled=false;}
  });
  panel.append(form);
}
async function open(mod){
  if(!account)return;
  if(mod!=="password"&&!can(mod))return show("선택한 메뉴에 접근 권한이 없습니다.","error");
  active=mod;
  for(const nav of document.querySelectorAll(".nav button[data-mod]"))
    nav.setAttribute("aria-selected",String(nav.dataset.mod===mod));
  show("");
  try{
    switch(mod){
      case "safety":await safety();break;
      case "roster":await roster();break;
      case "education":await education();break;
      case "health":await health();break;
      case "admin":await admin();break;
      case "password":password();break;
    }
  }catch(e){cleanPanel(NAMES[mod]+" 메뉴 오류");panel.append(element("p",e.message,"muted"));show(e.message,"error");}
}
$("modeLogin").addEventListener("click",()=>modeSwitch("login"));
$("modeRegister").addEventListener("click",()=>modeSwitch("register"));
$("loginForm").addEventListener("submit",onAuth);
$("logout").addEventListener("click",signout);
$("sessionCheck").addEventListener("click",async()=>{
  try{
    const res=await api("auth","me");
    presentUser(res.account);
    show("서버 로그인 세션 및 현재 권한 확인 완료","ok");
  }catch(e){presentUser(null);show(e.message,"error");}
});
for(const b of document.querySelectorAll(".nav button[data-mod]"))
  b.addEventListener("click",()=>open(b.dataset.mod));
modeSwitch("login");
})();