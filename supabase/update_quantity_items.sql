-- 更新所有需要計次功能的檢核項目

-- 1. 價格牌 - 所有項目都可計次扣分
UPDATE inspection_templates 
SET checklist_items = '[
  {"label": "有無價格牌", "deduction": 1, "requires_quantity": true, "unit": "個商品"},
  {"label": "擺放位置錯誤", "deduction": 2, "requires_quantity": true, "unit": "個商品"},
  {"label": "價格錯誤", "deduction": 2, "requires_quantity": true, "unit": "個商品"}
]'::jsonb
WHERE item_name = '價格牌';

-- 2. 處方章與相關印章 - 所有項目都可計次扣分
UPDATE inspection_templates 
SET checklist_items = '[
  {"label": "流程章未蓋章", "deduction": 2, "requires_quantity": true, "unit": "份"},
  {"label": "管三處方簽客人未簽名", "deduction": 2, "requires_quantity": true, "unit": "份"}
  {"label": "藥師章未蓋", "deduction": 2, "requires_quantity": true, "unit": "份"}
]'::jsonb
WHERE item_name = '處方章與相關印章';

-- 3. 調撥單據 - 未驗收單據（每張 -5 分）
UPDATE inspection_templates 
SET checklist_items = '[
  {"label": "架上商品與昨日帳面庫存不符", "deduction": 3},
  {"label": "未驗收單據（1張-5，請計數）", "deduction": 5, "requires_quantity": true, "unit": "張"}
]'::jsonb
WHERE item_name LIKE '%調撥單據%';

-- 4. 負庫存 - 負庫存品項（每個品項 -2 分）
UPDATE inspection_templates 
SET checklist_items = '[
  {"label": "存在三天以上無法說明原因的負庫存品項（1個-2，請計數）", "deduction": 2, "requires_quantity": true, "unit": "個品項"}
]'::jsonb
WHERE item_name LIKE '%負庫存%';

-- 查詢驗證
SELECT 
  item_name,
  checklist_items
FROM inspection_templates
WHERE item_name IN ('價格牌', '處方章與相關印章') 
   OR item_name LIKE '%調撥單據%'
   OR item_name LIKE '%負庫存%'
ORDER BY section_order, item_order;
