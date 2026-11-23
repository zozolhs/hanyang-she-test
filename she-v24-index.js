/* HANYANG SHE V24 compatibility bridge.
 * Preserves existing V23-designed index.html and module pages.
 * All authentication/data operations are validated by V24 Edge Functions.
 * No legacy email auth, browser master PIN, or direct PostgREST data calls.
 * TEST ONLY. Do not publish until full regression tests are complete.
 */
(()=>{
"use strict";
if(window.SHESEC) return;
const ENDPOINT="https://ahmqthuympannqsrszvv.supabase.co/functions/v1/";
const STORAGE_KEY="she_v24_opaque_session_test";
const LEGACY_KEYS=["hy_super_admin_verified_v15","hy_admin_verified_session_v15",
  "hy_logged_user_session_v15","hy_health_manager_verified"];
const MODULES=["safety","health","roster","education"];
let token=sessionStorage.getItem(STORAGE_KEY)||null;
let profile=null,verifiedAt=0,ongoing=null,notifiedToken=null;
const versions=new Map(),fullRows=new Map();
// Read caches exist only in this browser tab's memory, never in persistent storage.
const pendingRows=new Map(),pendingBatches=new Map();
let sessionEpoch=0,educationRosterCache=null,educationRosterPending=null;
function clearLegacy(){
  for(const k of LEGACY_KEYS)sessionStorage.removeItem(k);
}
function setToken(next){
  token=next||null;
  if(token)sessionStorage.setItem(STORAGE_KEY,token);
  else sessionStorage.removeItem(STORAGE_KEY);
}
function failure(message,status){
  const err=new Error(message);err.status=status;return err;
}
async function request(kind,action,data={}){
  let response;
  try{
    response=await fetch(ENDPOINT+(kind==="auth"?"she-v24-auth":"she-v24-store"),{
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        ...(token?{Authorization:"Bearer "+token}:{})
      },
      credentials:"omit",cache:"no-store",body:JSON.stringify({action,...data})
    });
  }catch{
    throw failure("인증 서버와 연결할 수 없습니다. 네트워크를 확인하세요.",503);
  }
  let value;
  try{value=await response.json();}
  catch{throw failure("서버 응답 형식이 올바르지 않습니다.",503);}
  if(!response.ok){
    if(response.status===401&&action!=="login")reset();
    throw failure(String(value.error||"서버 요청이 거부됐습니다.").slice(0,240),response.status);
  }
  return value;
}
function normalize(a){
  if(!a)return null;
  return {
    id:a.id,login_id:a.login_id,
    name:a.name||a.display_name,department:a.department||"",
    role:a.role,status:a.status,
    permissions:a.permissions||{},
    maintenance:a.maintenance===true
  };
}
function reset(){
  sessionEpoch++;
  setToken(null);profile=null;verifiedAt=0;notifiedToken=null;versions.clear();fullRows.clear();
  pendingRows.clear();pendingBatches.clear();
  educationRosterCache=null;educationRosterPending=null;
  clearLegacy();
}
function permitted(p,mod,write=false){
  if(!p||p.status!=="approved"||(p.maintenance&&p.role!=="super_admin"))
    return false;
  if(p.role==="super_admin")return true;
  if(mod==="admin"||mod==="users_admin")return false;
  // The portal login guard remains valid even without module access.
  if(mod==="safety_view")return !write;
  // Preserve existing worker access to basic SAFETY search only.
  if(mod==="safety"&&p.role==="worker")return !write;
  if(!MODULES.includes(mod))return false;
  if(p.role!=="admin"&&p.role!=="viewer_admin")return false;
  const canRead=p.permissions?.[mod]===true;
  if(!write)return canRead;
  return p.role==="admin"&&canRead&&p.permissions?.[mod+"_write"]===true;
}
async function refresh(force=false){
  if(ongoing)return ongoing;
  if(!force&&profile&&Date.now()-verifiedAt<10_000)return profile;
  ongoing=(async()=>{
    try{
      if(!token)throw failure("로그인이 필요합니다.",401);
      const res=await request("auth","me");
      profile=normalize(res.account);
      if(!profile||profile.status!=="approved")throw failure("승인된 계정이 아닙니다.",403);
      verifiedAt=Date.now();
      // Old login flags must not authorize any server action.
      clearLegacy();
      // Full business-data synchronization is launched only once per session.
      // A permission check or browser focus must not reload all risk data.
      if(permitted(profile,"safety") && notifiedToken!==token){
        notifiedToken=token;
        document.dispatchEvent(new CustomEvent("she:authorized",{detail:profile}));
      }
      return profile;
    }catch(e){
      if(e.status===401||e.status===403)reset();
      throw e;
    }
  })();
  try{return await ongoing;}finally{ongoing=null;}
}
async function guard(mod="safety_view",force=true){
  try{
    const p=await refresh(force);
    return {
      ok:permitted(p,mod,false),profile:p,
      reason:p.maintenance&&p.role!=="super_admin"?"maintenance":
        p.status!=="approved"?"not-approved":"forbidden"
    };
  }catch(error){return {ok:false,profile:null,
    reason:error.status===503&&/점검/.test(error.message)?"maintenance":"login",error};}
}
async function login(login_id,password){
  reset();
  const result=await request("auth","login",{login_id,password});
  if(!result.token||result.account?.status!=="approved")
    throw failure("로그인 세션을 발급받지 못했습니다.",403);
  setToken(result.token);
  profile=normalize(result.account);
  verifiedAt=Date.now();
  clearLegacy();
  return profile;
}
async function register(login_id,password,display_name,department){
  return request("auth","register",{login_id,password,display_name,department});
}
async function logout(){
  try{if(token)await request("auth","logout");}
  finally{reset();}
}
async function changePassword(old_password,new_password){
  await refresh(true);
  const result=await request("auth","change_password",{old_password,new_password});
  reset();
  return result;
}
async function users(){
  await refresh(true);
  if(profile?.role!=="super_admin")throw failure("최고관리자 권한이 필요합니다.",403);
  const data=await request("auth","users");
  return (data.users||[]).map(normalize);
}
async function setUser(account_id,role,status,permissions){
  await refresh(true);
  if(profile?.role!=="super_admin")throw failure("최고관리자 권한이 필요합니다.",403);
  return request("auth","set_user",{account_id,role,status,permissions});
}
async function deleteUser(account_id,expected_login_id){
  await refresh(true);
  if(profile?.role!=="super_admin")throw failure("최고관리자 권한이 필요합니다.",403);
  if(!/^[0-9a-f-]{36}$/i.test(account_id||"")||
     !/^[a-z0-9][a-z0-9._-]{3,31}$/.test(expected_login_id||"")||
     account_id===profile.id)throw failure("삭제할 계정 정보가 올바르지 않습니다.",400);
  return request("auth","delete_user",{account_id,expected_login_id});
}
async function maintenance(enabled){
  await refresh(true);
  if(profile?.role!=="super_admin")throw failure("최고관리자 권한이 필요합니다.",403);
  const result=await request("auth","set_maintenance",{enabled:!!enabled});
  profile={...profile,maintenance:result.enabled===true};
  verifiedAt=0;
  return profile;
}
async function registrationStatus(){
  await refresh(true);
  if(profile?.role!=="super_admin")throw failure("최고관리자 권한이 필요합니다.",403);
  return request("auth","registration_status");
}
async function setRegistration(enabled){
  await refresh(true);
  if(profile?.role!=="super_admin")throw failure("최고관리자 권한이 필요합니다.",403);
  return request("auth","set_registration",{enabled:!!enabled});
}
function selectColumns(row,cols){
  if(!row)return row;
  if(cols==="*"||!cols)return row;
  return Object.fromEntries(cols.split(",").map(s=>s.trim()).filter(Boolean)
    .filter(s=>Object.hasOwn(row,s)).map(s=>[s,row[s]]));
}
function rememberRow(row){
  const existing=fullRows.get(row.id);
  // A slower response must never overwrite a newer successful local save.
  if(existing && Date.parse(existing.updated_at)>Date.parse(row.updated_at))
    return existing;
  fullRows.set(row.id,row);versions.set(row.id,row.updated_at);
  return row;
}
async function fetchRow(id){
  if(pendingRows.has(id))return pendingRows.get(id);
  const epoch=sessionEpoch,session=token,cached=fullRows.get(id);
  const task=(async()=>{
    const data={id};
    if(cached && typeof cached.updated_at==="string"){
      data.if_updated_at=cached.updated_at;
      data.if_view=cached.redacted_for_education===true?"education_redacted":"full";
    }
    let res=await request("store","store_get",data);
    if(sessionEpoch!==epoch||token!==session)throw failure("로그인 세션이 변경되었습니다.",401);
    if(res.not_modified){
      const latest=fullRows.get(id);
      const view=latest?.redacted_for_education===true?"education_redacted":"full";
      if(latest && latest.updated_at===res.updated_at && view===res.view)return latest;
      // Session or cache changed while the request was running: re-fetch safely.
      res=await request("store","store_get",{id});
      if(sessionEpoch!==epoch||token!==session)throw failure("로그인 세션이 변경되었습니다.",401);
    }
    if(!res.row)throw failure("서버에서 업무 자료를 받지 못했습니다.",503);
    return rememberRow(res.row);
  })();
  pendingRows.set(id,task);
  try{return await task;}
  finally{if(pendingRows.get(id)===task)pendingRows.delete(id);}
}
async function findRows(filter,columns,single=false){
  const id=filter.id;
  if(typeof id==="string"){
    try{
      const row=await fetchRow(id);
      return {data:single?selectColumns(row,columns):[selectColumns(row,columns)],error:null};
    }catch(e){
      if(e.status===404)return {data:single?null:[],error:null};
      return {data:null,error:e};
    }
  }
  if(Array.isArray(id)){
    if(id.length===0)return {data:single?null:[],error:null};
    try{
      // Typical risk-assessment startup asks for 10 chunk IDs, most absent.
      // One authorized batch request replaces up to 30 individual requests.
      if(id.length<=30 && id.every(key=>typeof key==="string")){
        const ids=[...new Set(id)];
        const key=ids.join("\u0000");
        let batch=pendingBatches.get(key);
        if(!batch){
          const epoch=sessionEpoch,session=token;
          batch=(async()=>{
            const res=await request("store","store_get_batch",{ids});
            if(sessionEpoch!==epoch||token!==session)
              throw failure("로그인 세션이 변경되었습니다.",401);
            const rows=new Map();
            for(const row of res.rows||[]){
              if(!ids.includes(row.id))continue;
              rows.set(row.id,rememberRow(row));
            }
            return rows;
          })();
          pendingBatches.set(key,batch);
        }
        let result;
        try{result=await batch;}
        finally{if(pendingBatches.get(key)===batch)pendingBatches.delete(key);}
        const rows=id.map(key=>result.get(key)).filter(Boolean).map(row=>selectColumns(row,columns));
        return {data:single?rows[0]||null:rows,error:null};
      }
      const all=await Promise.all(id.map(async key=>{
        try{return await fetchRow(key);}
        catch(e){if(e.status===404)return null;throw e;}
      }));
      const rows=all.filter(Boolean).map(row=>selectColumns(row,columns));
      return {data:single?rows[0]||null:rows,error:null};
    }catch(e){return {data:null,error:e};}
  }
  return {data:null,error:failure("데이터 조회 ID가 필요합니다.",400)};
}
async function writeSafetyBatch(raws){
  if(!Array.isArray(raws)||!raws.length)throw failure("저장할 자료가 없습니다.",400);
  const rows=[];
  for(const raw of raws){
    const id=raw.id,version=versions.get(id),old=fullRows.get(id);
    if(!/^main_v10_(meta|chunk_\d+)$/.test(id)||!old||!version){
      throw failure("서버에 기록된 안전 자료 버전이 없습니다. 최신 자료를 다시 불러오세요.",409);
    }
    rows.push({id,expected_updated_at:version,
      documents:raw.documents??old.documents,
      items:raw.items??old.items,
      users:raw.users??old.users});
  }
  const res=await request("store","store_put_batch",{rows});
  for(const r of res.rows||[]){
    const item=rows.find(x=>x.id===r.id);
    if(!item)continue;
    const current={id:item.id,documents:item.documents,items:item.items,
      users:item.users,updated_at:r.updated_at};
    versions.set(item.id,r.updated_at);fullRows.set(item.id,current);
  }
  return (res.rows||[]).map(r=>fullRows.get(r.id));
}
async function writeOne(raw,expectedFromQuery){
  if(!raw||typeof raw.id!=="string")throw failure("저장할 데이터 ID가 없습니다.",400);
  const id=raw.id;
  let old=fullRows.get(id);
  if(!old)old=await fetchRow(id);
  const expected=expectedFromQuery||versions.get(id);
  if(!expected)throw failure("최초 데이터 버전 정보가 없어 저장을 차단했습니다.",409);
  if(!old)throw failure("저장 데이터가 없어 신규 행은 생성할 수 없습니다.",404);
  const next={
    id,expected_updated_at:expected,
    documents:raw.documents??old.documents,
    items:raw.items??old.items,
    users:raw.users??old.users
  };
  const res=await request("store","store_put",next);
  const updated={...old,documents:next.documents,items:next.items,
    users:next.users,updated_at:res.updated_at};
  fullRows.set(id,updated);versions.set(id,res.updated_at);
  if(id==="main_v1_roster_master")educationRosterCache=null;
  return updated;
}
class StoreQuery {
  constructor(mode,table,data=null){this.mode=mode;this.table=table;this.payload=data;
    this.conditions={};this.columns="*";this.isSingle=false;}
  select(cols="*"){
    this.columns=cols;
    if(this.mode==="update"||this.mode==="insert"||this.mode==="upsert")return this;
    return this;
  }
  eq(k,v){if(k==="id")this.conditions.id=v;
    else if(k==="updated_at")this.conditions.expected=v;
    return this;}
  is(k,v){if(k==="updated_at"&&v===null)this.conditions.expected=null;return this;}
  in(k,v){if(k==="id")this.conditions.id=v;return this;}
  maybeSingle(){this.isSingle=true;return this.execute();}
  single(){this.isSingle=true;return this.execute();}
  async execute(){
    if(this.table!=="hanyang_safety_store")
      return {data:null,error:failure("허용되지 않은 데이터 테이블입니다.",403)};
    try{
      if(this.mode==="select")return await findRows(this.conditions,this.columns,this.isSingle);
      if(this.mode==="insert")
        return {data:null,error:failure("기존 자료 행이 없는 신규 생성은 아직 지원하지 않습니다.",403)};
      if(this.mode==="update"){
        if(typeof this.conditions.id!=="string")throw failure("수정할 행 식별자가 필요합니다.",400);
        const base=await fetchRow(this.conditions.id);
        if(!base)throw failure("수정할 데이터가 없습니다.",404);
        if(!this.conditions.expected){
          throw failure("업데이트 버전 정보가 누락되어 저장을 차단했습니다.",409);
        }
        if(base.updated_at!==this.conditions.expected)
          return {data:[],error:null};
        const updated=await writeOne({...this.payload,id:base.id},
          this.conditions.expected);
        return {data:[selectColumns(updated,this.columns)],error:null};
      }
      if(this.mode==="upsert"){
        const raws=Array.isArray(this.payload)?this.payload:[this.payload];
        if(raws.every(r=>/^main_v10_(meta|chunk_\d+)$/.test(r?.id||""))){
          const updated=await writeSafetyBatch(raws);
          return {data:updated.map(r=>selectColumns(r,this.columns)),error:null};
        }
        const updated=[];
        for(const row of raws)updated.push(await writeOne(row,null));
        return {data:updated.map(r=>selectColumns(r,this.columns)),error:null};
      }
      throw failure("지원하지 않는 DB 동작입니다.",400);
    }catch(e){return {data:null,error:e};}
  }
  then(onFulfilled,onRejected){return this.execute().then(onFulfilled,onRejected);}
}
function channel(){
  // No direct browser Realtime stream: authenticated refresh via protected requests.
  const obj={on(){return obj;},subscribe(){return obj;}};
  return obj;
}
async function rpc(name,args={}){
  if(name==="she_education_roster_v2"){
    try{
      if(!educationRosterPending){
        const epoch=sessionEpoch,session=token,cached=educationRosterCache;
        educationRosterPending=(async()=>{
          const res=await request("store","store_education_roster",
            cached?{if_updated_at:cached.updated_at}:{});
          if(epoch!==sessionEpoch||session!==token)
            throw failure("로그인 세션이 변경되었습니다.",401);
          if(res.not_modified && cached && cached.updated_at===res.updated_at)
            return {data:cached.workers,not_modified:true,error:null};
          if(res.not_modified){
            const full=await request("store","store_education_roster");
            if(epoch!==sessionEpoch||session!==token)
              throw failure("로그인 세션이 변경되었습니다.",401);
            educationRosterCache={workers:full.workers||[],updated_at:full.updated_at};
          }else educationRosterCache={workers:res.workers||[],updated_at:res.updated_at};
          return {data:educationRosterCache.workers,not_modified:false,error:null};
        })();
      }
      return await educationRosterPending;
    }catch(e){return {data:null,error:e};}
    finally{educationRosterPending=null;}
  }
  if(name==="she_confirm_education_v2"){
    try{
      const res=await request("store","store_confirm_education",{
        event_id:args.p_event_id,expected_updated_at:args.p_expected_updated_at,
        attendance:args.p_attendance
      });
      educationRosterCache=null;
      return {data:res,error:null};
    }catch(e){return {data:null,error:e};}
  }
  return {data:null,error:failure("허용되지 않은 데이터 함수입니다.",403)};
}
const client=Object.freeze({
  from(table){
    return {
      select(cols="*"){const q=new StoreQuery("select",table);return q.select(cols);},
      update(data){return new StoreQuery("update",table,data);},
      insert(data){return new StoreQuery("insert",table,data);},
      upsert(data){return new StoreQuery("upsert",table,data).execute();}
    };
  },
  rpc,channel
});
window.SHESEC=Object.freeze({
  client,refresh,guard,login,register,logout,users,setUser,deleteUser,
  maintenance,registrationStatus,setRegistration,changePassword,
  permit:(p,m)=>permitted(p,m,false),
  canWrite:(p,m)=>permitted(p,m,true),
  get profile(){return profile;},
  onReadyFor:async m=>(await guard(m,true)).ok
});
})();
