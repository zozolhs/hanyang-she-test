-- V24-only TEST portal: close legacy Supabase Auth REST/RPC access paths.
-- V24 login and all current business modules use she-v24-auth/store and service_role
-- credentials exclusively on the server. This migration does not change any user,
-- password, role, approval, session or business record.
BEGIN;
-- A leaked old Supabase Auth JWT must not directly read or write the SHE data payload.
REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE public.hanyang_safety_store FROM authenticated;
REVOKE SELECT ON TABLE public.she_profiles FROM authenticated;

-- Superseded direct client RPCs are no longer callable by the legacy authenticated role.
-- Server-side functions retain the service_role EXECUTE grants.
REVOKE EXECUTE ON FUNCTION public.she_admin_set_access(uuid,text,text,jsonb) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.she_confirm_education_v2(text,text,jsonb) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.she_education_roster() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.she_education_roster_v2() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.she_list_users() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.she_my_access() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.she_set_maintenance(boolean) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.she_v23_admin_set_access(uuid,text,text,jsonb) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.she_v23_can_access(text,boolean) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.she_v23_my_access() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.she_v24_can_access(text,boolean) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.she_v24_my_access() FROM authenticated;
COMMIT;
