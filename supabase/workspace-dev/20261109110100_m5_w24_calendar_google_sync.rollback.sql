BEGIN;
-- 回復 M5 W24：移除 Google 同步的兩張表，以及公司行事與個人行程多出來的時間／地點欄位與檢查。
-- 權限碼 organization.calendar.google.manage 在 W24 之前 DEV 就已存在，不刪除。
DROP TABLE IF EXISTS public.organization_calendar_google_event_links;
DROP TABLE IF EXISTS public.organization_calendar_google_connections;
ALTER TABLE public.organization_calendar_events DROP CONSTRAINT IF EXISTS organization_calendar_events_time_check;
ALTER TABLE public.organization_personal_calendar_events DROP CONSTRAINT IF EXISTS organization_personal_calendar_events_time_check;
ALTER TABLE public.organization_calendar_events DROP CONSTRAINT IF EXISTS organization_calendar_events_location_check;
ALTER TABLE public.organization_personal_calendar_events DROP CONSTRAINT IF EXISTS organization_personal_calendar_events_location_check;
ALTER TABLE public.organization_calendar_events DROP COLUMN IF EXISTS is_all_day, DROP COLUMN IF EXISTS start_time, DROP COLUMN IF EXISTS end_time, DROP COLUMN IF EXISTS location;
ALTER TABLE public.organization_personal_calendar_events DROP COLUMN IF EXISTS is_all_day, DROP COLUMN IF EXISTS start_time, DROP COLUMN IF EXISTS end_time, DROP COLUMN IF EXISTS location;
NOTIFY pgrst, 'reload schema';
COMMIT;
