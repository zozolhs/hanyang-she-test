/* SHE 모바일 업무모듈: 직접 접속한 경우 한 번의 뒤로가기를 SHE 포털로 보냅니다.
   index.html에서 들어온 경우에는 브라우저의 실제 이전 페이지 기록을 사용합니다.
   로그인 세션을 만들거나 삭제하지 않으며 서버 요청을 하지 않습니다. */
(()=>{
  'use strict';
  if(!window.matchMedia('(max-width:767px)').matches)return;
  const file=location.pathname.split('/').pop();
  const markerKey='she_nav_from_portal';
  let fromPortal=false;
  try{
    fromPortal=sessionStorage.getItem(markerKey)===file;
    // This is a navigation hint only; never an access-control flag.
    sessionStorage.removeItem(markerKey);
  }catch(_){}
  let sameAppPrevious=false;
  try{
    if(document.referrer){
      const previous=new URL(document.referrer);
      sameAppPrevious=previous.origin===location.origin &&
        previous.pathname.startsWith(location.pathname.slice(0,location.pathname.lastIndexOf('/')+1));
    }
  }catch(_){}
  // The browser already has a real in-app back entry: do not add a duplicate.
  if(fromPortal||sameAppPrevious)return;
  if(history.state?.hySheDirectModule==='active')return;
  history.replaceState({hySheDirectModule:'root'},'',location.href);
  history.pushState({hySheDirectModule:'active'},'',location.href);
  window.addEventListener('popstate',event=>{
    if(event.state?.hySheDirectModule==='root')location.replace('./index.html');
  });
})();
