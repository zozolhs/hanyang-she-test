import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import vm from "node:vm";

// Offline simulation only: no production credentials, server mutations, or load.
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const bridge=readFileSync(resolve(root,"she-v24-index.js"),"utf8");
const storeSource=readFileSync(resolve(root,"supabase/functions/she-v24-store/index.ts"),"utf8");
const dashboard=readFileSync(resolve(root,"dashboard.html"),"utf8");
const ISO="2026-11-21T09:00:00.000Z";
let requests=[];
let rows=new Map([
 ["main_v10_chunk_0",{id:"main_v10_chunk_0",documents:[],items:[{id:"a"}],users:[],updated_at:ISO}],
 ["main_v10_chunk_1",{id:"main_v10_chunk_1",documents:[],items:[{id:"b"}],users:[],updated_at:ISO}],
 ["main_v1_roster_master",{id:"main_v1_roster_master",documents:[],items:[{name:"test"}],users:[],updated_at:ISO}]
]);
const token="q".repeat(43);
const json=(payload,status=200)=>({ok:status>=200&&status<300,status,
  json:async()=>payload});
let persona={role:"admin",permissions:{roster:true,education:true,safety:true}};
let educationVersion=ISO;
const fetch=async(_url,opts)=>{
  const input=JSON.parse(opts.body); requests.push({action:input.action,body:input,auth:opts.headers.Authorization||null});
  // Simulate async request crossing a microtask boundary for coalescing checks.
  await Promise.resolve();
  if(input.action==="login")
    return json({token,account:{id:"test-user",role:persona.role,status:"approved",permissions:persona.permissions}});
  if(input.action==="logout")return json({message:"OK"});
  if(input.action==="store_get"){
    const row=rows.get(input.id);if(!row)return json({error:"missing"},404);
    const view=input.id==="main_v1_roster_master" && !persona.permissions.roster?"education_redacted":"full";
    if(input.if_updated_at===row.updated_at&&input.if_view===view)
      return json({not_modified:true,id:input.id,updated_at:row.updated_at,view});
    return json({row:view==="education_redacted" ? {...row,documents:[],users:[],
      items:row.items.map(x=>({name:x.name})),redacted_for_education:true}:row});
  }
  if(input.action==="store_get_batch"){
    return json({rows:input.ids.map(id=>rows.get(id)).filter(Boolean)});
  }
  if(input.action==="store_education_roster"){
    if(input.if_updated_at===educationVersion)
      return json({not_modified:true,updated_at:educationVersion});
    return json({workers:[{name:"test"}],updated_at:educationVersion});
  }
  if(input.action==="store_put"){
    const current=rows.get(input.id);
    assert.equal(input.expected_updated_at,current.updated_at,"CAS expected version retained");
    const updated={...current,items:input.items||current.items,updated_at:"2026-11-21T09:00:02.000Z"};
    rows.set(input.id,updated);
    return json({updated_at:updated.updated_at});
  }
  return json({error:"unexpected action "+input.action},400);
};
const state=new Map();
const sessionStorage={
  getItem:key=>state.get(key)||null,
  setItem:(key,value)=>state.set(key,value),
  removeItem:key=>state.delete(key),
};
const window={};
const context=vm.createContext({window,sessionStorage,fetch,document:{dispatchEvent(){}},
  CustomEvent:class CustomEvent{constructor(name,init){this.name=name;this.detail=init?.detail;}},console,Map,Set,Date,Promise});
vm.runInContext(bridge,context,{filename:"she-v24-index.js"});
const she=window.SHESEC;
assert.ok(she,"compatibility bridge mounted");
let passed=0;
async function test(name,fn){try{await fn();passed++;console.log("PASS",name)}
catch(e){console.error("FAIL",name,e);process.exitCode=1;}}

