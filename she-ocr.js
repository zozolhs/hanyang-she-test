/* HANYANG SHE V19: browser-local OCR review tool. Never auto-writes original roster. */
(function(global){
  'use strict';
  let modal=null, active=null, file=null, objectURL='', loaded=null, busy=false;
  const $=id=>document.getElementById(id);
  const str=value=>String(value??'');
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
      <div class="she-ocr-grid"><div><strong>원본 이미지</strong><img id="sheOcrImage" class="she-ocr-preview" alt="업로드된 이미지 미리보기"><p class="she-ocr-help">표 캡처는 원본이 선명해야 합니다. 열 인식이 불완전한 경우 아래 결과를 직접 수정하세요.</p></div>
      <div><label for="sheOcrText"><strong>추출된 텍스트 / 검토·수정</strong></label><textarea id="sheOcrText" spellcheck="false" placeholder="문자 추출 후 내용이 나타납니다. 표 데이터 적용 시 머리글과 각 행을 탭(Tab)으로 구분해 확인하세요."></textarea></div></div>
      <div id="sheOcrStatus" class="she-ocr-status" role="status" aria-live="polite">이미지 파일을 선택하세요.</div>
      <label style="display:flex;align-items:center;gap:7px;cursor:pointer"><input id="sheOcrReviewed" type="checkbox"> 원본과 추출 결과를 비교·수정했으며 데이터 매칭을 진행합니다.</label>
      <p class="she-ocr-help">매칭은 머리글(성명·근로번호·생년월일·업체명 등)을 포함한 표만 지원합니다. 일치하지 않거나 식별이 불명확한 항목은 자동 반영하지 않습니다. 실제 데이터 저장은 별도로 확인해야 합니다.</p>
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
      $('sheOcrText').value=str(result?.data?.text).trim();
      $('sheOcrReviewed').checked=false;
      status($('sheOcrText').value?`문자 추출 완료. 원본과 비교해 오인식된 성명·근로번호·교육값을 수정한 뒤 검토 확인란을 체크하세요.`:'인식된 텍스트가 없습니다. 이미지 해상도를 높이거나 다른 이미지로 다시 시도하세요.');
    }catch(e){console.error('OCR 인식 오류:',e);status('문자 인식 실패: '+(e.message||str(e)));}
    finally{
      if(worker){try{await worker.terminate();}catch(e){console.warn('OCR worker 종료 실패',e);}}
      busy=false;$('sheOcrRun').disabled=false;updateApply();
    }
  }
  function parseRows(text){
    // Accept TSV, copied Excel cells, simple CSV / pipe-delimited, or 2+ spaces between cells.
    return str(text).replace(/\r/g,'').split('\n').filter(line=>line.trim()).map(line=>{
      if(line.includes('\t'))return line.split(/\t+/).map(x=>x.trim());
      if(line.includes('|')||line.includes('│'))return line.split(/[|│]/).map(x=>x.trim()).filter(Boolean);
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
    if(!rows.length||rows.every(r=>r.length<2)){status('표 형태를 확인할 수 없습니다. 머리글 및 각 열을 탭(Tab)으로 구분하도록 텍스트를 검토해 주세요.');return;}
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
  global.SHEOCR=Object.freeze({open,parseRows});
})(window);
