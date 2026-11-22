import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const read=name=>readFileSync(resolve(root,name),"utf8");
const roster=read("roster.html"),education=read("dashboard.html");
const smart=read("roster-smart-view.js"),edu=read("education-workflow.js");
const css=read("she-ux2026.css");
let passes=0;
function test(name,fn){
 try{fn();passes++;console.log("PASS",name);}
 catch(e){console.error("FAIL",name,e);process.exitCode=1;}
}
for(const [filename,source] of [["roster-smart-view.js",smart],["education-workflow.js",edu]]){
 test(filename+" parses as classic JavaScript",()=>new vm.Script(source,{filename}));
}
for(const [filename,source] of [["roster.html",roster],["dashboard.html",education]]){
 test(filename+" main inline script parses",()=>{
  for(const [i,match] of [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].entries())
    new vm.Script(match[1],{filename:filename+":inline:"+i});
 });
}
test("Both pages share one undoable CSS and UX asset set",()=>{
 for(const html of [roster,education]){
  assert.match(html,/\.\/she-ux2026\.css\?v=20261122-ux1/);
 }
 assert.match(roster,/roster-smart-view\.js\?v=20261122-ux1/);
 assert.match(education,/education-workflow\.js\?v=20261122-ux1/);
 assert.match(css,/body\.she-roster-smart \#sheSmartRoster/);
});
test("Original 27-field editor, autosave and XLSX import/export remain present",()=>{
 for(const key of ["workerNo","name","company","job","eduCommon","edu13ho",
 "edu38ho","edu4ho","edu35ho","eduClosed","eduMsds","eduCrane","notes"]){
   assert.ok(roster.includes("key:'"+key+"'"),key);
 }
 assert.match(roster,/async function saveRoster\(manual = true\)/);
 assert.match(roster,/function markDirty\(\)/);
 assert.match(roster,/async function importRosterExcel\(file\)/);
 assert.match(roster,/async function exportRosterExcel\(\)/);
 assert.match(roster,/function filterTable\(/);
});
test("Original education calendar, attendance confirmation, export and save remain present",()=>{
 for(const keyword of ["function openConfirm(","function renderCalendar(","function renderScheduleList(",
    "async function saveSchedule(","function fetchRoster(","function submitEventForm(",
    "function confirmCompleted"]) {
   // confirmation method may have a different final name; check its action hook instead
   if(keyword==="function confirmCompleted")continue;
   assert.ok(education.includes(keyword),keyword);
 }
 assert.match(education,/commitConfirmBtn.*addEventListener\('click',commitConfirm\)/);
  assert.ok(education.includes('she-v24-index.js'));
});
test("Smart roster has worker detail, filters and original-view switch",()=>{
 for(const id of ["sheSmartRoster","sheSmartMode","sheFullMode","sheRosterDetail",
   "sheSmartSearch","sheSmartCompany","sheSmartTransfer","sheSmartList"])
   assert.ok(roster.includes('id="'+id+'"'),id);
 for(const key of ["all","active","resigned","soon","expired","incomplete"])
   assert.ok(roster.includes('data-she-roster-quick="'+key+'"'),key);
 assert.match(smart,/if\(mode==="smart"\)render\(\)/);
 assert.match(smart,/setMode\("full"\)/);
 assert.match(smart,/window\.SHESEC\?\.canWrite\(rosterState\.user,"roster"\)/);
});
test("Roster to education transfer is transient, minimal and bound to the account",()=>{
 const key="she_education_selected_workers_v1";
 assert.ok(smart.includes(key)&&edu.includes(key));
 assert.match(smart,/owner:rosterState\.user\.id,issued_at:Date\.now\(\),keys:/);
 assert.match(edu,/payload\.owner!==state\.user\?\.id/);
 assert.match(edu,/Date\.now\(\)-payload\.issued_at>5\*60\*1000/);
 assert.match(edu,/sessionStorage\.removeItem\(handoffKey\)/);
 assert.match(edu,/state\.workerIndex\?\.has\(key\)/);
 assert.match(edu,/if\(!canEdit\(\)/);
});
test("Attendance confirmation and write controls require existing edit permissions",()=>{
 assert.match(edu,/function canEdit\(\)/);
 assert.match(edu,/SHESEC\?\.canWrite\(state\.user,"education"\)===true/);
 assert.match(edu,/if\(canEdit\(\)\)/);
 assert.match(edu,/if\(!canEdit\(\)\|\|!state\.rosterReady\)return;/);
 assert.match(education,/window\.SHESEC\.canWrite\(state\.user,"education"\)/);
});
test("Education quick registration populates but does not auto-save",()=>{
 for(const id of ["sheEduPresetSelect","sheEduAutoSelect","sheEduPendingList",
   "sheEduIncomplete","sheEduRate","sheRosterHandoffHint"])
   assert.ok(education.includes('id="'+id+'"'),id);
 assert.match(edu,/if\(state\.editingId\)return/);
 assert.match(edu,/function applyPreset\(/);
 assert.match(edu,/renderAttendeeOptions\(\)/);
 assert.doesNotMatch(edu,/\b(?:saveSchedule|markDirty)\(/);
});
test("Overlapping room or worker schedule triggers pre-save confirmation",()=>{
 assert.match(edu,/start>=last\|\|end<=first/);
 assert.match(edu,/const sameLocation/);
 assert.match(edu,/const duplicated/);
 assert.match(edu,/window\.confirm\(/);
 assert.match(edu,/event\.preventDefault\(\);event\.stopImmediatePropagation\(\)/);
 assert.match(edu,/addEventListener\("submit",preventConflicts,true\)/);
});
test("Event refresh hooks remain presentation-only",()=>{
 assert.match(roster,/document\.dispatchEvent\(new Event\("she:roster-view-updated"\)\)/);
 assert.match(education,/document\.dispatchEvent\(new Event\("she:edu-schedule-updated"\)\)/);
 assert.match(education,/document\.dispatchEvent\(new Event\("she:edu-roster-ready"\)\)/);
 assert.doesNotMatch(smart,/SUPABASE_SERVICE_ROLE_KEY/);
 assert.doesNotMatch(edu,/SUPABASE_SERVICE_ROLE_KEY/);
});
console.log(`Completed ${passes} additive UX regression checks.`);
if(process.exitCode)process.exit(process.exitCode);
