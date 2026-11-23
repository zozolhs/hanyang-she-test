// HANYANG SHE V24 TEST — integrated store gateway.
// Every operation checks a freshly resolved opaque V24 session and an exact record scope.
// Server-only Supabase service credential. Never expose it to the browser.
// All existing V23 RLS policies remain intact and are not bypassed by browser clients.
import { createClient } from "npm:@supabase/supabase-js@2";

const ORIGIN = Deno.env.get("SHE_V24_ALLOWED_ORIGIN") || "https://zozolhs.github.io";
const URL = Deno.env.get("SUPABASE_URL");
const SECRET = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!URL || !SECRET) throw new Error("Missing server credentials");
const db = createClient(URL, SECRET, {auth:{persistSession:false,autoRefreshToken:false}});
const enc = new TextEncoder();
const MAX_BODY_BYTES = 1_500_000;
const EDIT_SCOPES = ["safety","roster","education","health"] as const;
type Scope = "safety" | "roster" | "education" | "health" | "users_admin";
type Account = {id:string; role:string; status:string; permissions:Record<string, boolean> | null;};
class ApiError extends Error {constructor(public status:number,message:string){super(message);}}
function headers(req:Request):HeadersInit {
  const origin=req.headers.get("Origin");
  return {
    ...(origin === ORIGIN ? {"Access-Control-Allow-Origin":origin}:{}),
    "Access-Control-Allow-Headers":"authorization,content-type",
    "Access-Control-Allow-Methods":"POST,OPTIONS",
    "Content-Type":"application/json; charset=utf-8",
    "Cache-Control":"no-store",
    "X-Content-Type-Options":"nosniff",
    "Referrer-Policy":"no-referrer",
    "X-Frame-Options":"DENY",
    "Content-Security-Policy":"default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    "Vary":"Origin"
  };
}
function send(req:Request,status:number,body:Record<string,unknown>) {
  // Sample suspicious traffic without persisting tokens or request data.
  // Normal authorized workbook uploads/downloads are never rate-limited here.
  if(status===413||status===429||
     ([400,401,403,405].includes(status)&&Math.random()<0.05)) {
    console.warn("SHE_V24_SECURITY",JSON.stringify({
      service:"store",event:"request_rejected",code:status,method:req.method,
      has_origin:req.headers.has("Origin")
    }));
  }
  return new Response(JSON.stringify(body), {status,headers:headers(req)});
}
async function hashToken(raw:string):Promise<string> {
  const bytes=new Uint8Array(await crypto.subtle.digest("SHA-256",enc.encode(raw)));
  return Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");
}
async function authenticate(req:Request):Promise<Account> {
  const bearer = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.get("Authorization")||"");
  if (!bearer) throw new ApiError(401,"로그인이 필요합니다.");
  const digest=await hashToken(bearer[1]);
  const {data:session,error:se}=await db.from("she_v24_sessions")
    .select("account_id,expires_at,revoked_at").eq("refresh_hash",digest).maybeSingle();
  if (se) throw new ApiError(503,"세션 검증을 할 수 없습니다.");
  if (!session || session.revoked_at || !Number.isFinite(Date.parse(session.expires_at)) ||
      Date.parse(session.expires_at)<=Date.now())
    throw new ApiError(401,"로그인 세션이 만료되었습니다.");

  const {data:account,error:ae}=await db.from("she_v24_accounts")
    .select("id,role,status,permissions").eq("id",session.account_id).maybeSingle();
  if (ae) throw new ApiError(503,"계정 검증을 할 수 없습니다.");
  if (!account || account.status!=="approved")
    throw new ApiError(403,"승인되지 않은 계정입니다.");

  const {data:settings,error:me}=await db.from("she_settings")
    .select("maintenance_mode").limit(100);
  if (me) throw new ApiError(503,"점검 상태를 확인할 수 없습니다.");
  if (settings?.some(s=>s.maintenance_mode === true) && account.role!=="super_admin")
    throw new ApiError(503,"시스템 점검 중입니다.");
  return account as Account;
}
function scopeOf(id:string):Scope|null {
  if (id === "main_v10_meta" || /^main_v10_chunk_(0|[1-9][0-9]{0,3})$/.test(id))return "safety";
  if (id === "main_v1_roster_master") return "roster";
  if (id === "main_v1_edu_schedule") return "education";
  if (/^main_v1_health(?:_[a-z0-9_-]{1,48})?$/.test(id)) return "health";
  if (id === "main_v12_users_master") return "users_admin";
  return null;
}
function canRead(a:Account,scope:Scope):boolean {
  if (a.role==="super_admin") return true;
  if (scope==="users_admin") return false;
  // Existing worker SAFETY search stays readable; admin/viewer SAFETY is selectable.
  if (scope==="safety" && a.role==="worker") return true;
  if (a.role!=="viewer_admin" && a.role!=="admin") return false;
  // Education schedules need a minimal redacted roster, not full ROSTER access.
  if (scope==="roster") return a.permissions?.roster===true || a.permissions?.education===true;
  return a.permissions?.[scope]===true;
}
function canWrite(a:Account,scope:Scope):boolean {
  if (scope==="users_admin") return false; // use she-v24-auth instead
  if (a.role==="super_admin")return true;
  return a.role==="admin" && EDIT_SCOPES.includes(scope as typeof EDIT_SCOPES[number]) &&
    a.permissions?.[scope]===true && a.permissions?.[scope+"_write"]===true;
}
function requireId(value:unknown):{id:string;scope:Scope} {
  if (typeof value!=="string" || value.length>80) throw new ApiError(400,"데이터 ID 형식 오류");
  const scope=scopeOf(value);
  if (!scope)throw new ApiError(403,"허용된 업무 데이터가 아닙니다.");
  return {id:value,scope};
}
function educationRosterView(row:Record<string,unknown>) {
  const safe = new Set(["uid","workerNo","name","company","job","process","educationType",
    "edu2ho","edu4ho","edu13ho","edu35ho","edu38ho","eduMsds","eduCrane",
    "eduClosed","eduCommon","eduRegular"]);
  const items=(row.items as Record<string,unknown>[]).map(item=>
    Object.fromEntries(Object.entries(item).filter(([key])=>safe.has(key))));
  return {
    id:row.id, updated_at:row.updated_at, documents:[],
    items, users:[], redacted_for_education:true
  };
}
async function educationRoster(a:Account,input:Record<string,unknown>={}) {
  if (!canRead(a,"education"))throw new ApiError(403,"교육 연명부 조회 권한이 없습니다.");
  // Check only the version on repeat polls. Permissions are checked above on every call.
  const {data:revision,error:revisionError}=await db.from("hanyang_safety_store")
    .select("updated_at").eq("id","main_v1_roster_master").maybeSingle();
  if (revisionError)throw new ApiError(503,"교육 연명부 버전 확인 실패");
  if (!revision)throw new ApiError(503,"교육 연명부가 없습니다.");
  if (typeof input.if_updated_at==="string" && input.if_updated_at.length<=64 &&
      input.if_updated_at===revision.updated_at)
    return {not_modified:true,updated_at:revision.updated_at};
  const {data:row,error}=await db.from("hanyang_safety_store")
    .select("items,updated_at").eq("id","main_v1_roster_master").maybeSingle();
  if (error)throw new ApiError(503,"교육 연명부 조회 실패");
  if (!row || !Array.isArray(row.items))throw new ApiError(503,"교육 연명부가 없습니다.");
  const safe=new Set(["uid","workerNo","name","company","job","resignDate","samsungStartDate",
    "eduCommon","edu13ho","edu38ho","edu4ho","edu35ho","eduClosed",
    "eduMsds","edu2ho","eduCrane"]);
  return {workers:row.items.map((r:Record<string,unknown>)=>
    Object.fromEntries(Object.entries(r).filter(([k])=>safe.has(k)))),
    updated_at:row.updated_at};
}
async function confirmEducation(a:Account,input:Record<string,unknown>) {
  if (!canWrite(a,"education"))throw new ApiError(403,"교육 확정 권한이 없습니다.");
  const id=input.event_id,expected=input.expected_updated_at,attendance=input.attendance;
  if(typeof id!=="string"||id.length<1||id.length>150||
     typeof expected!=="string"||expected.length>60||!Number.isFinite(Date.parse(expected))||
     !attendance||typeof attendance!=="object"||Array.isArray(attendance)||
     Object.keys(attendance).length>1000)
    throw new ApiError(400,"교육 확정 요청 형식 오류");
  const {data,error}=await db.rpc("she_v24_confirm_education",{
    p_event_id:id,p_expected_updated_at:expected,
    p_actor:a.id,p_attendance:attendance
  });
  if(error)throw new ApiError(409,"교육 확정 실패: 일정 또는 대상자의 최신 상태를 확인하세요.");
  return data as Record<string,unknown>;
}
async function putSafetyBatch(a:Account,input:Record<string,unknown>) {
  if(!canWrite(a,"safety"))throw new ApiError(403,"안전 자료 수정 권한이 없습니다.");
  if(!Array.isArray(input.rows)||input.rows.length<1||input.rows.length>20)
    throw new ApiError(400,"일괄 저장 건수 오류");
  const seen=new Set<string>();
  for(const row of input.rows){
    if(!row||typeof row!=="object"||Array.isArray(row))throw new ApiError(400,"저장 형식 오류");
    const r=row as Record<string,unknown>, {id,scope}=requireId(r.id);
    if(scope!=="safety"||seen.has(id)||typeof r.expected_updated_at!=="string"||
       !Number.isFinite(Date.parse(r.expected_updated_at))||
       !Array.isArray(r.documents)||!Array.isArray(r.items)||!Array.isArray(r.users)||
       r.documents.length>2000||r.items.length>5000||r.users.length>2000)
      throw new ApiError(400,"일괄 저장 항목이 유효하지 않습니다.");
    seen.add(id);
  }
  // Fail closed on a stale browser state or an accidental mass deletion.
  // Use the authoritative server metadata. The existing CAS RPC additionally
  // ensures no concurrent writer can overwrite a newer version.
  const incomingMeta = (input.rows as Record<string,unknown>[])
    .find(r=>r.id==="main_v10_meta");
  if(!incomingMeta)throw new ApiError(409,"안전 자료 메타정보가 빠져 저장을 차단했습니다.");
  const incomingDocs=incomingMeta.documents as Record<string,unknown>[];
  const incomingItems=incomingMeta.items as Record<string,unknown>[];
  const nextTotal=Number(incomingItems[0]?.totalItems);
  const nextChunks=Number(incomingItems[0]?.chunkCount);
  const chunkRows=(input.rows as Record<string,unknown>[])
    .filter(r=>typeof r.id==="string"&&/^main_v10_chunk_[0-9]+$/.test(r.id));
  const submittedTotal=chunkRows.reduce((n,r)=>n+(r.items as unknown[]).length,0);
  if(!Number.isSafeInteger(nextTotal)||nextTotal<0||
     !Number.isSafeInteger(nextChunks)||nextChunks<0||
     submittedTotal!==nextTotal||nextChunks>chunkRows.length)
    throw new ApiError(409,"일괄 저장 항목 수가 일치하지 않아 저장을 차단했습니다.");
  const {data:currentMeta,error:currentMetaError}=await db
    .from("hanyang_safety_store").select("documents,items")
    .eq("id","main_v10_meta").maybeSingle();
  if(currentMetaError||!currentMeta)
    throw new ApiError(503,"현재 위험성평가 자료를 확인하지 못해 저장을 차단했습니다.");
  const oldDocs=Array.isArray(currentMeta.documents)?currentMeta.documents:[];
  const oldTotal=Number(currentMeta.items?.[0]?.totalItems||0);
  const nextDocIds=new Set(incomingDocs.map(d=>String(d?.id||"")).filter(Boolean));
  const missingOldDocs=oldDocs.some((d:Record<string,unknown>)=>
    typeof d?.id==="string"&&!nextDocIds.has(d.id));
  if((oldDocs.length>0&&incomingDocs.length===0)||
     missingOldDocs||
     (oldTotal>=100&&nextTotal<oldTotal*0.8)){
    console.warn("SHE_V24_DATA_GUARD",JSON.stringify({
      event:"blocked_safety_mass_deletion",oldTotal,nextTotal,
      oldDocumentCount:oldDocs.length,newDocumentCount:incomingDocs.length
    }));
    throw new ApiError(409,"위험성평가 문서 또는 항목의 대량 감소가 감지되어 서버 저장을 차단했습니다.");
  }
  const {data,error}=await db.rpc("she_v24_cas_update_safety_batch",{
    p_rows:input.rows,p_actor:a.id
  });
  if(error)throw new ApiError(503,"안전 자료 일괄 저장에 실패했습니다.");
  if(data?.status==="conflict")throw new ApiError(409,"다른 사용자가 안전 자료를 먼저 수정했습니다. 다시 불러오세요.");
  if(data?.status==="not_found")throw new ApiError(404,"저장 대상 청크가 없습니다.");
  if(data?.status!=="ok")throw new ApiError(400,"일괄 저장 요청 형식 오류");
  return {status:"ok",rows:data.rows};
}

