DO $$
BEGIN
  IF to_regprocedure('private.current_profile_id()') IS NULL THEN
    RAISE EXCEPTION
      'private.current_profile_id() is required before exposing the application identity boundary';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.current_profile_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT private.current_profile_id();
$function$;

COMMENT ON FUNCTION public.current_profile_id() IS
  'Returns the stable TINDIO profile UUID for the current authenticated identity.';

REVOKE ALL
ON FUNCTION public.current_profile_id()
FROM PUBLIC;

REVOKE ALL
ON FUNCTION public.current_profile_id()
FROM anon;

REVOKE ALL
ON FUNCTION public.current_profile_id()
FROM service_role;

GRANT EXECUTE
ON FUNCTION public.current_profile_id()
TO authenticated;
