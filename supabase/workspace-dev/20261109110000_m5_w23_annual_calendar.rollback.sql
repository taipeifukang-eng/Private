BEGIN;
-- 回復 M5 W23：移除年度行事曆資料表、函式與 trigger（連同表內所有資料，只在 DEV 使用；請先執行 W24 的 rollback）。
-- 權限碼 organization.calendar.company.create／edit／holiday.manage 在 W23 之前 DEV 就已存在，不刪除。
DROP FUNCTION IF EXISTS public.organization_calendar_publish_holiday_import(integer, text, text, text, jsonb);
DROP TABLE IF EXISTS public.organization_calendar_holidays;
DROP TABLE IF EXISTS public.organization_calendar_holiday_imports;
DROP FUNCTION IF EXISTS public.organization_calendar_validate_holiday_year();
DROP FUNCTION IF EXISTS public.organization_calendar_prepare_holiday_import();
DROP TABLE IF EXISTS public.organization_personal_calendar_event_shares;
DROP FUNCTION IF EXISTS public.organization_calendar_share_personal_event(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.organization_calendar_revoke_personal_event_share(uuid);
DROP TABLE IF EXISTS public.organization_personal_calendar_events;
DROP FUNCTION IF EXISTS public.organization_calendar_personal_event_user_can_view(uuid, uuid);
DROP FUNCTION IF EXISTS public.organization_calendar_personal_event_can_view(uuid);
DROP FUNCTION IF EXISTS public.organization_calendar_personal_event_is_owner(uuid);
DROP FUNCTION IF EXISTS public.organization_calendar_touch_personal_event();
DROP TABLE IF EXISTS public.organization_calendar_event_audit;
DROP TABLE IF EXISTS public.organization_calendar_events;
DROP FUNCTION IF EXISTS public.organization_calendar_prepare_event_write();
DROP FUNCTION IF EXISTS public.organization_calendar_audit_event_write();
NOTIFY pgrst, 'reload schema';
COMMIT;
