-- =====================================================
-- 新增店長備註欄位到 campaign_checklist_completions
--
-- 【功能】
-- 店長可在前置 Check List 的每個項目填寫備註，
-- 作為完成進度的回報與記錄
-- =====================================================

ALTER TABLE campaign_checklist_completions
  ADD COLUMN IF NOT EXISTS manager_note TEXT;

-- 驗證
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'campaign_checklist_completions'
ORDER BY ordinal_position;
