import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";

// Read-only, static coverage for all mobile SHE UI modules.
// It intentionally does not change user roles or export implementation.
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const load=(p)=>readFileSync(resolve(root,p),"utf8");
const css=load("mobile-spreadsheet-export.css");
let passed=0;
function test(name,fn){
  try{fn();passed++;console.log("PASS",name);}
  catch(e){console.error("FAIL",name,e.message);process.exitCode=1;}
}
const expected={
  "index.html":[/onclick="downloadTemplateExcel\(\)"/],
  "roster.html":[/id="excelDownloadButton"/,/id="rosterImportReportDownload"/],
  "dashboard.html":[/id="eduExcelErrorBtn"/,/id="irisExcelErrorBtn"/,
    /id="exportBatchBtn"/,/id="exportReportBtn"/],
  "health_check.html":[/id="hcDownloadExcelBtn"/],
  "onepage-integrated.html":[/id="bExport"/]
};
test("Mobile/touch responsive policy hides controls, not desktop stylesheet",()=>{
  assert.match(css,/@media screen and \(max-width: 900px\)/);
  assert.match(css,/\(hover: none\) and \(pointer: coarse\)/);
  assert.match(css,/\[data-mobile-spreadsheet-export\]/);
  assert.match(css,/display:\s*none\s*!important/);
  // CSS has no unconditional display rules before its only media block.
  assert.equal((css.match(/@media/g)||[]).length,1);
  const prefix=css.split("@media")[0].replace(/\/\*[\s\S]*?\*\//g,"").trim();
  assert.equal(prefix,"");
});
for(const [page,needles] of Object.entries(expected)){
  const html=load(page);
  test(page+": mobile-only stylesheet linked",()=>{
    assert.match(html,/<link rel="stylesheet" href="\.\/mobile-spreadsheet-export\.css\?v=20261122-1">/);
  });
  test(page+": all expected spreadsheet download buttons marked",()=>{
    const tags=[...html.matchAll(/<button\b[^>]*>/g)].map(x=>x[0]);
    const marked=tags.filter(x=>x.includes("data-mobile-spreadsheet-export"));
    assert.equal(marked.length,needles.length);
    for(const needle of needles){
      const button=tags.find(x=>needle.test(x));
      assert.ok(button,`Missing button ${needle}`);
      assert.ok(button.includes("data-mobile-spreadsheet-export"),`Not hidden: ${button}`);
      assert.doesNotMatch(button,/id="(?:eduExcelImportBtn|irisExcelImportBtn|bImport)"/);
    }
  });
}
test("Excel imports and upload controls are left visible on mobile",()=>{
  const roster=load("roster.html"),dashboard=load("dashboard.html");
  const risk=load("index.html"),onepage=load("onepage-integrated.html");
  for(const [html,part] of [
    [roster,'id="excelUpload"'],[dashboard,'id="eduExcelImportBtn"'],
    [dashboard,'id="irisExcelImportBtn"'],[risk,'id="excelFileInput"'],
    [onepage,'id="bImport"']]){
    const tag=html.slice(html.lastIndexOf("<",html.indexOf(part)),html.indexOf(">",html.indexOf(part))+1);
    assert.ok(tag.includes(part));
    assert.ok(!tag.includes("data-mobile-spreadsheet-export"),"Upload hidden: "+part);
  }
});
test("PDF, photo and unsaved backups remain available",()=>{
  const risk=load("index.html"),onepage=load("onepage-integrated.html");
  for(const [html,part] of [[onepage,'id="bPhotoPdf"'],[onepage,'id="bUnsavedBackup"'],
    [risk,'onclick="downloadCurrentModalImage()"']]){
    const tag=html.slice(html.lastIndexOf("<button",html.indexOf(part)),html.indexOf(">",html.indexOf(part))+1);
    assert.ok(tag.includes(part));
    assert.ok(!tag.includes("data-mobile-spreadsheet-export"));
  }
});
test("Desktop export and server-saving functions remain implemented",()=>{
  const roster=load("roster.html"),index=load("index.html"),
    health=load("health_check.html"),onepage=load("onepage-integrated.html");
  assert.match(roster,/async function exportRosterExcel\(\)/);
  assert.match(index,/function downloadTemplateExcel\(\)/);
  assert.match(health,/async function downloadCompletedExcel\(\)/);
  assert.match(onepage,/\$\('bExport'\)\.onclick/);
  assert.match(roster,/async function saveRoster\(/);
});
console.log(`Completed ${passed} mobile spreadsheet visibility checks.`);
if(process.exitCode)process.exit(process.exitCode);