await she.login("operator","not-a-real-password");
await test("Concurrent same-row fetches coalesce to one API call",async()=>{
 requests=[];
 const [one,two]=await Promise.all([
  she.client.from("hanyang_safety_store").select("*").eq("id","main_v10_chunk_0").maybeSingle(),
  she.client.from("hanyang_safety_store").select("*").eq("id","main_v10_chunk_0").maybeSingle()
 ]);
 assert.equal(requests.filter(r=>r.action==="store_get").length,1);
 assert.equal(one.data.items[0].id,"a");
 assert.equal(two.data.items[0].id,"a");
});
await test("Repeat read requests only revision and reuses tab-local row",async()=>{
 requests=[];
 const result=await she.client.from("hanyang_safety_store").select("*").eq("id","main_v10_chunk_0").maybeSingle();
 assert.equal(requests.length,1);
 assert.equal(requests[0].body.if_updated_at,ISO);
 assert.equal(result.data.items[0].id,"a");
});
await test("Ten risk chunks are fetched using one API request and missing IDs omitted",async()=>{
 requests=[];
 const ids=Array.from({length:10},(_,i)=>"main_v10_chunk_"+i);
 const result=await she.client.from("hanyang_safety_store").select("id,items").in("id",ids).then(x=>x);
 assert.equal(requests.filter(r=>r.action==="store_get_batch").length,1);
 assert.equal(requests.filter(r=>r.action==="store_get").length,0);
 assert.deepEqual(Array.from(result.data,x=>x.id),["main_v10_chunk_0","main_v10_chunk_1"]);
});
await test("Education roster polls return lightweight not_modified response",async()=>{
 requests=[];
 const first=await she.client.rpc("she_education_roster_v2");
 const second=await she.client.rpc("she_education_roster_v2");
 assert.equal(first.data.length,1);
 assert.equal(first.not_modified,false);
 assert.equal(second.not_modified,true);
 assert.equal(requests[1].body.if_updated_at,ISO);
});
await test("Successful write updates cache and preserves old CAS workflow",async()=>{
 requests=[];
 const updated=await she.client.from("hanyang_safety_store")
   .update({items:[{id:"changed"}]})
   .eq("id","main_v10_chunk_0").eq("updated_at",ISO)
   .select("id,items,updated_at").then(x=>x);
 assert.equal(updated.error,null);
 assert.equal(updated.data[0].items[0].id,"changed");
 const latest=await she.client.from("hanyang_safety_store").select("*").eq("id","main_v10_chunk_0").maybeSingle();
 assert.equal(latest.data.items[0].id,"changed");
 const conditional=requests.filter(x=>x.action==="store_get").at(-1);
 assert.equal(conditional.body.if_updated_at,"2026-11-21T09:00:02.000Z");
});
await test("Roster downgrade never reuses full private roster response",async()=>{
 await she.client.from("hanyang_safety_store").select("*").eq("id","main_v1_roster_master").maybeSingle();
 persona={role:"admin",permissions:{roster:false,education:true}};
 requests=[];
 const result=await she.client.from("hanyang_safety_store").select("*").eq("id","main_v1_roster_master").maybeSingle();
 assert.equal(requests[0].body.if_view,"full");
 assert.equal(result.data.redacted_for_education,true);
});
await test("Logout clears memory cache and conditional request metadata",async()=>{
 await she.logout();
 persona={role:"viewer_admin",permissions:{roster:true}};
 await she.login("viewer","not-a-real-password");
 requests=[];
 await she.client.from("hanyang_safety_store").select("*").eq("id","main_v10_chunk_0").maybeSingle();
 assert.equal(requests[0].body.if_updated_at,undefined);
});
await test("Server batch permissions and per-row authorization remain mandatory",async()=>{
 const begin=storeSource.indexOf("async function getBatch(");
 const end=storeSource.indexOf("async function listRows(");
 assert.ok(begin>=0&&end>begin);
 const batch=storeSource.slice(begin,end);
 assert.ok(batch.includes("canRead(a,scope)"));
 assert.ok(batch.indexOf("canRead(a,scope)")<batch.indexOf('.select("id,documents,items,users,updated_at")'));
 assert.ok(storeSource.includes('input.if_view===view'));
 assert.ok(storeSource.includes('input.if_updated_at===revision.updated_at'));
});
await test("Education unchanged-response skip and staggered refresh preserved",async()=>{
 assert.ok(dashboard.includes("not_modified && state.rosterReady"));
 assert.ok(dashboard.includes("response.data.updated_at === state.scheduleTimestamp"));
 assert.ok(dashboard.includes("Math.random() * 15000"));
});
console.log(`Completed ${passed} performance compatibility checks.`);
if(process.exitCode)process.exit(process.exitCode);
