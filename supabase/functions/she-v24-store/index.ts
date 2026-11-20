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
    "Vary":"Origin"
  };
}
function send(req:Request,status:number,body:Record<string,unknown>) {
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
  if (scope==="safety") return true; // V24 safety_view for every approved account
  if (a.role!=="viewer_admin" && a.role!=="admin") return false;
  if (scope==="roster")return a.permissions?.roster===true || a.permissions?.education===true;
  return a.permissions?.[scope]===true;
}
function canWrite(a:Account,scope:Scope):boolean {
  if (scope==="users_admin") return false; // use she-v24-auth instead
  if (a.role==="super_admin")return true;
  return a.role==="admin" && EDIT_SCOPES.includes(scope as typeof EDIT_SCOPES[number]) &&
    a.permissions?.[scope]===true;
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
async function educationRoster(a:Account) {
  if (!canRead(a,"education"))throw new ApiError(403,"교육 연명부 조회 권한이 없습니다.");
  const {data:row,error}=await db.from("hanyang_safety_store")
    .select("items").eq("id","main_v1_roster_master").maybeSingle();
  if (error)throw new ApiError(503,"교육 연명부 조회 실패");
  if (!row || !Array.isArray(row.items))throw new ApiError(503,"교육 연명부가 없습니다.");
  const safe=new Set(["uid","workerNo","name","company","job","resignDate","samsungStartDate",
    "eduCommon","edu13ho","edu38ho","edu4ho","edu35ho","eduClosed",
    "eduMsds","edu2ho","eduCrane"]);
  return {workers:row.items.map((r:Record<string,unknown>)=>
    Object.fromEntries(Object.entries(r).filter(([k])=>safe.has(k))))};
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
  const {data,error}=await db.rpc("she_v24_cas_update_safety_batch",{
    p_rows:input.rows,p_actor:a.id
  });
  if(error)throw new ApiError(503,"안전 자료 일괄 저장에 실패했습니다.");
  if(data?.status==="conflict")throw new ApiError(409,"다른 사용자가 안전 자료를 먼저 수정했습니다. 다시 불러오세요.");
  if(data?.status==="not_found")throw new ApiError(404,"저장 대상 청크가 없습니다.");
  if(data?.status!=="ok")throw new ApiError(400,"일괄 저장 요청 형식 오류");
  return {status:"ok",rows:data.rows};
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
  return {status:"ok",id,updated_at:data.updated_at};
}
Deno.serve(async (req:Request)=>{
  if(req.method==="OPTIONS")return new Response(null,{
    status:req.headers.get("Origin")===ORIGIN?204:403,headers:headers(req)});
  if(req.method!=="POST")return send(req,405,{error:"POST 요청만 허용됩니다."});
  const origin=req.headers.get("Origin");
  if(origin && origin!==ORIGIN)return send(req,403,{error:"허용되지 않은 출처입니다."});
  try {
    const raw=await req.text();
    if(enc.encode(raw).length>MAX_BODY_BYTES)throw new ApiError(413,"요청 크기를 초과했습니다.");
    let input:Record<string,unknown>;
    try {input=JSON.parse(raw);} catch{throw new ApiError(400,"JSON 형식 오류");}
    if (!input || typeof input!=="object" || Array.isArray(input))
      throw new ApiError(400,"요청 형식 오류");
    const a=await authenticate(req);
    switch(input.action){
      case "store_list":return send(req,200,await listRows(a));
      case "store_get":return send(req,200,await getRow(a,input,false));
      case "store_counts":return send(req,200,await getRow(a,input,true));
      case "store_put":return send(req,200,await putRow(a,input));
      case "store_put_batch":return send(req,200,await putSafetyBatch(a,input));
      case "store_education_roster":return send(req,200,await educationRoster(a));
      case "store_confirm_education":return send(req,200,await confirmEducation(a,input));
      default:throw new ApiError(400,"지원하지 않는 요청입니다.");
    }
  }catch(error){
    if (error instanceof ApiError)return send(req,error.status,{error:error.message});
    console.error("V24 store internal failure",error instanceof Error ? error.name:"unknown");
    return send(req,500,{error:"업무 데이터 서버 오류"});
  }
});
