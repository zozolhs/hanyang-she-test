import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";
const dir=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const load=f=>readFileSync(resolve(dir,f),"utf8");
let passed=0;
async function test(name,fn){
 try{await fn();passed++;console.log("PASS",name);}
 catch(e){console.error("FAIL",name,e);process.exitCode=1;}
}
function loadExports(file,exportList,context){
 const src=load(file);
 const closing=src.lastIndexOf("})();");
 assert.ok(closing>0);
 const injected=src.slice(0,closing)+"globalThis.__ux={"+exportList+"};\n"+src.slice(closing);
 vm.runInNewContext(injected,context,{filename:file});
 return context.__ux;
}
function session(){
 const map=new Map();
 return {
   getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),
   removeItem:k=>map.delete(k),
   has:k=>map.has(k)
 };
}
function dom(){
 const elements=new Map();
 const getElementById=id=>{
  if(!elements.has(id))elements.set(id,{
    id,value:"",textContent:"",hidden:true,
    dispatchEvent(){},setAttribute(){},addEventListener(){},
    replaceChildren(){},append(){},focus(){}
  });
  return elements.get(id);
 };
 return {readyState:"loading",getElementById,addEventListener(){},querySelectorAll(){return []}};
}
const required=["eduCommon","edu13ho","edu38ho","edu4ho","edu35ho"];
const worker=(uid,workerNo,overrides={})=>({
 uid,workerNo,name:"Test Worker",company:"Test Company",job:"배관공",
 ...Object.fromEntries(required.map(k=>[k,"2026-11-21 8h"])),...overrides
});
function rosterFixture(){
 const sessionStorage=session(),document=dom(),alerts=[];
 const rosterState={authorized:true,ready:true,user:{id:"user-1",role:"admin"}};
 const rosterView={records:[],byId:new Map(),cache:new Map(),selected:new Set()};
 const window={SHESEC:{canWrite:()=>true},matchMedia:()=>({matches:false})};
 const location={href:"roster.html"};
 const ctx={window,document,sessionStorage,rosterState,rosterView,location,
  requestAnimationFrame:fn=>fn(),
  recordState:r=>r._status||{resigned:false,expired:false,soon:false,welding:false},
  parseEducation:v=>({completed:/8h/.test(v||""),expired:false,soon:false}),
  alert:m=>alerts.push(m),
  console,Map,Set,Date,Math,String,Array,Number,JSON};
 const ux=loadExports("roster-smart-view.js","status,matches,transfer,selected,allowedToTransfer",ctx);
 return {ux,sessionStorage,rosterState,rosterView,location,window,alerts};
}
await test("Smart roster statuses use the existing education-completion rules",()=>{
 const r=rosterFixture();
 assert.equal(r.ux.status(worker("u1","1001"))[0],"필수교육 완료");
 assert.equal(r.ux.status(worker("u2","1002",{edu13ho:""}))[0],"교육 미이수");
 assert.equal(r.ux.status(worker("u3","1003",{_status:{resigned:false,expired:true,soon:false}}))[0],"교육 만료");
 assert.equal(r.ux.status(worker("u4","1004",{_status:{resigned:true,expired:false,soon:false}}))[0],"퇴사");
});
await test("Selection handoff never includes worker name, only stable IDs",()=>{
 const r=rosterFixture(),w=worker("u1","1001");
 r.rosterView.byId.set(w.uid,w);
 r.ux.selected.add(w.uid);
 r.ux.transfer();
 const raw=r.sessionStorage.getItem("she_education_selected_workers_v1");
 const data=JSON.parse(raw);
 assert.equal(data.owner,"user-1");
 assert.deepEqual(Array.from(data.keys),["worker:1001"]);
 assert.equal(raw.includes("Test Worker"),false);
 assert.equal(r.location.href,"dashboard.html?from=roster");
});
await test("Roster viewer without education edit permissions cannot handoff",()=>{
 const r=rosterFixture(),w=worker("u1","1001");
 r.window.SHESEC.canWrite=()=>false;
 r.rosterView.byId.set(w.uid,w);r.ux.selected.add(w.uid);
 r.ux.transfer();
 assert.equal(r.sessionStorage.getItem("she_education_selected_workers_v1"),null);
 assert.ok(r.alerts[0]?.includes("권한"));
});
function educationFixture(){
 const document=dom(),sessionStorage=session(),alerts=[],notifications=[];
 const state={
  authorized:true,ready:true,rosterReady:true,user:{id:"user-1",role:"admin"},
  events:[],workerIndex:new Map(),draftAttendees:new Set(),editingId:null
 };
 const window={SHESEC:{canWrite:()=>true},confirm:()=>true};
 let opened=0,rendered=0;
 const ctx={window,document,sessionStorage,state,
  todayString:()=> "2026-11-22",
  strictDate:s=>new Date(s+"T00:00:00"),
  formatDate:d=>d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"),
  timeMinutes:t=>{const x=String(t).split(":").map(Number);return x[0]*60+x[1]},
  educationState:v=>({completed:/8h/.test(v||""),dueDate:null}),
  workerEligible:w=>!w.resignDate,
  renderAttendeeOptions:()=>{rendered++},
  openEventModal:()=>{opened++;state.draftAttendees=new Set()},
  notify:m=>notifications.push(m),alert:m=>alerts.push(m),
  requestAnimationFrame:fn=>fn(),
  console,Map,Set,Date,Math,String,Array,Number,JSON,Event:class Event{},
 };
 const ux=loadExports("education-workflow.js",
   "applyPreset,findConflicts,preventConflicts,applyHandoff,suggestCourseAttendees,metrics",ctx);
 return {ux,state,document,sessionStorage,window,alerts,notifications,
   get opened(){return opened},get rendered(){return rendered}};
}
await test("Course preset fills only a new event and never saves automatically",()=>{
 const r=educationFixture(),get=id=>r.document.getElementById(id);
 r.ux.applyPreset("edu13ho");
 assert.equal(get("eventTitle").value,"특별안전교육 - 13호 운반");
 assert.equal(get("eventCategory").value,"special");
 assert.equal(get("eventCourse").value,"edu13ho");
 assert.equal(get("eventStart").value,"09:00");
 assert.equal(get("eventEnd").value,"11:00");
 r.state.editingId="existing";
 r.ux.applyPreset("eduCommon");
 assert.equal(get("eventCourse").value,"edu13ho");
});
await test("Schedule duplicate detection checks room, workers and course",()=>{
 const r=educationFixture(),get=id=>r.document.getElementById(id);
 Object.assign(get("eventDate"),{value:"2026-11-24"});
 Object.assign(get("eventStart"),{value:"09:00"});
 Object.assign(get("eventEnd"),{value:"11:00"});
 Object.assign(get("eventLocation"),{value:"교육장 1"});
 Object.assign(get("eventCourse"),{value:"eduCommon"});
 Object.assign(get("eventTitle"),{value:"공통교육"});
 r.state.draftAttendees.add("worker:1001");
 r.state.events=[{
  id:"different",kind:"education",status:"scheduled",date:"2026-11-24",
  startTime:"10:00",endTime:"12:00",location:"교육장 1",title:"공통교육",
  courseKey:"eduCommon",attendeeKeys:["worker:1001"]
 }];
 const issues=r.ux.findConflicts();
 assert.equal(issues.length,1);
 assert.equal(issues[0].location,true);
 assert.equal(issues[0].workers,1);
 assert.equal(issues[0].sameCourse,true);
 get("eventStart").value="12:00";get("eventEnd").value="14:00";
 assert.equal(r.ux.findConflicts().length,0);
});
await test("An unresolved overlap can cancel submit before the original save handler",()=>{
 const r=educationFixture(),get=id=>r.document.getElementById(id);
 get("eventDate").value="2026-11-24";get("eventStart").value="09:00";
 get("eventEnd").value="11:00";get("eventLocation").value="교육장 1";
 r.state.events=[{id:"e1",kind:"education",status:"scheduled",date:"2026-11-24",
 startTime:"09:30",endTime:"11:30",location:"교육장 1",attendeeKeys:[]}];
 r.window.confirm=()=>false;
 let stopped=false,prevented=false;
 r.ux.preventConflicts({preventDefault:()=>prevented=true,stopImmediatePropagation:()=>stopped=true});
 assert.equal(stopped,true);assert.equal(prevented,true);
});
await test("Education handoff accepts only current account's fresh, valid workers",()=>{
 const r=educationFixture();
 const w=worker("u1","1001");r.state.workerIndex.set("worker:1001",w);
 r.sessionStorage.setItem("she_education_selected_workers_v1",
  JSON.stringify({owner:"user-1",issued_at:Date.now(),keys:["worker:1001","worker:not-found"]}));
 r.ux.applyHandoff();
 assert.equal(r.opened,1);
 assert.deepEqual([...r.state.draftAttendees],["worker:1001"]);
 assert.equal(r.sessionStorage.getItem("she_education_selected_workers_v1"),null);
 assert.equal(r.document.getElementById("sheRosterHandoffHint").hidden,false);
});
await test("Education handoff rejects a different user, even with a valid worker ID",()=>{
 const r=educationFixture();
 r.state.workerIndex.set("worker:1001",worker("u1","1001"));
 r.sessionStorage.setItem("she_education_selected_workers_v1",
  JSON.stringify({owner:"someone-else",issued_at:Date.now(),keys:["worker:1001"]}));
 r.ux.applyHandoff();
 assert.equal(r.opened,0);
 assert.equal(r.sessionStorage.getItem("she_education_selected_workers_v1"),null);
});
await test("Education untrained/expiring auto-selection excludes completed and resigned workers",()=>{
 const r=educationFixture(),get=id=>r.document.getElementById(id);
 get("eventCourse").value="eduCommon";
 r.state.workerIndex.set("worker:1001",worker("u1","1001",{eduCommon:""}));
 r.state.workerIndex.set("worker:1002",worker("u2","1002",{eduCommon:"2026-11-21 8h"}));
 r.state.workerIndex.set("worker:1003",worker("u3","1003",{eduCommon:"",resignDate:"2026-11-20"}));
 r.ux.suggestCourseAttendees();
 assert.deepEqual([...r.state.draftAttendees],["worker:1001"]);
 assert.equal(r.rendered,1);
});
console.log(`Completed ${passed} isolated UX behavior tests.`);
if(process.exitCode)process.exit(process.exitCode);
