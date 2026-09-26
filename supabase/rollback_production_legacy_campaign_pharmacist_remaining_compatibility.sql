-- Rollback P1-H Production legacy campaign / pharmacist / stockout / bonus compatibility schema.
-- DEV rollback only. Do not run against Production.

DROP TABLE IF EXISTS public.store_performance CASCADE;
DROP TABLE IF EXISTS public.talent_cultivation_bonus CASCADE;
DROP TABLE IF EXISTS public.support_staff_bonus CASCADE;
DROP TABLE IF EXISTS public.spring_festival_bonus CASCADE;
DROP TABLE IF EXISTS public.meal_allowance_records CASCADE;
DROP TABLE IF EXISTS public.stockout_product_response_history CASCADE;
DROP TABLE IF EXISTS public.stockout_product_responses CASCADE;
DROP TABLE IF EXISTS public.stockout_reports CASCADE;
DROP TABLE IF EXISTS public.pharmacist_snapshot_locks CASCADE;
DROP TABLE IF EXISTS public.pharmacist_monthly_snapshot_sync_log CASCADE;
DROP TABLE IF EXISTS public.pharmacist_monthly_snapshot CASCADE;
DROP TABLE IF EXISTS public.pharmacist_annual_master_sync_log CASCADE;
DROP TABLE IF EXISTS public.pharmacist_annual_master_locks CASCADE;
DROP TABLE IF EXISTS public.pharmacist_annual_fees CASCADE;
DROP TABLE IF EXISTS public.pharmacist_annual_master CASCADE;
DROP TABLE IF EXISTS public.pharmacist_profiles CASCADE;
DROP TABLE IF EXISTS public.store_activity_settings CASCADE;
DROP TABLE IF EXISTS public.event_dates CASCADE;
DROP TABLE IF EXISTS public.campaign_department_publish CASCADE;
DROP TABLE IF EXISTS public.campaign_checklist_completions CASCADE;
DROP TABLE IF EXISTS public.campaign_checklist_items CASCADE;
DROP TABLE IF EXISTS public.campaign_equipment_trips CASCADE;
DROP TABLE IF EXISTS public.campaign_support_staff CASCADE;
DROP TABLE IF EXISTS public.campaign_support_requests CASCADE;
DROP TABLE IF EXISTS public.campaign_store_own_staff CASCADE;
DROP TABLE IF EXISTS public.campaign_store_headcount CASCADE;
DROP TABLE IF EXISTS public.campaign_store_details CASCADE;
DROP TABLE IF EXISTS public.campaign_schedules CASCADE;
DROP TABLE IF EXISTS public.campaigns CASCADE;

DROP FUNCTION IF EXISTS public.p1h_sync_stockout_report_status();
DROP FUNCTION IF EXISTS public.p1h_set_updated_at();

-- Keep public.update_updated_at_column(); legacy parity batches and app modules share it.
