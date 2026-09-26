-- Rollback: General Affairs Resource Attachments Foundation
-- Removes only Task attachment foundation objects.

DROP POLICY IF EXISTS ga_resource_attachments_storage_service_role_all ON storage.objects;

DROP POLICY IF EXISTS ga_resource_attachments_insert ON public.ga_resource_attachments;
DROP POLICY IF EXISTS ga_resource_attachments_read ON public.ga_resource_attachments;

DROP TRIGGER IF EXISTS trg_ga_resource_attachments_validate ON public.ga_resource_attachments;

DROP FUNCTION IF EXISTS public.ga_soft_delete_resource_attachment(UUID, TEXT);
DROP FUNCTION IF EXISTS public.ga_validate_resource_attachment();
DROP FUNCTION IF EXISTS public.ga_resource_attachment_can_manage(TEXT, UUID);
DROP FUNCTION IF EXISTS public.ga_resource_attachment_can_read(TEXT, UUID);

DROP TABLE IF EXISTS public.ga_resource_attachments;

DELETE FROM storage.buckets
WHERE id = 'general-affairs-attachments'
  AND NOT EXISTS (
    SELECT 1
    FROM storage.objects
    WHERE bucket_id = 'general-affairs-attachments'
  );
