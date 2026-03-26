-- 為 campaign_checklist_completions 新增 store_assigned_person 欄位
-- 讓店長記錄每個 checklist 項目的實際負責人員

ALTER TABLE campaign_checklist_completions
  ADD COLUMN IF NOT EXISTS store_assigned_person text;
