/* EHS performance: optional spreadsheet engines load only when a file operation starts.
   Browser-native script loader; no account, permission or storage behavior changes. */
(()=>{
 'use strict';
 if(window.EHSLibs)return;
 const libs=Object.freeze({
   xlsx:{global:'XLSX',src:'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'},
   exceljs:{global:'ExcelJS',src:'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js'}
 });
 const inflight=new Map();
 function ensure(name){
   const config=libs[name];
   if(!config)return Promise.reject(new Error('지원하지 않는 파일 라이브러리입니다.'));
   if(window[config.global])return Promise.resolve(window[config.global]);
   if(inflight.has(name))return inflight.get(name);
   const promise=new Promise((resolve,reject)=>{
     const script=document.createElement('script');
     script.src=config.src;
     script.async=true;
     script.onload=()=>{
       if(window[config.global])resolve(window[config.global]);
       else{script.remove();reject(new Error('파일 처리 라이브러리를 초기화하지 못했습니다.'));}
     };
     script.onerror=()=>{
       script.remove();reject(new Error('파일 처리 라이브러리를 다운로드하지 못했습니다. 인터넷 연결을 확인하세요.'));
     };
     document.head.appendChild(script);
   }).catch(err=>{inflight.delete(name);throw err;});
   inflight.set(name,promise);
   return promise;
 }
 window.EHSLibs=Object.freeze({ensure});
})();
