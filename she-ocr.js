/* HANYANG SHE V21: browser-local OCR with reviewed, blank-only roster updates. */
(function(global){
  'use strict';
  let modal=null, active=null, file=null, objectURL='', loaded=null, busy=false;
  const $=id=>document.getElementById(id);
  const str=value=>String(value??'');
  // The four identity fields verify the worker. Resignation date is optional DATA, not an identity key.
  // Never import the unrelated document NO/sequence column.
  const IDENTITY_HEADERS=['근로번호','성명','생년월일','휴대폰번호'];
  const ROSTER_OCR_HEADERS=[...IDENTITY_HEADERS,'퇴사일자'];
  const IDENTITY_ALIASES=Object.freeze({
    workerNo:['근로번호','근로자번호','근로자id','사원번호','근로번호8자리','workerid'],
    name:['성명','이름','이를','근로자명','근로자성명','name'],
    birth:['생년월일','생일','출생일','주민번호앞자리','생년월일6자리','birth','dob'],
    phone:['핸드폰번호','핸드폰','휴대폰번호','휴대전화번호','휴대폰','연락처','전화번호','전화','휴대전화','mobile','phone'],
    resignDate:['퇴사일자','퇴사일','퇴직일자','퇴직일','resigndate','terminationdate']
  });
  const normHead=x=>str(x).normalize('NFKC').replace(/[\s\u200b-\u200d\ufeff()·:_\-]/g,'').toLowerCase();
  function identityHeader(cell){
    const h=normHead(cell);
    return Object.keys(IDENTITY_ALIASES).find(k=>IDENTITY_ALIASES[k].some(v=>normHead(v)===h))||'';
  }
  function identityDigits(x){return str(x).normalize('NFKC').replace(/\D/g,'');}
  function identityWorker(x){return str(x).normalize('NFKC').replace(/[\s\-]/g,'').toUpperCase();}
  function identityName(x){return str(x).normalize('NFKC').replace(/[\s\u200b-\u200d\ufeff]/g,'').toLowerCase();}
  function identityBirth(x){
    const d=identityDigits(x);
    return d.length===6?d:d.length===8&&/^(19|20)/.test(d)?d.slice(2):'';
  }
  // 010-1234-5678 -> 12345678; OCR may drop the first 0 -> 10-1234-5678.
  // Do not accept arbitrary 8 digits with unknown context for automatic matching unless
  // supplied under an explicit phone column (caller makes this distinction).
  function identityPhone8(x){
    const d=identityDigits(x);
    if(d.length===11&&d.startsWith('010'))return d.slice(3);
    if(d.length===10&&d.startsWith('10'))return d.slice(2);
    if(d.length===8)return d;
    return '';
  }
  function identityPhoneValue(x){
    const last8=identityPhone8(x);
    return last8?'010'+last8:'';
  }
  function projectIdentityRows(rows,includeResignDate=false){
    const keys=includeResignDate?['workerNo','name','birth','phone','resignDate']:['workerNo','name','birth','phone'];
    const result=[(includeResignDate?ROSTER_OCR_HEADERS:IDENTITY_HEADERS).slice()];
    if(!Array.isArray(rows))return result;
    let best=null;
    for(let r=0;r<Math.min(rows.length,35);r++){
      const cols={};(rows[r]||[]).forEach((v,c)=>{const k=identityHeader(v);if(k&&cols[k]===undefined)cols[k]=c;});
      const score=Object.keys(cols).filter(k=>keys.includes(k)).length;
      if(score>=2&&(cols.workerNo!==undefined||cols.name!==undefined)&&(!best||score>best.score))best={r,cols,score};
    }
    if(!best)return result;
    for(let r=best.r+1;r<rows.length;r++){
      const row=rows[r]||[];
      const x=keys.map(k=>best.cols[k]===undefined?'':str(row[best.cols[k]]).trim());
      if(!x.some(Boolean))continue;
      if(x.every(v=>!v||/^[-—–]$/.test(v)))continue;
      // Exclude repeated header and totals: no roster NO/sequence column.
      if(identityHeader(x[0])==='workerNo'||identityHeader(x[1])==='name')continue;
      result.push(x);
    }
    return result;
  }
  function identityRecordsFromMatrix(matrix){
    const projected=projectIdentityRows(matrix,true),records=[];
    for(let i=1;i<projected.length;i++){
      const v=projected[i];
      records.push({__sourceLocation:`OCR ${i+1}행`,workerNo:str(v[0]).trim(),name:str(v[1]).trim(),birth:str(v[2]).trim(),phone:str(v[3]).trim(),resignDate:str(v[4]).trim()});
    }
    return records;
  }
  // Date is a data field: never infer a date from NO or a 6-digit birth value.
  // Accept explicit full year-month-day formats only and verify the real calendar date.
  function normalizedResignDate(value){
    const raw=str(value).normalize('NFKC').trim();
    if(!raw)return '';
    const compact=raw.replace(/\s+/g,'');
    let m=compact.match(/^(\d{4})[-.\/](\d{1,2})[-.\/](\d{1,2})$/) ||
      compact.match(/^(\d{4})년(\d{1,2})월(\d{1,2})일?$/) ||
      compact.match(/^(\d{4})(\d{2})(\d{2})$/);
    if(!m)return '';
    const year=+m[1],month=+m[2],day=+m[3];
    if(year<1900||year>2100||month<1||month>12||day<1||day>31)return '';
    const dt=new Date(Date.UTC(year,month-1,day));
    if(dt.getUTCFullYear()!==year||dt.getUTCMonth()!==month-1||dt.getUTCDate()!==day)return '';
    return `${year.toString().padStart(4,'0')}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }
  function matchRosterBlankFields(matrix,existingRecords){
    const incoming=identityRecordsFromMatrix(matrix),records=existingRecords.map(x=>({...x}));
    const byNo=new Map(),byName=new Map(),byBirth=new Map(),byPhone=new Map();
    const add=(map,key,idx)=>{if(!key)return;const a=map.get(key)||[];a.push(idx);map.set(key,a);};
    records.forEach((rec,i)=>{
      add(byNo,identityWorker(rec.workerNo),i);
      add(byName,identityName(rec.name),i);
      add(byBirth,identityBirth(rec.birth),i);
      add(byPhone,identityPhone8(rec.phone),i);
    });
    const stats={sourceRows:incoming.length,matched:0,filledCells:0,filledResignDates:0,unchanged:0,unmatched:0,conflicts:0,duplicates:0,invalid:0};
    const entries=[],seen=new Set();
    for(const rec of incoming){
      const where=rec.__sourceLocation,who=`${rec.name||'성명 없음'} / ${rec.workerNo||'번호 없음'}`;
      const no=identityWorker(rec.workerNo),name=identityName(rec.name),birth=identityBirth(rec.birth),phone=identityPhone8(rec.phone),resignDate=normalizedResignDate(rec.resignDate);
      const issue=(kind,note)=>{entries.push({kind,where,worker:who,note});if(kind==='중복')stats.duplicates++;else if(kind==='식별 불가'||kind==='날짜 확인 필요')stats.invalid++;else if(kind==='정보 충돌'||kind==='복수 일치')stats.conflicts++;else stats.unmatched++;};
      if(rec.birth&&!birth){issue('식별 불가','생년월일은 6자리 또는 8자리 날짜 형식이어야 합니다.');continue;}
      if(rec.phone&&!phone){issue('식별 불가','휴대폰번호에서 010을 제외한 8자리 번호를 확인할 수 없습니다.');continue;}
      if(rec.resignDate&&!resignDate){issue('날짜 확인 필요',`퇴사일자 [${rec.resignDate}]가 올바른 연-월-일이 아닙니다. 이 행은 변경하지 않습니다.`);continue;}
      if(!no && !(name&&(birth||phone)) && !(birth&&phone)){
        issue('식별 불가','근로번호 또는 두 가지 이상의 식별정보가 필요합니다.');continue;
      }
      let candidate=[];
      if(no && (byNo.get(no)||[]).length) candidate=[...(byNo.get(no)||[])];
      else {
        // If the source worker number is not present in the roster, require at
        // least two corroborating identifiers to fill a blank worker number.
        const counts=new Map();
        const vote=(map,k)=>{if(k)for(const i of map.get(k)||[])counts.set(i,(counts.get(i)||0)+1);};
        vote(byName,name);vote(byBirth,birth);vote(byPhone,phone);
        candidate=[...counts].filter(([i,count])=>count>=2).map(([i])=>i);
      }
      if(!candidate.length){issue('미일치','연명부에서 동일 근로자를 찾지 못했습니다. 신규 근로자는 생성하지 않습니다.');continue;}
      if(candidate.length!==1){issue('복수 일치',`동일한 식별정보에 ${candidate.length}명의 근로자가 일치합니다. 자동 반영하지 않습니다.`);continue;}
      const i=candidate[0],old=records[i],reasons=[];
      if(no&&old.workerNo&&identityWorker(old.workerNo)!==no)reasons.push('근로번호 불일치');
      if(name&&old.name&&identityName(old.name)!==name)reasons.push('성명 불일치');
      if(birth&&old.birth&&identityBirth(old.birth)!==birth)reasons.push('생년월일 불일치');
      if(phone&&old.phone&&identityPhone8(old.phone)!==phone)reasons.push('휴대폰 뒷 8자리 불일치');
      if(reasons.length){issue('정보 충돌',reasons.join(', ')+' · 기존 값 유지');continue;}
      if(resignDate&&str(old.resignDate).trim()){
        const saved=normalizedResignDate(old.resignDate)||str(old.resignDate).trim();
        if(saved!==resignDate){
          issue('정보 충돌',`퇴사일자 불일치 · 연명부 기존값 [${old.resignDate}] 보존 / OCR값 [${resignDate}] 미적용`);
          continue;
        }
      }
      // Changing employment status requires at least two matching, *already recorded*
      // identifiers. An OCR-misread worker number alone cannot mark someone resigned.
      if(resignDate&&!str(old.resignDate).trim()){
        const verified=[no&&old.workerNo&&identityWorker(old.workerNo)===no,
          name&&old.name&&identityName(old.name)===name,
          birth&&old.birth&&identityBirth(old.birth)===birth,
          phone&&old.phone&&identityPhone8(old.phone)===phone].filter(Boolean).length;
        if(verified<2){issue('식별 불가','퇴사일자 입력은 기존 연명부 신원정보 2개 이상 일치해야 합니다. 기존값 유지');continue;}
      }
      if(seen.has(i)){issue('중복','같은 근로자가 이미지에 여러 번 있습니다. 첫 번째 행만 처리합니다.');continue;}
      seen.add(i);stats.matched++;
      const changes=[];
      for(const [key,v] of [['workerNo',no?rec.workerNo:''],['name',name?rec.name:''],['birth',birth?birth:''],['phone',phone?identityPhoneValue(rec.phone):''],['resignDate',resignDate]]){
        if(!v)continue;
        if(!str(old[key]).trim()){old[key]=v;stats.filledCells++;if(key==='resignDate')stats.filledResignDates++;changes.push(key);}
        else stats.unchanged++;
      }
      entries.push({kind:changes.length?'빈칸 보완':'일치',where,worker:who,note:changes.length?`기존 빈칸만 보완: ${changes.join(', ')}`:'기존 값 변경 없음'});
    }
    return {records,stats,entries,changed:stats.filledCells>0};
  }
  function matrixToIdentityText(rows,includeResignDate=false){return projectIdentityRows(rows,includeResignDate).map(r=>r.join('\t')).join('\n');}
  function ensureModal(){
    if(modal) return modal;
    const css=document.createElement('style');
    css.textContent=`
      .she-ocr-backdrop{position:fixed;inset:0;z-index:99999;background:rgba(9,18,35,.72);display:flex;align-items:center;justify-content:center;padding:15px}
      .she-ocr-backdrop[hidden]{display:none!important}.she-ocr-window{width:min(1050px,100%);max-height:95vh;overflow:auto;background:#fff;color:#172033;border-radius:15px;padding:18px;box-shadow:0 18px 70px #0005;font:14px/1.5 system-ui,'Malgun Gothic',sans-serif}
      .she-ocr-window button{font:inherit;border:1px solid #b4c4d7;background:#f5f9ff;border-radius:7px;padding:8px 12px;cursor:pointer;color:#142447}
      .she-ocr-window button:disabled{opacity:.5;cursor:not-allowed}.she-ocr-window button.primary{background:#172d83;border-color:#172d83;color:white}
      .she-ocr-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:10px 0}.she-ocr-window textarea{width:100%;min-height:190px;resize:vertical;padding:11px;border:1px solid #a4b4c9;border-radius:7px;font:13px/1.5 ui-monospace,Consolas,'Malgun Gothic',monospace}
      .she-ocr-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px}.she-ocr-preview{border:1px solid #dae1ef;background:#f8fafc;min-height:160px;max-height:275px;object-fit:contain;width:100%}
      .she-ocr-status{white-space:pre-wrap;background:#eff6ff;border:1px solid #cee2ff;padding:10px;border-radius:7px;margin:8px 0}.she-ocr-help{font-size:12px;color:#526178;margin:8px 0}
      @media(max-width:720px){.she-ocr-grid{grid-template-columns:1fr}.she-ocr-window{padding:12px}}`;
    document.head.appendChild(css);
    modal=document.createElement('div');modal.className='she-ocr-backdrop';modal.hidden=true;
    modal.innerHTML=`<section class="she-ocr-window" role="dialog" aria-modal="true" aria-labelledby="sheOcrTitle">
      <div style="display:flex;gap:8px;align-items:center;justify-content:space-between"><h2 id="sheOcrTitle" style="margin:0;font-size:18px">이미지 문자 인식 (OCR)</h2><button type="button" id="sheOcrClose">닫기 ×</button></div>
      <p class="she-ocr-help">JPG·PNG·WEBP 이미지의 한글·영문·숫자를 브라우저에서 인식합니다. 한글 인식 모델을 내려받으므로 최초 실행 시 인터넷이 필요합니다. 이미지는 서버로 업로드하지 않습니다.</p>
      <div class="she-ocr-actions"><input type="file" accept="image/png,image/jpeg,image/webp" id="sheOcrFile"><button type="button" id="sheOcrRun" class="primary">🔎 문자 추출</button><button type="button" id="sheOcrCopy">📋 텍스트 복사</button><button type="button" id="sheOcrCsv">📄 텍스트 CSV 저장</button></div>
      <div class="she-ocr-grid"><div><strong>원본 이미지</strong><img id="sheOcrImage" class="she-ocr-preview" alt="업로드된 이미지 미리보기"><p id="sheOcrPreviewHelp" class="she-ocr-help">표에서 신원 항목을 추출합니다. NO(순번)는 무시합니다. 흐린 글자는 원본과 대조하세요.</p></div>
      <div><label for="sheOcrText"><strong>추출된 텍스트 / 검토·수정</strong></label><textarea id="sheOcrText" spellcheck="false" placeholder="문자 추출 후 내용이 나타납니다. 근로번호, 성명, 생년월일, 휴대폰번호를 탭(Tab)으로 구분해 확인하세요."></textarea></div></div>
      <div id="sheOcrStatus" class="she-ocr-status" role="status" aria-live="polite">이미지 파일을 선택하세요.</div>
      <label style="display:flex;align-items:center;gap:7px;cursor:pointer"><input id="sheOcrReviewed" type="checkbox"> 원본과 추출 결과를 비교·수정했으며 데이터 매칭을 진행합니다.</label>
      <p id="sheOcrRulesHelp" class="she-ocr-help">NO는 무시합니다. 근로번호·성명·생년월일·휴대폰번호로 신원을 확인하고, 기존 근로자의 빈칸만 보완합니다. 서버 저장은 별도 확인이 필요합니다.</p>
      <div class="she-ocr-actions" style="justify-content:flex-end"><button type="button" id="sheOcrApply" class="primary" disabled>검토한 표로 대상자 매칭</button><button type="button" id="sheOcrCancel">취소</button></div>
    </section>`;
    document.body.appendChild(modal);
    $('sheOcrClose').addEventListener('click',close);
    $('sheOcrCancel').addEventListener('click',close);
    modal.addEventListener('click',e=>{if(e.target===modal&&!busy)close();});
    $('sheOcrFile').addEventListener('change',e=>{const selected=e.target.files?.[0]; if(selected)setFile(selected);});
    $('sheOcrRun').addEventListener('click',recognize);
    $('sheOcrCopy').addEventListener('click',async()=>{
      try{await navigator.clipboard.writeText($('sheOcrText').value);status('텍스트를 복사했습니다.');}
      catch(e){$('sheOcrText').focus();$('sheOcrText').select();status('복사가 제한되어 텍스트를 선택했습니다. Ctrl+C로 복사하세요.');}
    });
    $('sheOcrCsv').addEventListener('click',downloadText);
    $('sheOcrText').addEventListener('input',()=>{$('sheOcrReviewed').checked=false;updateApply();});
    $('sheOcrReviewed').addEventListener('change',updateApply);
    $('sheOcrApply').addEventListener('click',apply);
    return modal;
  }
  function status(message){$('sheOcrStatus').textContent=str(message);}
  function updateApply(){ $('sheOcrApply').disabled=busy||!active?.onApply||!$('sheOcrText').value.trim()||!$('sheOcrReviewed').checked; }
  function setFile(selected){
    if(!/^image\/(png|jpeg|webp)$/.test(selected.type)||selected.size>12*1024*1024){
      $('sheOcrFile').value='';file=null;status('JPG·PNG·WEBP, 12MB 이하 이미지만 지원합니다.');return;
    }
    if(objectURL)URL.revokeObjectURL(objectURL);
    file=selected;objectURL=URL.createObjectURL(file);$('sheOcrImage').src=objectURL;
    $('sheOcrText').value='';$('sheOcrReviewed').checked=false;updateApply();status('이미지를 확인한 뒤 [문자 추출]을 누르세요.');
  }
  function open(config){
    ensureModal();active=config||{};modal.hidden=false;
    $('sheOcrTitle').textContent=active.title||'이미지 문자 인식 (OCR)';
    $('sheOcrApply').textContent=active.applyLabel||'검토한 표로 대상자 매칭';
    const isRoster=!!active.includeResignDate;
    $('sheOcrPreviewHelp').textContent=isRoster
      ?'근로번호·성명·생년월일·휴대폰번호 및 퇴사일자(있는 경우)를 각 열에서 추출합니다. NO(순번)는 제외합니다. 날짜는 원본과 대조하세요.'
      :'근로번호·성명·생년월일·휴대폰번호를 추출합니다. NO(순번)와 퇴사일자는 수강자 선택에 사용하지 않습니다.';
    $('sheOcrRulesHelp').textContent=isRoster
      ?'신원정보로 기존 근로자와 일치 여부를 확인하고, 빈칸만 보완합니다. 퇴사일자도 비어 있을 때만 적용되며 재직인원 통계가 변경될 수 있습니다. 기존값은 덮어쓰지 않습니다. 서버 저장은 별도 확인이 필요합니다.'
      :'근로번호·성명·생년월일·휴대폰 뒷 8자리로 수강자를 대조합니다. 교육 및 홍채 대상자 제한을 유지합니다.';
    $('sheOcrText').placeholder=isRoster?'근로번호\t성명\t생년월일\t휴대폰번호\t퇴사일자 순으로 탭(Tab) 구분':'근로번호\t성명\t생년월일\t휴대폰번호 순으로 탭(Tab) 구분';
    $('sheOcrFile').value='';$('sheOcrText').value='';$('sheOcrReviewed').checked=false;
    $('sheOcrImage').removeAttribute('src');file=null;status('이미지 파일을 선택하세요.');updateApply();
  }
  function close(){
    if(busy)return;
    if(objectURL){URL.revokeObjectURL(objectURL);objectURL='';}
    file=null;active=null;modal.hidden=true;
  }
  function loadTesseract(){
    if(global.Tesseract?.createWorker)return Promise.resolve();
    if(loaded)return loaded;
    loaded=new Promise((resolve,reject)=>{
      const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';s.async=true;
      s.onload=()=>global.Tesseract?.createWorker?resolve():reject(Error('OCR 엔진을 초기화하지 못했습니다.'));
      s.onerror=()=>reject(Error('OCR 엔진 다운로드 실패. 인터넷 연결 또는 콘텐츠 차단 설정을 확인하세요.'));
      document.head.appendChild(s);
    }).catch(e=>{loaded=null;throw e;});
    return loaded;
  }
  // OCR fallback for plain text: only accept rows containing clearly recognizable
  // name and at least one numeric identity. Page titles/NO/other fields are ignored.
  function parseLooseIdentityText(raw,includeResignDate=false){
    const out=[(includeResignDate?ROSTER_OCR_HEADERS:IDENTITY_HEADERS).slice()];
    for(const rawLine of str(raw).split(/\r?\n/)){
      const line=rawLine.normalize('NFKC').trim();
      if(!line || /퇴사요청서|근로번호.*생년월일|^no[.\s]/i.test(line))continue;
      const words=line.replace(/[|│]/g,' ').split(/\s+/).filter(Boolean);
      // Never guess at an absent name or a number's intended column.
      const name=words.find(v=>/^[가-힣]{2,6}$/.test(v))||'';
      const phone=words.find(v=>/^010[\s-]?\d{4}[\s-]?\d{4}$/.test(v)||/^10\d{8}$/.test(v))||'';
      const birth=words.find(v=>/^\d{6}$/.test(v)||/^(?:19|20)\d{6}$/.test(v))||'';
      const eight=words.filter(v=>/^\d{8}$/.test(v));
      const worker= eight.find(v=>v!==birth&&v!==identityPhone8(phone))||'';
      // Do not infer an employment date from unstructured OCR text. The operator
      // can fill the resignation date manually from the original source image.
      if(name&&(worker||birth||phone))out.push(includeResignDate?[worker,name,birth,phone,'']:[worker,name,birth,phone]);
    }
    return out;
  }
  // Detect drawn table grids using image geometry. OCR each *relevant cell*, rather
  // than trying to parse the entire page as a paragraph. No/sequence columns are
  // never copied to the output. If the grid cannot be confirmed, request review.
  function detectGrid(canvas){
    const width=canvas.width,height=canvas.height;
    if(width<160||height<45||width*height>9000000)return null;
    const data=canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,width,height).data;
    const black=(x,y)=>{const i=(y*width+x)*4;return data[i]<175&&data[i+1]<175&&data[i+2]<175;};
    const runs=[];
    const minLine=Math.max(90,Math.floor(width*.14));
    for(let y=0;y<height;y++){
      let bestStart=-1,bestLen=0,start=-1;
      for(let x=0;x<=width;x++){
        const dark=x<width&&black(x,y);
        if(dark&&start===-1)start=x;
        else if(!dark&&start>=0){
          if(x-start>bestLen){bestLen=x-start;bestStart=start;}
          start=-1;
        }
      }
      if(bestLen>=minLine)runs.push({y,x0:bestStart,x1:bestStart+bestLen});
    }
    const groups=[];
    for(const r of runs){
      const g=groups.find(g=>Math.abs(g.x0-r.x0)<=7&&Math.abs(g.x1-r.x1)<=7);
      if(g)g.lines.push(r.y);else groups.push({x0:r.x0,x1:r.x1,lines:[r.y]});
    }
    let best=null,quality=-1;
    for(const g of groups){
      const lines=g.lines.filter((y,i,a)=>i===0||y-a[i-1]>2);
      if(lines.length<3)continue;
      const y0=lines[0],y1=lines.at(-1);
      if(y1-y0<22)continue;
      const vertical=[];
      for(let x=g.x0;x<=g.x1;x++){
        let hits=0;
        for(let y=y0+2;y<y1-1;y++)if(black(x,y))hits++;
        if(hits>=Math.ceil((y1-y0-3)*.86))vertical.push(x);
      }
      const xs=[g.x0];for(const x of vertical){if(x>xs.at(-1)+3)xs.push(x);}
      if(g.x1>xs.at(-1)+8)xs.push(g.x1);
      const good=xs.length>=5&&xs.length<=33&&lines.length<=105;
      const score=good?(g.x1-g.x0)*lines.length:0;
      if(score>quality&&good){best={xs,ys:lines};quality=score;}
    }
    return best;
  }
  function cellCanvas(canvas,x0,y0,x1,y1){
    const margin=2,width=Math.max(1,x1-x0-2*margin),height=Math.max(1,y1-y0-2*margin);
    const scale=width<130?4:3;
    const out=document.createElement('canvas');out.width=Math.min(1000,width*scale+24);out.height=Math.min(200,height*scale+24);
    const ctx=out.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,out.width,out.height);
    ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.filter='grayscale(1) contrast(1.65)';
    ctx.drawImage(canvas,x0+margin,y0+margin,width,height,12,12,out.width-24,out.height-24);
    return out;
  }
  async function extractGridRows(imgFile,worker,includeResignDate=false){
    if(typeof createImageBitmap!=='function')return null;
    let bitmap=null;
    try{
      bitmap=await createImageBitmap(imgFile);
      const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
      const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0);
      const grid=detectGrid(canvas);if(!grid)return null;
      const {xs,ys}=grid;
      if(xs.length-1>24||ys.length-2>70){status('표가 너무 큽니다. 70명 이하로 나누어 캡처하거나 엑셀을 사용하세요.');return null;}
      if(worker.setParameters)await worker.setParameters({tessedit_pageseg_mode:'7'});
      const recognizeCell=async(x,y)=>{
        const crop=cellCanvas(canvas,xs[x],ys[y],xs[x+1],ys[y+1]);
        const result=await worker.recognize(crop);
        return str(result?.data?.text).replace(/[\r\n\t]+/g,' ').trim();
      };
      const headers=[];
      for(let c=0;c<xs.length-1;c++)headers.push(await recognizeCell(c,0));
      const fields=headers.map(identityHeader);
      if(!fields.some(k=>k==='name'||k==='workerNo')||fields.filter(Boolean).length<2)return null;
      const result=[headers];
      for(let r=1;r<ys.length-1;r++){
        const row=Array(headers.length).fill('');
        for(let c=0;c<fields.length;c++)if(fields[c]&&(includeResignDate||fields[c]!=='resignDate'))row[c]=await recognizeCell(c,r);
        if(row.some(Boolean))result.push(row);
        if(r%4===0){status(`표 구조 인식 중… ${r}/${ys.length-2}행`);await new Promise(resolve=>setTimeout(resolve,0));}
      }
      return result;
    }catch(error){console.warn('OCR 표 구조 분석을 사용할 수 없어 일반 인식으로 전환:',error);return null;}
    finally{if(bitmap)bitmap.close();if(worker?.setParameters){try{await worker.setParameters({tessedit_pageseg_mode:'3'});}catch(e){}}}
  }
  async function recognize(){
    if(busy)return;
    if(!file){status('먼저 이미지를 선택하세요.');return;}
    busy=true;$('sheOcrRun').disabled=true;updateApply();
    let worker=null;
    try{
      status('한글·영문 OCR 모델 준비 중… (첫 사용 시 모델 다운로드)');
      await loadTesseract();
      worker=await global.Tesseract.createWorker(['kor','eng'],1,{
        logger:event=>{if(event?.status){const progress=Number.isFinite(event.progress)?` ${Math.round(event.progress*100)}%`:'';status(`문자 인식: ${event.status}${progress}`);}}
      });
      const result=await worker.recognize(file);
      const original=str(result?.data?.text).trim();
      const includeResignDate=!!active?.includeResignDate;
      const grid=await extractGridRows(file,worker,includeResignDate);
      let identities=projectIdentityRows(grid||parseRows(original),includeResignDate);
      if(identities.length<=1){
        // Free-form OCR cannot safely assign a worker's identity fields.
        // Never paste page title or NO into an identity cell.
        const loose=parseLooseIdentityText(original,includeResignDate);
        identities=loose.length>1?loose:identities;
      }
      $('sheOcrText').value=identities.map(row=>row.join('\t')).join('\n');
      $('sheOcrReviewed').checked=false;
      status(identities.length>1?`정보 ${identities.length-1}행 추출 완료. ${includeResignDate?'퇴사일자를 포함해 5개 항목':'신원정보 4개 항목'}을 원본과 대조하세요. NO(순번)는 제외했습니다.`:`표의 정보를 자동 분리하지 못했습니다. 원본을 보고 ${includeResignDate?'근로번호·성명·생년월일·휴대폰번호·퇴사일자':'신원정보 4개 항목'}를 탭(Tab)으로 입력하세요. 불명확한 값은 비워 두세요.`);
    }catch(e){console.error('OCR 인식 오류:',e);status('문자 인식 실패: '+(e.message||str(e)));}
    finally{
      if(worker){try{await worker.terminate();}catch(e){console.warn('OCR worker 종료 실패',e);}}
      busy=false;$('sheOcrRun').disabled=false;updateApply();
    }
  }
  function parseRows(text){
    // Accept TSV, copied Excel cells, simple CSV / pipe-delimited, or 2+ spaces between cells.
    return str(text).replace(/\r/g,'').split('\n').filter(line=>line.trim()).map(line=>{
      if(line.includes('\t'))return line.split(/\t/).map(x=>x.trim());
      if(line.includes('|')||line.includes('│'))return line.split(/[|│]/).map(x=>x.trim());
      if(line.includes(',')){
        const cells=[],regex=/(?:^|,)(?:"((?:[^"]|"")*)"|([^,]*))/g;let m;
        while((m=regex.exec(line))!==null){cells.push(str(m[1]===undefined?m[2]:m[1].replace(/""/g,'"')).trim());if(!m[0])break;}
        if(cells.length>=2)return cells;
      }
      return line.split(/\s{2,}/).map(x=>x.trim()).filter(Boolean);
    });
  }
  async function apply(){
    if(busy||!active?.onApply||!$('sheOcrReviewed').checked)return;
    const rows=parseRows($('sheOcrText').value);
    if(!rows.length||rows.every(r=>r.length<2)||projectIdentityRows(rows,!!active?.includeResignDate).length<=1){status('근로번호·성명·생년월일·휴대폰번호가 들어 있는 표 행이 없습니다. 원본 이미지와 대조해 머리글과 데이터를 탭(Tab)으로 구분해 주세요.');return;}
    if(!global.confirm('OCR 결과는 오인식 가능성이 있습니다. 원본과 대조한 표를 기존 신원검증 규칙으로 매칭/검토하시겠습니까?'))return;
    busy=true;updateApply();
    try{
      status(`${rows.length}행을 기존 연명부 매칭 규칙으로 검증 중…`);
      const message=await active.onApply(rows);
      status(str(message||'데이터 매칭이 완료되었습니다. 선택 인원과 불일치 보고서를 확인하세요.'));
    }catch(e){console.error('OCR 검토 후 매칭 오류:',e);status(`검토·매칭이 중단되었습니다: ${e.message||str(e)}\n머리글(성명/근로번호 등)과 행 구분을 확인하세요.`);}
    finally{busy=false;updateApply();}
  }
  function downloadText(){
    const txt=$('sheOcrText').value;
    if(!txt.trim()){status('저장할 텍스트가 없습니다.');return;}
    // Pure OCR text: prevent CSV formula execution when opened in a spreadsheet.
    const rows=parseRows(txt).map(r=>r.map(v=>{
      const s=/^[\s]*[=+@\-]/.test(v)?"'"+v:v;
      return '"'+s.replace(/"/g,'""')+'"';
    }).join(','));
    const blob=new Blob(['\uFEFF',rows.join('\r\n')],{type:'text/csv;charset=utf-8'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='SHE_OCR_검토텍스트.csv';a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1500);
  }
  global.SHEOCR=Object.freeze({open,parseRows,projectIdentityRows,identityPhone8,normalizedResignDate,matchRosterBlankFields});
})(window);
