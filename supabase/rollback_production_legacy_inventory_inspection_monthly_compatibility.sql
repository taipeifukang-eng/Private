-- Rollback P1-F Production legacy inventory result / inspection / monthly status compatibility schema.
-- DEV-only rollback. Do not run in Production.

DROP TABLE IF EXISTS public.monthly_bonus_records;
DROP TABLE IF EXISTS public.monthly_store_summary;
DROP TABLE IF EXISTS public.monthly_staff_status;
DROP TABLE IF EXISTS public.inspection_on_duty_staff;
DROP TABLE IF EXISTS public.inspection_improvements;
DROP TABLE IF EXISTS public.inspection_results;
DROP TABLE IF EXISTS public.inspection_masters;
DROP TABLE IF EXISTS public.inspection_templates;
DROP TABLE IF EXISTS public.inspection_grade_mapping;
DROP TABLE IF EXISTS public.inspection_bonus_config;
DROP TABLE IF EXISTS public.inventory_result_items;
DROP TABLE IF EXISTS public.inventory_result_batches;
DROP TABLE IF EXISTS public.inventory_result_settings;

-- Keep public.update_updated_at_column(); it is shared by P1-E compatibility objects.
