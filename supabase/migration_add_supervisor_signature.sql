-- =====================================================
-- 新增督導簽名欄位
-- =====================================================
-- 說明: 分離「店長/當班主管確認簽名」和「督導簽名」
--   signature_photo_url = 店長/當班主管確認簽名
--   supervisor_signature_url = 督導簽名（新增）
-- =====================================================

ALTER TABLE inspection_masters 
  ADD COLUMN IF NOT EXISTS supervisor_signature_url TEXT;

COMMENT ON COLUMN inspection_masters.supervisor_signature_url IS '督導簽名 base64 圖片';
