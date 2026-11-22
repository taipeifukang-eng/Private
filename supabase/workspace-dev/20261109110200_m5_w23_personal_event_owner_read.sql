BEGIN;
-- M5 W23：個人行程「新增」在資料庫規則下會失敗。
-- 原因：新增後系統會回讀剛建立的那一列（INSERT ... RETURNING），回讀要通過讀取規則；讀取規則呼叫的檢查函式是 STABLE，
-- 看不到同一個指令剛插入的列，所以擁有者自己的新行程也被擋下，錯誤訊息是 new row violates row-level security policy。
-- 修正：讀取規則多一個「建立者本人一律可讀」的條件（與函式原本對擁有者的判斷相同），其餘分享規則不變。
-- 影響：只有建立者本人的行程；分享、轉分享、撤回的判斷完全沒有改。
DROP POLICY IF EXISTS organization_personal_calendar_events_read ON public.organization_personal_calendar_events;
CREATE POLICY organization_personal_calendar_events_read
  ON public.organization_personal_calendar_events FOR SELECT TO authenticated
  USING (owner_id = auth.uid() OR public.organization_calendar_personal_event_can_view(id));
NOTIFY pgrst, 'reload schema';
COMMIT;
