-- ============================================================
-- General Affairs Resource Attachment Helper Grants Forward Fix
--
-- Reason:
--   RLS policies on ga_resource_attachments call can_read/can_manage
--   as the authenticated user. Without EXECUTE grants, metadata
--   SELECT / INSERT fails with permission denied for function.
--
-- Scope:
--   - Grant authenticated EXECUTE on visibility/manage helper functions.
--   - Do not grant anon.
--   - Do not change policies, tables, storage, or existing RPC logic.
-- ============================================================

DO $$
BEGIN
  IF to_regprocedure('public.ga_resource_attachment_can_read(text, uuid)') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite: public.ga_resource_attachment_can_read(text, uuid)';
  END IF;

  IF to_regprocedure('public.ga_resource_attachment_can_manage(text, uuid)') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite: public.ga_resource_attachment_can_manage(text, uuid)';
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.ga_resource_attachment_can_read(TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ga_resource_attachment_can_manage(TEXT, UUID) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.ga_resource_attachment_can_read(TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga_resource_attachment_can_manage(TEXT, UUID) TO authenticated;
