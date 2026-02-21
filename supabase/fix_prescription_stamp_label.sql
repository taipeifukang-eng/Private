-- 修正「處方章與相關印章」中的項目名稱
-- 每三處方箋客人未簽名 → 管三處方箋客人未簽名

UPDATE inspection_templates 
SET checklist_items = REPLACE(checklist_items::text, '每三處方箋客人未簽名', '管三處方箋客人未簽名')::jsonb
WHERE item_name = '處方章與相關印章';
