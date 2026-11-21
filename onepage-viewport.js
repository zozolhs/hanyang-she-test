/* ONE-PAGE 모바일: iframe 내부의 실제 문서 높이를 따라 프레임을 늘립니다.
   통합 포털은 단일 스크롤을 사용하고 불필요한 서버 조회는 하지 않습니다. */
(() => {
  'use strict';
  const frame=document.getElementById('workplaceOnepageFrame');
  if(!frame)return;
  const originalHeight=frame.style.getPropertyValue('height');
  const originalHeightPriority=frame.style.getPropertyPriority('height');
  const isMobile=()=>window.matchMedia('(max-width:767px)').matches;
  let resizeObserver=null,mutationObserver=null,observedDocument=null,pending=false;
  function disconnect(){
    resizeObserver?.disconnect();mutationObserver?.disconnect();
    resizeObserver=null;mutationObserver=null;observedDocument=null;
  }
  function syncHeight(){
    if(!isMobile()){
      frame.style.setProperty('height',originalHeight,originalHeightPriority);
      frame.removeAttribute('data-mobile-auto-height');
      return;
    }
    try{
      const doc=frame.contentDocument;
      if(!doc?.body || !doc.body.getBoundingClientRect)return;
      // body height is intrinsic on mobile; avoid documentElement.scrollHeight
      // which can include the frame's previous viewport height.
      const body=doc.body;
      const contentHeight=Math.ceil(Math.max(body.scrollHeight,body.getBoundingClientRect().height));
      if(!Number.isFinite(contentHeight) || contentHeight<100)return;
      const nextHeight=Math.max(840,Math.min(6500,contentHeight+14));
      const current=Number.parseFloat(frame.style.height);
      if(!Number.isFinite(current) || Math.abs(current-nextHeight)>6){
        frame.style.setProperty('height',nextHeight+'px','important');
        frame.dataset.mobileAutoHeight='true';
      }
    }catch(error){
      // No cross-origin access is required for the SHE integrated same-origin module.
      console.warn('ONE-PAGE 화면 높이 확인 실패',error);
    }
  }
  function scheduleSync(){
    if(pending)return;
    pending=true;
    window.requestAnimationFrame(()=>{pending=false;syncHeight();});
  }
  function bindDocument(){
    if(!isMobile())return;
    let doc;
    try{doc=frame.contentDocument;}catch(_){return;}
    if(!doc?.body)return;
    if(observedDocument!==doc){
      disconnect();
      observedDocument=doc;
      if(typeof ResizeObserver!=='undefined'){
        resizeObserver=new ResizeObserver(scheduleSync);
        for(const el of [doc.body,doc.getElementById('wrap'),doc.getElementById('months'),
                         doc.getElementById('sum'),doc.getElementById('pager'),doc.querySelector('.top')]){
          if(el)resizeObserver.observe(el);
        }
      }
      mutationObserver=new MutationObserver(scheduleSync);
      // A page switch, filter change or expanded row may alter the required height.
      mutationObserver.observe(doc.body,{subtree:true,childList:true,characterData:false});
      mutationObserver.observe(doc.body,{attributes:true,attributeFilter:['data-v24-ready']});
    }
    scheduleSync();
  }
  frame.addEventListener('load',bindDocument);
  window.addEventListener('resize',()=>{
    if(!isMobile()){
      disconnect();syncHeight();return;
    }
    if(!observedDocument)bindDocument();
    scheduleSync();
  });
  window.addEventListener('message',event=>{
    if(!isMobile() || event.origin!==location.origin || event.source!==frame.contentWindow)return;
    if(event.data?.type!=='she:onepage:page-change')return;
    // After changing pages, bring the beginning of the assessment cards into view.
    scheduleSync();
    window.requestAnimationFrame(()=>{
      const offset=Number(event.data.offset)||0;
      const position=window.scrollY+frame.getBoundingClientRect().top+Math.max(0,offset)-72;
      window.scrollTo({top:Math.max(0,position),behavior:'smooth'});
    });
  });
  try{
    if(frame.contentDocument?.readyState==='complete')bindDocument();
  }catch(_){}
})();
