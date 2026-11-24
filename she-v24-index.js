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
// Presence is current state only. The opaque bearer stays in sessionStorage.
const IDLE_MS=3600000, BEAT_MS=60000, IDLE_PREFIX="she_v24_idle_test:";
const IDLE_SESSION_KEY=IDLE_PREFIX+"session", IDLE_ACTIVITY_KEY=IDLE_PREFIX+"activity";
let sessionId=null,lastActivity=0,lastPersist=0,lastBeat=0,beatTimer=null,deadlineTimer=null,beatPending=false,ending=false,forcedEnd=false,busyWrites=0;
const readLocal=k=>{try{return localStorage.getItem(k);}catch{return null;}};
const writeLocal=(k,v)=>{try{localStorage.setItem(k,String(v));}catch{}};
const readTab=k=>{try{return sessionStorage.getItem(k);}catch{return null;}};
const writeTab=(k,v)=>{try{sessionStorage.setItem(k,String(v));}catch{}};
function activityKey(){return sessionId?IDLE_PREFIX+"activity:"+sessionId:null;}
function beatKey(){return sessionId?IDLE_PREFIX+"beat:"+sessionId:null;}
function latestActivity(){
  const key=activityKey(), now=Date.now();
  const shared=key?Number(readLocal(key)):0;
  if(shared>0&&shared<=now)lastActivity=Math.max(lastActivity,shared);
  return lastActivity;
}
function persistActivity(){
  writeTab(IDLE_ACTIVITY_KEY,lastActivity);
  const key=activityKey();if(key&&Number(readLocal(key))<lastActivity)writeLocal(key,lastActivity);
  lastPersist=lastActivity;
}
function stopPresence(){
  clearTimeout(deadlineTimer);clearTimeout(beatTimer);
  deadlineTimer=beatTimer=null;beatPending=false;lastBeat=0;lastActivity=0;lastPersist=0;sessionId=null;ending=false;forcedEnd=false;
  try{sessionStorage.removeItem(IDLE_SESSION_KEY);sessionStorage.removeItem(IDLE_ACTIVITY_KEY);}catch{}
}
function protectWrite(fn){
  busyWrites++;
  return Promise.resolve().then(fn).finally(()=>{
    busyWrites=Math.max(0,busyWrites-1);
    if(!busyWrites&&token&&sessionId&&(forcedEnd||Date.now()-latestActivity()>=IDLE_MS))expireIdle();
  });
}
function expireIdle(){
  if(ending||!token)return;
  forcedEnd=true;
  if(busyWrites){clearTimeout(deadlineTimer);deadlineTimer=setTimeout(checkDeadline,1000);return;}
  ending=true;
  const expiredToken=token,key=activityKey();
  // No advance warning; native beforeunload protection remains for unsaved work.
  // A pending mutation is never aborted by this timer.
  if(key)writeLocal(key,0);
  try{void fetch(ENDPOINT+"she-v24-auth",{method:"POST",
    headers:{"Content-Type":"application/json",Authorization:"Bearer "+expiredToken},
    credentials:"omit",keepalive:true,body:JSON.stringify({action:"logout"})}).catch(()=>{});}catch{}
  reset();
  ending=true;
  // Cover the previous document immediately, including when native unsaved-work
  // navigation protection is triggered. The existing login gate handles re-entry.
  if(document.body){
    const shield=document.createElement("div");
    shield.id="sheIdleLock";shield.setAttribute("role","status");
    shield.style.cssText="position:fixed;inset:0;z-index:2147483647;background:#f1f5f9;display:grid;place-items:center;color:#16286e;font:700 16px sans-serif;";
    const link=document.createElement("a");link.href="./index.html";link.textContent="로그인 세션이 만료되었습니다. 다시 로그인";
    shield.append(link);document.body.append(shield);
    // Block access to the former document even if the unload prompt is cancelled.
    for(const child of document.body.children)if(child!==shield)child.inert=true;
  }
  location.replace(new URL("./index.html",location.href).href);
}
function checkDeadline(){
  clearTimeout(deadlineTimer);deadlineTimer=null;
  if(!token||!sessionId||ending)return;
  if(forcedEnd||readLocal(activityKey())==="0"){expireIdle();return;}
  const remaining=IDLE_MS-(Date.now()-latestActivity());
  if(remaining<=0){expireIdle();return;}
  deadlineTimer=setTimeout(checkDeadline,remaining);
}
function scheduleBeat(delay=BEAT_MS){
  clearTimeout(beatTimer);beatTimer=null;
  if(token&&sessionId&&!ending)beatTimer=setTimeout(sendPresence,delay);
}
async function sendPresence(){
  if(!token||!sessionId||ending||forcedEnd||beatPending)return;
  const now=Date.now(),age=now-latestActivity();
  if(age>=IDLE_MS){checkDeadline();return;}
  const shared=Number(readLocal(beatKey()))||0;
  const previous=Math.max(lastBeat,shared<=now?shared:0);
  if(now-previous<BEAT_MS){scheduleBeat(BEAT_MS-(now-previous));return;}
  const epoch=sessionEpoch;beatPending=true;
  try{
    await request("auth","presence",{activity_age_ms:Math.max(0,Math.floor(age))});
    if(epoch===sessionEpoch&&sessionId){lastBeat=Date.now();writeLocal(beatKey(),lastBeat);}
  }catch(e){
    // Transient network/maintenance errors must not clear data or restart modules.
    // Authentication expiry is handled by the shared request guard.
  }finally{
    if(epoch===sessionEpoch){beatPending=false;scheduleBeat();}
  }
}
function startPresence(result,fresh=false){
  if(!token||typeof result.session_id!=="string")return; // compatible with pre-update API
  if(sessionId===result.session_id){checkDeadline();return;}
  const sid=result.session_id,now=Date.now(),serverTime=Date.parse(result.last_activity_at||"");
  const saved=readTab(IDLE_SESSION_KEY)===sid?Number(readTab(IDLE_ACTIVITY_KEY)):0;
  sessionId=sid;ending=false;
  const validSaved=saved>0&&saved<=now?saved:0;
  lastActivity=fresh?now:Math.max(validSaved,Number.isFinite(serverTime)?Math.min(now,serverTime):0);
  // Existing pre-rollout sessions are enrolled on first verified navigation.
  if(!lastActivity)lastActivity=now;
  latestActivity();persistActivity();
  checkDeadline();
  if(token&&sessionId)scheduleBeat(fresh?BEAT_MS:0);
  // Remove only obsolete, non-secret timestamp keys; never retain activity history.
  try{for(let i=localStorage.length-1;i>=0;i--){
    const k=localStorage.key(i);
    if(k&&k.startsWith(IDLE_PREFIX)&&k!==activityKey()&&k!==beatKey()&&now-Number(localStorage.getItem(k))>9*3600000)localStorage.removeItem(k);
  }}catch{}
}
function onActivity(e){
  if(!e.isTrusted||!token||!sessionId||ending||forcedEnd)return;
  const now=Date.now();
  // Avoid synchronously reading storage for every mouse move.
  if(now-lastPersist<1000){lastActivity=Math.max(lastActivity,now);return;}
  if(readLocal(activityKey())==="0"||now-latestActivity()>=IDLE_MS){expireIdle();return;}
  lastActivity=now;
  persistActivity();
}
for(const name of ["pointerdown","pointermove","keydown","wheel","touchstart"]){
  document.addEventListener(name,onActivity,{capture:true,passive:true});
}
window.addEventListener("storage",e=>{
  if(!sessionId||e.key!==activityKey())return;
  if(e.newValue==="0"&&token){forcedEnd=true;expireIdle();return;}
  latestActivity();checkDeadline();
});
document.addEventListener("visibilitychange",()=>{if(!document.hidden&&token&&sessionId){checkDeadline();void sendPresence();}});
window.addEventListener("pageshow",()=>{if(token&&sessionId){checkDeadline();void sendPresence();}});

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
  const currentToken=token,epoch=sessionEpoch;
  let response;
  // Only timeout idempotent reads. Aborting an import commit could make a
  // successful server transaction look like a failed upload to the operator.
  const readOnly = kind==="auth" && ["me","presence","presence_users"].includes(action) ||
    kind==="store" && ["store_get","store_get_batch","store_list","store_counts"].includes(action);
  const controller=readOnly ? new AbortController() : null;
  let timeoutId=null;
  if(controller) timeoutId=setTimeout(()=>controller.abort(),30000);
  try{
    response=await fetch(ENDPOINT+(kind==="auth"?"she-v24-auth":"she-v24-store"),{
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        ...(token?{Authorization:"Bearer "+token}:{})
      },
      credentials:"omit",cache:"no-store",body:JSON.stringify({action,...data}),
      ...(controller?{signal:controller.signal}:{})
    });
  }catch{
    if(controller?.signal.aborted)
      throw failure("서버 조회가 30초를 초과해 중단됐습니다. 서버 데이터는 변경되지 않았습니다. 새로고침 후 다시 시도하세요.",504);
    throw failure("인증 서버와 연결할 수 없습니다. 네트워크를 확인하세요.",503);
  }finally{
    if(timeoutId!==null)clearTimeout(timeoutId);
  }
  let value;
  try{value=await response.json();}
  catch{throw failure("서버 응답 형식이 올바르지 않습니다.",503);}
  if(!response.ok){
    if(response.status===401&&action!=="login"&&currentToken===token&&epoch===sessionEpoch){
      if(sessionId&&/세션이 만료/.test(String(value.error||""))){
        // Expired server session: lock immediately after in-flight writes settle.
        forcedEnd=true;
        if(activityKey())writeLocal(activityKey(),0);
        if(busyWrites){clearTimeout(deadlineTimer);deadlineTimer=setTimeout(checkDeadline,1000);}
        else expireIdle();
      }else reset();
    }
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
  stopPresence();
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
      startPresence(res);
      if(!token)throw failure("로그인 세션이 만료되었습니다.",401);
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
  const result=await request("auth","login",{login_id,password,presence_v1:true});
  if(!result.token||result.account?.status!=="approved")
    throw failure("로그인 세션을 발급받지 못했습니다.",403);
  setToken(result.token);
  profile=normalize(result.account);
  startPresence(result,true);
  verifiedAt=Date.now();
  clearLegacy();
  return profile;
}
async function register(login_id,password,display_name,department){
  return request("auth","register",{login_id,password,display_name,department});
}
async function logout(){
  const key=activityKey();
  try{if(token)await request("auth","logout");}
  finally{if(key)writeLocal(key,0);reset();}
}
async function connectedUsers(){
  if(profile?.role!=="super_admin"||!token)throw failure("최고관리자 권한이 필요합니다.",403);
  const result=await request("auth","presence_users");
  return Array.isArray(result.connected)?result.connected:[];
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
// Risk workbook uploads are staged in small authenticated parts and committed
// atomically by the server. The existing client snapshot is never mutated on a
// failed upload; server-side CAS prevents stale-tab overwrites.
async function importSafetyDocument(opts,onProgress){
  await refresh(true);
  if(!permitted(profile,"safety",true))
    throw failure("위험성평가 수정 권한이 없습니다.",403);
  if(!opts||!Array.isArray(opts.items)||opts.items.length<1)
    throw failure("업로드할 위험성평가 항목이 없습니다.",400);
  const base=await fetchRow("main_v10_meta");
  if(!base||!base.updated_at)throw failure("서버 기준 버전을 확인하지 못했습니다.",409);
  const uploadId=crypto.randomUUID();
  const epoch=sessionEpoch,session=token;
  const chunkSize=160,partCount=Math.ceil(opts.items.length/chunkSize);
  if(partCount>100)throw failure("한 번에 등록할 수 있는 최대 항목 수를 초과했습니다.",413);
  for(let part=0;part<partCount;part++){
    if(epoch!==sessionEpoch||session!==token)
      throw failure("로그인 세션이 변경되어 업로드를 중단했습니다.",401);
    const items=opts.items.slice(part*chunkSize,(part+1)*chunkSize);
    await request("store","safety_import_part",{
      upload_id:uploadId,part_index:part,part_count:partCount,
      base_meta_updated_at:base.updated_at,
      import_mode:opts.mode,target_doc_id:opts.targetDocId||null,
      document:opts.document,items
    });
    if(typeof onProgress==="function")onProgress(part+1,partCount);
  }
  if(epoch!==sessionEpoch||session!==token)
    throw failure("로그인 세션이 변경되어 업로드를 중단했습니다.",401);
  const result=await request("store","safety_import_commit",{upload_id:uploadId});
  for(const key of [...fullRows.keys()]){
    if(/^main_v10_(meta|chunk_\d+)$/.test(key)){
      fullRows.delete(key);versions.delete(key);pendingRows.delete(key);
    }
  }
  pendingBatches.clear();
  return result;
}

// General edits use the same atomic staged protocol as workbook imports.
// Old bulk JSON upserts exceeded the gateway limit once a second workbook was added.
async function saveSafetySnapshot(opts,onProgress){
  await refresh(true);
  if(!permitted(profile,"safety",true))
    throw failure("위험성평가 저장 권한이 없습니다.",403);
  if(!opts||!Array.isArray(opts.items)||opts.items.length<1||
     !Array.isArray(opts.documents)||opts.documents.length<1)
    throw failure("비정상적인 빈 위험성평가 저장을 차단했습니다.",409);
  const base=await fetchRow("main_v10_meta");
  if(!base?.updated_at)throw failure("서버 최신 버전 확인에 실패했습니다.",409);
  if(!opts.expectedVersion || base.updated_at!==opts.expectedVersion)
    throw failure("서버에 새 개정이 등록된 뒤 오래된 화면에서 저장을 시도했습니다. 기존 자료를 덮어쓰지 않고 차단했습니다. 자료를 새로고침하세요.",409);
  const uploadId=crypto.randomUUID(),chunkSize=160;
  const partCount=Math.ceil(opts.items.length/chunkSize);
  if(partCount>100)throw failure("저장할 항목 수가 안전 한도를 초과했습니다.",413);
  const epoch=sessionEpoch,session=token;
  for(let part=0;part<partCount;part++){
    if(epoch!==sessionEpoch||session!==token)
      throw failure("로그인 세션이 변경되어 저장을 중단했습니다.",401);
    await request("store","safety_import_part",{
      upload_id:uploadId,part_index:part,part_count:partCount,
      base_meta_updated_at:base.updated_at,
      import_mode:"snapshot",target_doc_id:null,
      document:{documents:opts.documents},
      items:opts.items.slice(part*chunkSize,(part+1)*chunkSize)
    });
    if(typeof onProgress==="function")onProgress(part+1,partCount);
  }
  if(epoch!==sessionEpoch||session!==token)
    throw failure("로그인 세션이 변경되어 저장을 중단했습니다.",401);
  const result=await request("store","safety_snapshot_commit",{upload_id:uploadId});
  for(const key of [...fullRows.keys()]){
    if(/^main_v10_(meta|chunk_\d+)$/.test(key)){
      fullRows.delete(key);versions.delete(key);pendingRows.delete(key);
    }
  }
  pendingBatches.clear();
  return result;
}

// Destructive changes are authorized only through an explicit named-document
// transaction. The normal snapshot writer never gets a mass-loss bypass.
async function deleteSafetyDocument(documentId,expectedTitle){
  await refresh(true);
  if(!permitted(profile,"safety",true))
    throw failure("위험성평가 문서 삭제 권한이 없습니다.",403);
  if(typeof documentId!=="string"||typeof expectedTitle!=="string"||
     !documentId||!expectedTitle)
    throw failure("삭제할 문서 정보가 올바르지 않습니다.",400);
  // Always get the latest metadata. The server still CAS-checks this
  // version against the real row at deletion time.
  const meta=await fetchRow("main_v10_meta");
  if(!meta||!Array.isArray(meta.documents))
    throw failure("서버에서 문서 목록을 확인하지 못했습니다.",503);
  const target=meta.documents.find(d=>d?.id===documentId);
  if(!target||target.title!==expectedTitle)
    throw failure("선택한 문서가 서버의 최신 목록과 다릅니다. 새로고침하세요.",409);
  const result=await request("store","safety_document_delete",{
    document_id:documentId,
    expected_title:expectedTitle,
    expected_updated_at:meta.updated_at,
    confirm_delete:true
  });
  for(const key of [...fullRows.keys()]){
    if(/^main_v10_(meta|chunk_\d+)$/.test(key)){
      fullRows.delete(key);versions.delete(key);pendingRows.delete(key);
    }
  }
  pendingBatches.clear();
  return result;
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
    if(this.mode==="select")return this.executeOriginal();
    return protectWrite(()=>this.executeOriginal());
  }
  async executeOriginal(){
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
  rpc:(name,args)=>name==="she_confirm_education_v2"?protectWrite(()=>rpc(name,args)):rpc(name,args),channel
});
window.SHESEC=Object.freeze({
  client,refresh,guard,login,register,logout,users,connectedUsers,setUser,deleteUser,
  maintenance,registrationStatus,setRegistration,changePassword,
  importSafetyDocument:(...args)=>protectWrite(()=>importSafetyDocument(...args)),
  saveSafetySnapshot:(...args)=>protectWrite(()=>saveSafetySnapshot(...args)),
  deleteSafetyDocument:(...args)=>protectWrite(()=>deleteSafetyDocument(...args)),
  permit:(p,m)=>permitted(p,m,false),
  canWrite:(p,m)=>permitted(p,m,true),
  get profile(){return profile;},
  onReadyFor:async m=>(await guard(m,true)).ok
});
})();