async function safetyImportPart(a:Account,input:Record<string,unknown>){
  if(!canWrite(a,"safety"))throw new ApiError(403,"위험성평가 업로드 권한이 없습니다.");
  const uploadId=input.upload_id,partIndex=input.part_index,partCount=input.part_count;
  const expected=input.base_meta_updated_at,mode=input.import_mode,doc=input.document;
  const targetId=input.target_doc_id;
  const items=input.items;
  if(typeof uploadId!=="string" ||
     !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uploadId) ||
     !Number.isInteger(partIndex)||Number(partIndex)<0||
     !Number.isInteger(partCount)||Number(partCount)<1||
     Number(partCount)>100||Number(partIndex)>=Number(partCount)||
     typeof expected!=="string"||!Number.isFinite(Date.parse(expected))||
     !["replace","append","new","snapshot"].includes(String(mode))||
     ((mode==="replace"||mode==="append")&&(typeof targetId!=="string"||targetId.length>120))||
     !doc||typeof doc!=="object"||Array.isArray(doc)||
     !Array.isArray(items)||items.length<1||items.length>350||
     items.some(v=>!v||typeof v!=="object"||Array.isArray(v)||
       typeof v.measureText!=="string"||v.measureText.length<1||
       v.measureText.length>10000)){
    throw new ApiError(400,"엑셀 분할 업로드 자료가 올바르지 않습니다.");
  }
  const {error}=await db.from("she_v24_safety_import_parts").upsert({
    actor_id:a.id,upload_id:uploadId,part_index:partIndex,part_count:partCount,
    base_meta_updated_at:expected,import_mode:mode,
    target_doc_id:(mode==="replace"||mode==="append")?targetId:null,
    document:doc,items:items
  },{onConflict:"actor_id,upload_id,part_index"});
  if(error)throw new ApiError(503,"위험성평가 분할 업로드를 저장하지 못했습니다.");
  return {status:"ok",part_index:partIndex,part_count:partCount};
}
async function safetyImportCommit(a:Account,input:Record<string,unknown>){
  if(!canWrite(a,"safety"))throw new ApiError(403,"위험성평가 업로드 권한이 없습니다.");
  const id=input.upload_id;
  if(typeof id!=="string"||! /^[0-9a-f-]{36}$/i.test(id))
    throw new ApiError(400,"업로드 요청 번호 형식 오류");
  const {data,error}=await db.rpc("she_v24_commit_safety_import",{
    p_actor:a.id,p_upload_id:id
  });
  if(error)throw new ApiError(503,"위험성평가 최종 저장에 실패했습니다.");
  if(data?.status==="conflict")throw new ApiError(409,"다른 사용자의 변경이 먼저 저장됐습니다. 자료를 새로고침한 후 다시 업로드하세요.");
  if(data?.status==="incomplete")throw new ApiError(409,"엑셀의 일부 분할 자료가 누락됐습니다. 기존 파일은 변경되지 않았습니다.");
  if(data?.status==="integrity")throw new ApiError(409,"서버의 기존 데이터 개수가 일치하지 않습니다. 안전 확인이 필요합니다.");
  if(data?.status==="mass_loss"||data?.status==="large_replacement")throw new ApiError(409,"기존 평가 항목의 대량 감소가 감지되어 덮어쓰기를 차단했습니다.");
  if(data?.status==="not_found")throw new ApiError(404,"선택한 문서를 찾지 못했습니다. 새로고침 후 다시 확인하세요.");
  if(data?.status!=="ok")throw new ApiError(400,"위험성평가 업로드 자료를 검증하지 못했습니다.");
  return data;
}

