-- 行銷部圖檔改為 Storage + URL/path：新增 JSON 欄位儲存路徑與檔名
ALTER TABLE campaign_department_publish
  ADD COLUMN IF NOT EXISTS marketing_image_paths JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS marketing_image_names JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN campaign_department_publish.marketing_image_paths IS '行銷圖檔 Storage 物件路徑陣列';
COMMENT ON COLUMN campaign_department_publish.marketing_image_names IS '行銷圖檔原始檔名陣列';

-- 建立行銷部圖檔 bucket（private）
INSERT INTO storage.buckets (id, name, public)
VALUES ('campaign-department-assets', 'campaign-department-assets', false)
ON CONFLICT (id) DO NOTHING;

-- 若需限制讀寫權限，請依專案權限模型在 storage.objects 建立對應 RLS policy。
