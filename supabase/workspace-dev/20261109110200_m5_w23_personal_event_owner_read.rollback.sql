BEGIN;
-- 回復 M5 W23：讀取規則還原成只用檢查函式（個人行程新增會再度因回讀失敗）。
DROP POLICY IF EXISTS organization_personal_calendar_events_read ON public.organization_personal_calendar_events;
CREATE POLICY organization_personal_calendar_events_read
  ON public.organization_personal_calendar_events FOR SELECT TO authenticated
  USING (public.organization_calendar_personal_event_can_view(id));
NOTIFY pgrst, 'reload schema';
COMMIT;