async function safetySnapshotCommit(a:Account,input:Record<string,unknown>){
  if(!canWrite(a,"safety"))throw new ApiError(403,"위험성평가 저장 권한이 없습니다.");
  const id=input.upload_id;
  if(typeof id!=="string"||!/^[0-9a-f-]{36}$/i.test(id))
    throw new ApiError(400,"저장 요청 번호 형식 오류");
  const {data,error}=await db.rpc("she_v24_commit_safety_snapshot",{
    p_actor:a.id,p_upload_id:id
  });
  if(error)throw new ApiError(503,"위험성평가 서버 저장에 실패했습니다.");
  if(data?.status==="conflict")throw new ApiError(409,"다른 사용자가 먼저 수정했습니다. 변경 사항이 저장되지 않았습니다.");
  if(data?.status==="incomplete")throw new ApiError(409,"서버 저장 항목 중 일부가 누락돼 기존 자료를 유지했습니다.");
  if(data?.status==="integrity")throw new ApiError(409,"기존 평가 자료 무결성에 문제가 있어 저장을 차단했습니다.");
  if(data?.status==="doc_loss"||data?.status==="mass_loss")
    throw new ApiError(409,"기존 문서 또는 평가 항목의 대량 삭제가 감지돼 저장을 차단했습니다.");
  if(data?.status!=="ok")throw new ApiError(400,"위험성평가 저장값을 검증할 수 없습니다.");
  return data;
}

