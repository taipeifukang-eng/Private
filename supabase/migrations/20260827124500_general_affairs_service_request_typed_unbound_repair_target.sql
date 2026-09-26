ALTER TABLE public.ga_service_requests
  DROP CONSTRAINT IF EXISTS ga_service_requests_repair_optional_resource_check;

ALTER TABLE public.ga_service_requests
  ADD CONSTRAINT ga_service_requests_repair_optional_resource_check
  CHECK (
    request_type <> 'REPAIR'
    OR (
      NOT (equipment_id IS NOT NULL AND facility_id IS NOT NULL)
      AND (
        (resource_type IS NULL AND equipment_id IS NULL AND facility_id IS NULL)
        OR (resource_type = 'EQUIPMENT' AND facility_id IS NULL)
        OR (resource_type = 'FACILITY' AND equipment_id IS NULL)
      )
    )
  );

COMMENT ON CONSTRAINT ga_service_requests_repair_optional_resource_check
ON public.ga_service_requests
IS '維修 / 現場狀況回報可先不綁定設備或設施；若知道大類可先標示設備或設施，若有綁定主檔則類型必須一致且只能綁定單一標的。';

NOTIFY pgrst, 'reload schema';
