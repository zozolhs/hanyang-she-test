/* HANYANG SHE | Supabase Auth + RLS verified session | 2026-11-18
 * 이 파일에서 role/permissions는 화면 표현용이다. 데이터 액세스는 서버 RLS에서 강제한다.
 * 로그인 저장소는 sessionStorage만 사용; localStorage 로그인 유지 금지.
 */
(() => {
  'use strict';
  if (window.SHESEC) return;
  const URL = 'https://ahmqthuympannqrszvv.supabase.co';
  const KEY = 'sb_publishable_K7UKB4Kn2wiijlqPBXZL0Q_NOt3frvV';
  const SESSION_KEYS = ['hy_super_admin_verified_v15','hy_admin_verified_session_v15',
    'hy_logged_user_session_v15','hy_health_manager_verified'];
  const MODULES = ['safety','health','roster','education'];
  if (!window.supabase || !window.supabase.createClient) throw new Error('Supabase SDK를 먼저 로드하세요.');
  const client = window.supabase.createClient(URL,KEY,{
    auth: { storage:window.sessionStorage,persistSession:true,autoRefreshToken:true,
      detectSessionInUrl:false,flowType:'pkce' }
  });
  const state = {profile:null,verifiedAt:0,authUid:null,processing:null};
  function uiSync(profile) {
    SESSION_KEYS.forEach(k=>sessionStorage.removeItem(k));
    if (!profile || profile.status!=='approved' || (profile.maintenance && profile.role!=='super_admin')) return;
    const isSuper=profile.role==='super_admin';
    const permission=(name)=>isSuper || (profile.role==='admin' && profile.permissions?.[name]===true);
    sessionStorage.setItem('hy_logged_user_session_v15',JSON.stringify({
      id:profile.id,name:profile.name,role:isSuper?'admin':profile.role,
      status:profile.status,allowed:true,permissions:profile.permissions||{},
      authUid:profile.id
    }));
    if(isSuper) sessionStorage.setItem('hy_super_admin_verified_v15','true');
    if(isSuper||profile.role==='admin') sessionStorage.setItem('hy_admin_verified_session_v15','true');
    if(permission('health')) sessionStorage.setItem('hy_health_manager_verified','true');
  }
  function permit(profile,module) {
    if(!profile||profile.status!=='approved')return false;
    if(profile.maintenance && profile.role!=='super_admin')return false;
    if(profile.role==='super_admin')return true;
    if(module==='safety_view')return true;
    return profile.role==='admin' && MODULES.includes(module) && profile.permissions?.[module]===true;
  }
  async function refresh(force=false){
    if(state.processing)return state.processing;
    if(!force&&state.profile&&Date.now()-state.verifiedAt<12000)return state.profile;
    state.processing=(async()=>{
      try{
        const {data:userData,error:authErr}=await client.auth.getUser();
        if(authErr||!userData?.user)throw new Error('로그인이 필요합니다.');
        const {data,error}=await client.rpc('she_my_access');
        if(error||!data)throw new Error(error?.message||'서버 권한 조회 실패');
        const profile={...data,id:userData.user.id};
        if(data.id && data.id!==userData.user.id)throw new Error('서버 인증 사용자 불일치');
        state.profile=profile;state.authUid=profile.id;state.verifiedAt=Date.now();
        uiSync(profile);
        if(permit(profile,'safety_view')) document.dispatchEvent(new CustomEvent('she:authorized',{detail:profile}));
        return profile;
      }catch(err){state.profile=null;state.authUid=null;state.verifiedAt=0;uiSync(null);throw err;}
    })();
    try{return await state.processing;}finally{state.processing=null;}
  }
  async function guard(module='safety_view',force=true){
    try{
      const profile=await refresh(force);
      return {ok:permit(profile,module),profile,reason:
        profile.maintenance&&profile.role!=='super_admin'?'maintenance':
        profile.status!=='approved'?'not-approved':'forbidden'};
    }catch(error){return {ok:false,profile:null,reason:'login',error};}
  }
  async function login(email,password){
    const {error}=await client.auth.signInWithPassword({email,password});
    if(error)throw error;
    return await refresh(true);
  }
  async function register(email,password,display_name,department){
    const {data,error}=await client.auth.signUp({email,password,
      options:{data:{display_name,department}}});
    if(error)throw error;
    return data;
  }
  async function logout(){
    try{await client.auth.signOut({scope:'local'});}finally{
      state.profile=null;state.verifiedAt=0;uiSync(null);
      for(const k of ['hy_admin_custom_pw_v4','hanyang_authorized_users'])localStorage.removeItem(k);
    }
  }
  async function users(){
    const check=await guard('safety_view');
    if(!check.ok||check.profile.role!=='super_admin')throw new Error('최고관리자만 인원 관리를 이용할 수 있습니다.');
    const {data,error}=await client.rpc('she_list_users');
    if(error)throw error;return Array.isArray(data)?data:[];
  }
  async function setUser(id,role,status,permissions){
    const check=await guard('safety_view');
    if(!check.ok||check.profile.role!=='super_admin')throw new Error('최고관리자 권한이 필요합니다.');
    const {error}=await client.rpc('she_admin_set_access',{
      p_user_id:id,p_role:role,p_status:status,p_permissions:permissions
    });
    if(error)throw error;
  }
  async function maintenance(enabled){
    const check=await guard('safety_view');
    if(!check.ok||check.profile.role!=='super_admin')throw new Error('최고관리자 권한이 필요합니다.');
    const {error}=await client.rpc('she_set_maintenance',{p_enabled:!!enabled});
    if(error)throw error;return refresh(true);
  }
  window.SHESEC=Object.freeze({client,guard,refresh,login,register,logout,users,setUser,
    maintenance,permit,get profile(){return state.profile;},
    onReadyFor:async module=>(await guard(module,true)).ok});
})();
