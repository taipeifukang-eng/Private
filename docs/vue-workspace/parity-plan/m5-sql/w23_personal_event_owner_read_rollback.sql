-- M5 W23：撤回「個人行程建立者本人一律可讀」修正（草稿，尚未執行）。還原成只用判斷函式的原規則（migration 20261008100000 的內容）。
-- 用法：整份貼上執行 -> 看核對查詢 -> 另外執行 COMMIT; 或 ROLLBACK;。
BEGIN;
DROP POLICY IF EXISTS organization_personal_calendar_events_read ON public.organization_personal_calendar_events;
CREATE POLICY organization_personal_calendar_events_read
  ON public.organization_personal_calendar_events FOR SELECT TO authenticated
  USING (public.organization_calendar_personal_event_can_view(id));
SELECT policyname, cmd, qual FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'organization_personal_calendar_events' ORDER BY policyname;
-- COMMIT;
-- ROLLBACK;
