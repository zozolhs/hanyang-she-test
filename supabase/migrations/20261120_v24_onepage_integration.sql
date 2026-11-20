-- TEST ONLY. One-page is a separate protected data domain under SAFETY.
-- Existing risk assessment store rows are never modified.
BEGIN;
CREATE TABLE IF NOT EXISTS public.she_v24_onepage_state (
  id text PRIMARY KEY CHECK (id = 'main'),
  payload jsonb NOT NULL CHECK(jsonb_typeof(payload) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS public.she_v24_onepage_history (
  revision_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id uuid NOT NULL,
  previous_payload jsonb NOT NULL,
  previous_updated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS public.she_v24_onepage_photos (
  id text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 100),
  row_id text NOT NULL CHECK (length(row_id) BETWEEN 1 AND 100),
  taken_at bigint NOT NULL,
  caption text NOT NULL DEFAULT '',
  filename text NOT NULL DEFAULT '',
  width integer NOT NULL DEFAULT 0,
  height integer NOT NULL DEFAULT 0,
  mime_type text NOT NULL DEFAULT 'image/jpeg' CHECK (mime_type IN ('image/jpeg','image/png','image/webp')),
  photo_data_url text NOT NULL,
  thumbnail_data_url text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.she_v24_onepage_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.she_v24_onepage_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.she_v24_onepage_photos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.she_v24_onepage_state, public.she_v24_onepage_history, public.she_v24_onepage_photos FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.she_v24_onepage_history_revision_id_seq FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.she_v24_onepage_state TO service_role;
GRANT SELECT, INSERT ON public.she_v24_onepage_history TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.she_v24_onepage_photos TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.she_v24_onepage_history_revision_id_seq TO service_role;
-- Preserve uploaded ONE-PAGE records only if this state row has never been created.
INSERT INTO public.she_v24_onepage_state(id,payload)
-- The user's 28 uploaded records were imported privately to HANYANG-SHE-TEST.
-- Do NOT publish those named records in public GitHub source files.
-- Fresh environments receive an empty starter row and require a private import.
VALUES ('main', '{"rows":[],"extraMonths":[]}'::jsonb)
ON CONFLICT(id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.she_v24_onepage_cas(
  p_actor uuid,p_expected_at timestamptz,p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = ''
AS $function$
DECLARE previous_record public.she_v24_onepage_state%ROWTYPE;
        next_at timestamptz;
BEGIN
  IF p_actor IS NULL OR p_expected_at IS NULL OR jsonb_typeof(p_payload)<>'object'
    OR jsonb_typeof(p_payload->'rows')<>'array'
    OR jsonb_array_length(p_payload->'rows')>10000
    OR pg_catalog.octet_length(p_payload::text)>1100000
  THEN RETURN jsonb_build_object('status','invalid'); END IF;
  SELECT * INTO previous_record FROM public.she_v24_onepage_state
    WHERE id='main' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','not_found'); END IF;
  IF previous_record.updated_at IS DISTINCT FROM p_expected_at
    THEN RETURN jsonb_build_object('status','conflict'); END IF;

  INSERT INTO public.she_v24_onepage_history(actor_id,previous_payload,previous_updated_at)
    VALUES(p_actor,previous_record.payload,previous_record.updated_at);

  UPDATE public.she_v24_onepage_state
    SET payload=p_payload,
        updated_at=GREATEST(clock_timestamp(),previous_record.updated_at+interval '1 microsecond')
    WHERE id='main' RETURNING updated_at INTO next_at;
  RETURN jsonb_build_object('status','ok','updated_at',next_at);
END;
$function$;
REVOKE ALL ON FUNCTION public.she_v24_onepage_cas(uuid,timestamptz,jsonb)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.she_v24_onepage_cas(uuid,timestamptz,jsonb) TO service_role;
COMMIT;
