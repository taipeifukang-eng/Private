ALTER TABLE public.ga_resource_attachments
DROP CONSTRAINT IF EXISTS ga_resource_attachments_resource_type_check;

ALTER TABLE public.ga_resource_attachments
ADD CONSTRAINT ga_resource_attachments_resource_type_check
CHECK (resource_type IN (
  'EQUIPMENT', 'FACILITY', 'PART', 'MAINTENANCE_REQUEST',
  'MAINTENANCE_UPDATE', 'SERVICE_REQUEST', 'SERVICE_REQUEST_COMMENT',
  'UTILITY_BILL'
));

NOTIFY pgrst, 'reload schema';