// ONE-PAGE: isolated V24 SAFETY data; never writes the existing risk-document chunks.
function onepageRead(a:Account){if(!canRead(a,"safety"))throw new ApiError(403,"ONE-PAGE 조회 권한이 없습니다.");}
function onepageWrite(a:Account){if(!canWrite(a,"safety"))throw new ApiError(403,"ONE-PAGE 수정 권한이 없습니다.");}
function safeText(v:unknown,max:number,label:string):string{
  if(typeof v!=="string"||v.length>max)throw new ApiError(400,label+" 형식 오류");
  return v;
}
async function onepageGet(a:Account) {
  onepageRead(a);
  const {data,error}=await db.from("she_v24_onepage_state")
    .select("payload,updated_at").eq("id","main").maybeSingle();
  if(error)throw new ApiError(503,"ONE-PAGE 조회 실패");
  if(!data||!Array.isArray(data.payload?.rows))throw new ApiError(503,"ONE-PAGE 자료가 없습니다.");
  return {data:data.payload,updated_at:data.updated_at};
}
async function onepagePut(a:Account,input:Record<string,unknown>) {
  onepageWrite(a);
  const expected=safeText(input.expected_updated_at,64,"수정 기준 시각");
  if(!Number.isFinite(Date.parse(expected)))throw new ApiError(400,"수정 기준 시각 오류");
  const payload=input.data;
  if(!payload||typeof payload!=="object"||Array.isArray(payload)||
    !Array.isArray((payload as Record<string,unknown>).rows)||
    JSON.stringify(payload).length>1_100_000)throw new ApiError(400,"ONE-PAGE 저장 형식 또는 크기 오류");
  const {data,error}=await db.rpc("she_v24_onepage_cas",{
    p_actor:a.id,p_expected_at:expected,p_payload:payload
  });
  if(error)throw new ApiError(503,"ONE-PAGE 저장 실패");
  if(data?.status==="conflict")throw new ApiError(409,"다른 관리자가 먼저 수정했습니다. 변경사항을 별도로 보관하고 새로고침하세요.");
  if(data?.status!=="ok")throw new ApiError(400,"ONE-PAGE 저장 대상 오류");
  return {updated_at:data.updated_at,status:"ok"};
}
function photoInput(v:unknown, label:string, maxLen:number, required=true):string {
  if(!required&&typeof v==="undefined")return "";
  return safeText(v,maxLen,label);
}
function validateDataUrl(v:string,maxLength:number):string {
  if(v.length>maxLength||
    !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v))
    throw new ApiError(413,"허용하지 않는 사진 형식 또는 크기입니다.");
  return v;
}
async function onepagePhotoList(a:Account){
  onepageRead(a);
  const {data,error}=await db.from("she_v24_onepage_photos")
    .select("id,row_id,taken_at,caption,filename,width,height,thumbnail_data_url")
    .order("taken_at",{ascending:true}).limit(1000);
  if(error)throw new ApiError(503,"ONE-PAGE 사진 목록 조회 실패");
  return {photos:data||[]};
}
async function onepagePhotoGet(a:Account,input:Record<string,unknown>){
  onepageRead(a);
  const id=photoInput(input.id,"사진 ID",100);
  const {data,error}=await db.from("she_v24_onepage_photos")
    .select("id,row_id,taken_at,caption,filename,width,height,photo_data_url")
    .eq("id",id).maybeSingle();
  if(error)throw new ApiError(503,"ONE-PAGE 사진 조회 실패");
  if(!data)throw new ApiError(404,"사진을 찾을 수 없습니다.");
  return {photo:data};
}
async function onepagePhotoPut(a:Account,input:Record<string,unknown>){
  onepageWrite(a);
  const id=photoInput(input.id,"사진 ID",100);
  const rowId=photoInput(input.row_id,"평가 항목 ID",100);
  const filename=photoInput(input.filename||"","사진 파일명",200);
  const caption=photoInput(input.caption||"","사진 설명",1000);
  const dataUrl=validateDataUrl(photoInput(input.photo_data_url,"사진 파일",1150000),1150000);
  const thumbnail=validateDataUrl(photoInput(input.thumbnail_data_url,"사진 미리보기",65000),65000);
  const takenAt=input.taken_at;
  const width=input.width, height=input.height;
  if(!Number.isSafeInteger(takenAt)||Number(takenAt)<0||
     !Number.isInteger(width)||Number(width)<0||Number(width)>1600||
     !Number.isInteger(height)||Number(height)<0||Number(height)>1600)
    throw new ApiError(400,"사진 메타데이터 오류");
  const {data:state,error:stateError}=await db.from("she_v24_onepage_state")
    .select("payload").eq("id","main").maybeSingle();
  if(stateError)throw new ApiError(503,"ONE-PAGE 평가 항목 확인 실패");
  if(!state?.payload?.rows?.some((r:Record<string,unknown>)=>r.id===rowId))
    throw new ApiError(409,"평가 항목이 먼저 저장되어야 사진을 등록할 수 있습니다.");
  const ext=/^data:image\/(jpeg|png|webp)/.exec(dataUrl)?.[1];
  const {error}=await db.from("she_v24_onepage_photos").upsert({
    id,row_id:rowId,caption,filename,taken_at:takenAt,
    width,height,mime_type:"image/"+ext,
    photo_data_url:dataUrl,thumbnail_data_url:thumbnail,
    updated_at:new Date().toISOString()
  },{onConflict:"id"});
  if(error)throw new ApiError(503,"ONE-PAGE 사진 저장 실패");
  return {status:"ok",id};
}
async function onepagePhotoDelete(a:Account,input:Record<string,unknown>){
  onepageWrite(a);
  const id=photoInput(input.id,"사진 ID",100);
  const {error}=await db.from("she_v24_onepage_photos").delete().eq("id",id);
  if(error)throw new ApiError(503,"ONE-PAGE 사진 삭제 실패");
  return {status:"ok",id};
}
// A single authenticated read replaces repeated per-chunk API calls.
// Missing recovery chunks remain omitted, exactly as with individual 404s.
async function getBatch(a:Account,input:Record<string,unknown>) {
  const ids=input.ids;
  if(!Array.isArray(ids)||ids.length<1||ids.length>30 ||
     ids.some(id=>typeof id!=="string") || new Set(ids).size!==ids.length)
    throw new ApiError(400,"일괄 조회 자료 ID 오류");
  const checks=ids.map(id=>requireId(id));
  if(checks.some(({scope})=>!canRead(a,scope)))
    throw new ApiError(403,"일괄 조회 권한이 없습니다.");
  const {data,error}=await db.from("hanyang_safety_store")
    .select("id,documents,items,users,updated_at").in("id",ids);
  if(error)throw new ApiError(503,"일괄 자료 조회 실패");
  const rows=(data||[]).map(row=>{
    if(![row.documents,row.items,row.users].every(Array.isArray))
      throw new ApiError(503,"저장 자료 형식 오류");
    const scope=scopeOf(row.id);
    return scope==="roster" && a.role!=="super_admin" &&
      a.permissions?.roster!==true ? educationRosterView(row) : row;
  });
  // Do not include any privileged data unless every requested ID was authorized.
  return {rows};
}
async function listRows(a:Account) {
  const {data,error}=await db.from("hanyang_safety_store").select("id,updated_at").order("id");
  if (error)throw new ApiError(503,"업무 목록 조회 실패");
  return {rows:(data||[]).filter(row=>{
    const scope=scopeOf(row.id);
    return scope!==null && canRead(a,scope);
  }).map(row=>({...row,scope:scopeOf(row.id)}))};
}
async function getRow(a:Account,input:Record<string,unknown>,counts=false) {
  const {id,scope}=requireId(input.id);
  if (!canRead(a,scope))throw new ApiError(403,"해당 데이터 조회 권한이 없습니다.");
  // A cached row may be reused ONLY after checking its current server revision
  // AND its data representation. Prevent a downgraded roster viewer from
  // reusing an older, unredacted roster cache.
  const view=scope==="roster" && a.role!=="super_admin" &&
    a.permissions?.roster!==true ? "education_redacted" : "full";
  if(!counts && typeof input.if_updated_at==="string" &&
     input.if_updated_at.length<=64 && input.if_view===view){
    const {data:revision,error:versionError}=await db.from("hanyang_safety_store")
      .select("updated_at").eq("id",id).maybeSingle();
    if(versionError)throw new ApiError(503,"업무 버전 확인 실패");
    if(revision && revision.updated_at===input.if_updated_at)
      return {not_modified:true,id,updated_at:revision.updated_at,view};
  }
  const {data:row,error}=await db.from("hanyang_safety_store")
    .select("id,documents,items,users,updated_at").eq("id",id).maybeSingle();
  if (error)throw new ApiError(503,"업무 데이터 조회 실패");
  if (!row)throw new ApiError(404,"해당 업무 데이터가 없습니다.");
  if (![row.documents,row.items,row.users].every(Array.isArray))
    throw new ApiError(503,"저장 데이터 형식 오류");
  // The education permission alone can read the roster, but must not get
  // its birth dates, phone numbers, blood type, employee IDs or notes.
  const scoped=scope==="roster" && a.role!=="super_admin" &&
    a.permissions?.roster!==true ? educationRosterView(row) : row;
  if (!counts && (scope==="roster"||scope==="health"))
    console.info("SHE_V24_AUDIT",JSON.stringify({
      event:"sensitive_data_read",scope,account_id:a.id
    }));
  if (counts)return {
    id:scoped.id, scope, updated_at:scoped.updated_at,
    documents_count:scoped.documents.length,
    items_count:scoped.items.length,
    users_count:scoped.users.length,
    redacted_for_education:scoped.redacted_for_education===true
  };
  return {row:scoped};
}
async function putRow(a:Account,input:Record<string,unknown>) {
  const {id,scope}=requireId(input.id);
  if (!canWrite(a,scope))throw new ApiError(403,"해당 데이터의 수정 권한이 없습니다.");
  // Safety metadata and chunks must be written together via validated CAS batch.
  if(scope==="safety")throw new ApiError(409,"안전 자료는 전체 검증된 일괄 저장만 허용됩니다.");
  const expected=input.expected_updated_at;
  const docs=input.documents, items=input.items, users=input.users;
  if (typeof expected!=="string" || expected.length>60 ||
      !Number.isFinite(Date.parse(expected)) ||
      !Array.isArray(docs) || !Array.isArray(items) || !Array.isArray(users) ||
      docs.length>2000 || items.length>10000 || users.length>2000)
    throw new ApiError(400,"저장 데이터 형식 오류");
  // Atomic compare-and-swap and old-row rollback history are enforced by the
  // service-only PostgreSQL function installed for the V24 TEST project.
  const {data,error}=await db.rpc("she_v24_cas_update_store",{
    p_id:id, p_expected_updated_at:expected,
    p_documents:docs, p_items:items, p_users:users, p_actor:a.id
  });
  if(error)throw new ApiError(503,"데이터 저장 실패");
  if (data?.status==="conflict")throw new ApiError(409,"다른 사용자가 먼저 수정했습니다. 다시 불러온 뒤 저장하세요.");
  if (data?.status==="not_found")throw new ApiError(404,"저장할 데이터가 없습니다.");
  if (data?.status!=="ok")throw new ApiError(400,"데이터 저장 요청이 유효하지 않습니다.");
  if(scope==="roster"||scope==="health")console.info("SHE_V24_AUDIT",JSON.stringify({
    event:"sensitive_data_write",scope,account_id:a.id
  }));
  return {status:"ok",id,updated_at:data.updated_at};
}
Deno.serve(async (req:Request)=>{
  if(req.method==="OPTIONS")return new Response(null,{
    status:req.headers.get("Origin")===ORIGIN?204:403,headers:headers(req)});
  if(req.method!=="POST")return send(req,405,{error:"POST 요청만 허용됩니다."});
  const origin=req.headers.get("Origin");
  if(origin && origin!==ORIGIN)return send(req,403,{error:"허용되지 않은 출처입니다."});
  try {
    const lengthHeader=req.headers.get("Content-Length");
    if(lengthHeader && /^\d+$/.test(lengthHeader) && Number(lengthHeader)>MAX_BODY_BYTES)
      throw new ApiError(413,"요청 크기를 초과했습니다.");
    // Validate the session BEFORE parsing potentially large workbook-save JSON.
    // Authorized requests retain the original 1.5 MB body allowance.
    const a=await authenticate(req);
    const raw=await req.text();
    if(enc.encode(raw).length>MAX_BODY_BYTES)throw new ApiError(413,"요청 크기를 초과했습니다.");
    let input:Record<string,unknown>;
    try {input=JSON.parse(raw);} catch{throw new ApiError(400,"JSON 형식 오류");}
    if (!input || typeof input!=="object" || Array.isArray(input))
      throw new ApiError(400,"요청 형식 오류");
    switch(input.action){
      case "store_list":return send(req,200,await listRows(a));
      case "store_get":return send(req,200,await getRow(a,input,false));
      case "store_get_batch":return send(req,200,await getBatch(a,input));
      case "store_counts":return send(req,200,await getRow(a,input,true));
      case "store_put":return send(req,200,await putRow(a,input));
      case "store_put_batch":return send(req,200,await putSafetyBatch(a,input));
      case "safety_import_part":return send(req,200,await safetyImportPart(a,input));
      case "safety_import_commit":return send(req,200,await safetyImportCommit(a,input));
      case "safety_snapshot_commit":return send(req,200,await safetySnapshotCommit(a,input));
      case "store_education_roster":return send(req,200,await educationRoster(a,input));
      case "store_confirm_education":return send(req,200,await confirmEducation(a,input));
      case "onepage_get":return send(req,200,await onepageGet(a));
      case "onepage_put":return send(req,200,await onepagePut(a,input));
      case "onepage_photo_list":return send(req,200,await onepagePhotoList(a));
      case "onepage_photo_get":return send(req,200,await onepagePhotoGet(a,input));
      case "onepage_photo_put":return send(req,200,await onepagePhotoPut(a,input));
      case "onepage_photo_delete":return send(req,200,await onepagePhotoDelete(a,input));
      default:throw new ApiError(400,"지원하지 않는 요청입니다.");
    }
  }catch(error){
    if (error instanceof ApiError)return send(req,error.status,{error:error.message});
    console.error("V24 store internal failure",error instanceof Error ? error.name:"unknown");
    return send(req,500,{error:"업무 데이터 서버 오류"});
  }
});
