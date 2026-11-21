import assert from "node:assert/strict";

// Deliberately uses NO credentials, NO production data modifications,
// NO user identities and NO brute-force traffic.
const base="https://ahmqthuympannqsrszvv.supabase.co/functions/v1/";
const allowedOrigin="https://zozolhs.github.io";
const routes=[
  ["she-v24-auth",{action:"me"}],
  ["she-v24-store",{action:"store_get",id:"main_v1_roster_master"}],
  ["she-v24-data",{action:"store_get",id:"main_v1_roster_master"}],
];
let passed=0;
async function check(name,fn) {
  try {await fn(); console.log("PASS",name);passed++;}
  catch(e){console.error("FAIL",name,e.message);process.exitCode=1;}
}
async function call(route,{method="POST",origin=allowedOrigin,body={action:"me"},bearer=null}={}){
  const headers={"Origin":origin};
  if(method==="POST")headers["Content-Type"]="application/json";
  if(bearer!==null)headers.Authorization="Bearer "+bearer;
  return await fetch(base+route,{
    method,headers,
    ...(method==="POST"?{body:JSON.stringify(body)}:{}),
    redirect:"error",
    signal:AbortSignal.timeout(12000)
  });
}
for(const [route,body] of routes){
  await check(route+" rejects disallowed Origin before processing",async()=>{
    const r=await call(route,{origin:"https://attacker.invalid",body});
    assert.equal(r.status,403);
    assert.equal(r.headers.get("Access-Control-Allow-Origin"),null);
  });
  await check(route+" permits expected browser preflight",async()=>{
    const r=await call(route,{method:"OPTIONS"});
    assert.equal(r.status,204);
    assert.equal(r.headers.get("Access-Control-Allow-Origin"),allowedOrigin);
  });
  await check(route+" blocks malicious preflight",async()=>{
    const r=await call(route,{method:"OPTIONS",origin:"https://attacker.invalid"});
    assert.equal(r.status,403);
    assert.equal(r.headers.get("Access-Control-Allow-Origin"),null);
  });
  await check(route+" rejects unauthenticated data access",async()=>{
    const r=await call(route,{body});
    assert.equal(r.status,401);
    const text=await r.text();
    assert.ok(!text.includes("main_v1_roster_master"),"Did not expect data identifier in error");
    assert.equal(r.headers.get("Cache-Control"),"no-store");
  });
  await check(route+" rejects forged bearer token",async()=>{
    const r=await call(route,{body,bearer:"a".repeat(43)});
    assert.equal(r.status,401);
  });
  await check(route+" disallows GET",async()=>{
    const r=await call(route,{method:"GET"});
    assert.equal(r.status,405);
  });
}
console.log(`Completed ${passed} live unauthenticated security smoke tests.`);
if(process.exitCode)process.exit(process.exitCode);
