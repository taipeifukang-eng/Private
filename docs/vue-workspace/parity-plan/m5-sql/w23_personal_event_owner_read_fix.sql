-- 已於 2026-11-09 在正式區套用（使用者自行執行並驗證個人行程可儲存），不要再放進上線執行清單。以下為原草稿，僅供留存。
-- M5 W23：個人行程「建立者本人一律可讀」的修正（草稿，尚未執行；需要寫入，請使用者審閱後自行執行）。
-- 背景見 w23_calendar_schema_probe.sql 第 2 段：先執行那份唯讀探測，確認正式區的讀取規則真的只有函式判斷（沒有 owner_id = auth.uid()），再決定要不要套這個修正。
-- DEV 已套用同樣的修正（supabase/workspace-dev/20261109110200_m5_w23_personal_event_owner_read.sql），套用後新增個人行程恢復正常。
-- 這個修正只讓建立者本人一律讀得到自己的行程；分享、轉分享、撤回的判斷完全沒有改。
-- 用法：整份貼上執行 -> 看最後的核對查詢 -> 沒問題另外執行 COMMIT; 有疑慮執行 ROLLBACK;。
-- 撤回：w23_personal_event_owner_read_rollback.sql。

BEGIN;

-- 備份：把目前的規則內容存起來（還原時對照用）
CREATE TABLE IF NOT EXISTS m5_w23_policy_backup AS
SELECT now() AS backed_up_at, policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'organization_personal_calendar_events' AND policyname = 'organization_personal_calendar_events_read';
-- 備份表不外露：開啟 RLS 並收回 anon／authenticated（service role 與 postgres 仍可讀）
ALTER TABLE m5_w23_policy_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON m5_w23_policy_backup FROM anon, authenticated;

-- 預覽：目前規則
SELECT policyname, cmd, qual FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'organization_personal_calendar_events' AND policyname = 'organization_personal_calendar_events_read';

DROP POLICY IF EXISTS organization_personal_calendar_events_read ON public.organization_personal_calendar_events;
CREATE POLICY organization_personal_calendar_events_read
  ON public.organization_personal_calendar_events FOR SELECT TO authenticated
  USING (owner_id = auth.uid() OR public.organization_calendar_personal_event_can_view(id));

-- 核對：應只有一條讀取規則，內容含 owner_id = auth.uid()
SELECT policyname, cmd, qual FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'organization_personal_calendar_events' ORDER BY policyname;

-- COMMIT;
-- ROLLBACK;
