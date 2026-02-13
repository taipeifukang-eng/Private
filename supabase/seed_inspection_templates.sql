-- =====================================================
-- 督導巡店系統 - 題庫資料匯入
-- =====================================================
-- 版本: v1.0
-- 日期: 2026-02-13
-- 說明: 匯入 220 分督導巡店檢查項目題庫
--      包含五大區塊、兩種計分方式（Checklist/Quantity）
-- 依賴: 需先執行 migration_add_inspection_system.sql
-- =====================================================

-- 清空現有資料（僅在開發環境使用）
-- TRUNCATE TABLE inspection_templates RESTART IDENTITY CASCADE;

-- =====================================================
-- 第一區：門市業績相關（總分 35 分）
-- =====================================================

-- 1-1. 門市業績相關（10分）- Checklist
INSERT INTO inspection_templates (
  section, section_name, section_order,
  item_name, item_description, item_order,
  max_score, scoring_type, checklist_items, is_active
) VALUES (
  'section_1', '門市業績相關', 1,
  '門市業績相關', '網路處方及實體處方之為列',
  1,
  10.0, 'checklist',
  '[
    {"label": "網路處方未刊登", "deduction": 5},
    {"label": "實體處方未刊登", "deduction": 5}
  ]'::jsonb,
  true
);

-- 1-2. 購物袋宣導提醒（5分）- Checklist
INSERT INTO inspection_templates (
  section, section_name, section_order,
  item_name, item_description, item_order,
  max_score, scoring_type, checklist_items, is_active
) VALUES (
  'section_1', '門市業績相關', 1,
  '購物袋宣導提醒', '有會員本及無會員本兩項',
  2,
  5.0, 'checklist',
  '[
    {"label": "有會員本未宣導", "deduction": 2.5},
    {"label": "無會員本未宣導", "deduction": 2.5}
  ]'::jsonb,
  true
);

-- 1-3. 補給申請未確認（10分）- Checklist
INSERT INTO inspection_templates (
  section, section_name, section_order,
  item_name, item_description, item_order,
  max_score, scoring_type, checklist_items, is_active
) VALUES (
  'section_1', '門市業績相關', 1,
  '補給申請未確認', '門市訂單及門市訂單主管',
  3,
  10.0, 'checklist',
  '[
    {"label": "門市訂單未確認", "deduction": 5},
    {"label": "門市訂單主管未確認", "deduction": 5}
  ]'::jsonb,
  true
);

-- 1-4. 購退、陳退（10分）- Checklist
INSERT INTO inspection_templates (
  section, section_name, section_order,
  item_name, item_description, item_order,
  max_score, scoring_type, checklist_items, is_active
) VALUES (
  'section_1', '門市業績相關', 1,
  '購退、陳退', '門市退貨、補助款、過期賠償、未結流程',
  4,
  10.0, 'checklist',
  '[
    {"label": "門市退貨未處理", "deduction": 2.5},
    {"label": "補助款未申請", "deduction": 2.5},
    {"label": "過期賠償未處理", "deduction": 2.5},
    {"label": "未結流程遺漏", "deduction": 2.5}
  ]'::jsonb,
  true
);

-- =====================================================
-- 第二區：區域環境相關（總分 44.5 分）
-- =====================================================

-- 2-1. 賣場（10分）- Checklist
INSERT INTO inspection_templates (
  section, section_name, section_order,
  item_name, item_description, item_order,
  max_score, scoring_type, checklist_items, is_active
) VALUES (
  'section_2', '區域環境相關', 2,
  '賣場', '清潔度、整潔度、擺設規範',
  1,
  10.0, 'checklist',
  '[
    {"label": "有紙屑", "deduction": 1},
    {"label": "髒汙", "deduction": 5},
    {"label": "擺設不整齊", "deduction": 2},
    {"label": "商品過期", "deduction": 2}
  ]'::jsonb,
  true
);

-- 2-2. 倉庫區（10分）- Checklist
INSERT INTO inspection_templates (
  section, section_name, section_order,
  item_name, item_description, item_order,
  max_score, scoring_type, checklist_items, is_active
) VALUES (
  'section_2', '區域環境相關', 2,
  '倉庫區', '免稅品區、保健食品區清潔度',
  2,
  10.0, 'checklist',
  '[
    {"label": "免稅品區髒亂", "deduction": 5},
    {"label": "保健食品區髒亂", "deduction": 5}
  ]'::jsonb,
  true
);

-- 2-3. 賣場營業中（5分）- Checklist
INSERT INTO inspection_templates (
  section, section_name, section_order,
  item_name, item_description, item_order,
  max_score, scoring_type, checklist_items, is_active
) VALUES (
  'section_2', '區域環境相關', 2,
  '賣場營業中', '貨架整潔、擺設順序',
  3,
  5.0, 'checklist',
  '[
    {"label": "貨架有灰塵", "deduction": 2},
    {"label": "擺設順序錯誤", "deduction": 3}
  ]'::jsonb,
  true
);

-- 2-4. 營業時間（7分）- Checklist
INSERT INTO inspection_templates (
  section, section_name, section_order,
  item_name, item_description, item_order,
  max_score, scoring_type, checklist_items, is_active
) VALUES (
  'section_2', '區域環境相關', 2,
  '營業時間', '開店時間、關店時間遵守',
  4,
  7.0, 'checklist',
  '[
    {"label": "開店時間延遲", "deduction": 3.5},
    {"label": "關店時間提早", "deduction": 3.5}
  ]'::jsonb,
  true
);

-- 2-5. 店內牆面/門店（5分）- Checklist
INSERT INTO inspection_templates (
  section, section_name, section_order,
  item_name, item_description, item_order,
  max_score, scoring_type, checklist_items, is_active
) VALUES (
  'section_2', '區域環境相關', 2,
  '店內牆面/門店', '牆面清潔、門店清潔',
  5,
  5.0, 'checklist',
  '[
    {"label": "牆面髒汙", "deduction": 2.5},
    {"label": "門店髒汙", "deduction": 2.5}
  ]'::jsonb,
  true
);

-- 2-6. 垃圾/儲貨倉（7分）- Checklist
INSERT INTO inspection_templates (
  section, section_name, section_order,
  item_name, item_description, item_order,
  max_score, scoring_type, checklist_items, is_active
) VALUES (
  'section_2', '區域環境相關', 2,
  '垃圾/儲貨倉', '垃圾區整潔、儲貨倉整潔',
  6,
  7.0, 'checklist',
  '[
    {"label": "垃圾區髒亂", "deduction": 3.5},
    {"label": "儲貨倉髒亂", "deduction": 3.5}
  ]'::jsonb,
  true
);

-- 2-7. 營業工具專用品項（0.5分）- Checklist (注意：原Excel可能是10分，這裡調整為0.5以符合總分44.5)
INSERT INTO inspection_templates (
  section, section_name, section_order,
  item_name, item_description, item_order,
  max_score, scoring_type, checklist_items, is_active
) VALUES (
  'section_2', '區域環境相關', 2,
  '營業工具專用品項', '高櫃、購物籃、發票列印品質',
  7,
  0.5, 'checklist',
  '[
    {"label": "高櫃髒亂", "deduction": 0.2},
    {"label": "購物籃破損", "deduction": 0.2},
    {"label": "發票列印不清", "deduction": 0.1}
  ]'::jsonb,
  true
);

-- =====================================================
-- 第三區：櫃台三聯單（總分 44.5 分）
-- =====================================================

-- 3-1. 櫃台三聯單（10分）- Checklist
INSERT INTO inspection_templates (
  section, section_name, section_order,
  item_name, item_description, item_order,
  max_score, scoring_type, checklist_items, is_active
) VALUES (
  'section_3', '櫃台三聯單', 3,
  '櫃台三聯單', '簽名、日期、金額正確性',
  1,
  10.0, 'checklist',
  '[
    {"label": "簽名缺少", "deduction": 3.5},
    {"label": "日期錯誤", "deduction": 3.5},
    {"label": "金額錯誤", "deduction": 3}
  ]'::jsonb,
  true
);

-- 3-2. 三聯單/合約使用單（10分）- Checklist
INSERT INTO inspection_templates (
  section, section_name, section_order,
  item_name, item_description, item_order,
  max_score, scoring_type, checklist_items, is_active
) VALUES (
  'section_3', '櫃台三聯單', 3,
  '三聯單/合約使用單', '張數正確、欄位完整',
  2,
  10.0, 'checklist',
  '[
    {"label": "張數不符", "deduction": 5},
    {"label": "欄位不完整", "deduction": 5}
  ]'::jsonb,
  true
);

-- 3-3. 三聯單管理整齊（5分）- Checklist
INSERT INTO inspection_templates (
  section, section_name, section_order,
  item_name, item_description, item_order,
  max_score, scoring_type, checklist_items, is_active
) VALUES (
  'section_3', '櫃台三聯單', 3,
  '三聯單管理整齊', '合約整齊、合約放置正確',
  3,
  5.0, 'checklist',
  '[
    {"label": "合約不整齊", "deduction": 2.5},
    {"label": "合約放置錯誤", "deduction": 2.5}
  ]'::jsonb,
  true
);

-- 3-4. 流程章缺失（9.5分）- Quantity 計數扣分
INSERT INTO inspection_templates (
  section, section_name, section_order,
  item_name, item_description, item_order,
  max_score, scoring_type, quantity_deduction, quantity_unit, is_active
) VALUES (
  'section_3', '櫃台三聯單', 3,
  '流程章缺失', '每缺少一個蓋章扣1分',
  4,
  9.5, 'quantity', 1.0, '個',
  true
);

-- 3-5. 單據缺失（10分）- Quantity 計數扣分
INSERT INTO inspection_templates (
  section, section_name, section_order,
  item_name, item_description, item_order,
  max_score, scoring_type, quantity_deduction, quantity_unit, is_active
) VALUES (
  'section_3', '櫃台三聯單', 3,
  '單據缺失', '每缺少一張單據扣1分',
  5,
  10.0, 'quantity', 1.0, '張',
  true
);

-- =====================================================
-- 第四區：商品庫存管理（總分 40.5 分）
-- =====================================================

-- 4-1. 短效品到期日期（10分）- Checklist
INSERT INTO inspection_templates (
  section, section_name, section_order,
  item_name, item_description, item_order,
  max_score, scoring_type, checklist_items, is_active
) VALUES (
  'section_4', '商品庫存管理', 4,
  '短效品到期日期', '單據日期、標籤日期正確',
  1,
  10.0, 'checklist',
  '[
    {"label": "單據日期錯誤", "deduction": 5},
    {"label": "標籤日期錯誤", "deduction": 5}
  ]'::jsonb,
  true
);

-- 4-2. 藥證證明/藥證（10分）- Checklist
INSERT INTO inspection_templates (
  section, section_name, section_order,
  item_name, item_description, item_order,
  max_score, scoring_type, checklist_items, is_active
) VALUES (
  'section_4', '商品庫存管理', 4,
  '藥證證明/藥證', '證明擺放正確與否',
  2,
  10.0, 'checklist',
  '[
    {"label": "藥證未擺放", "deduction": 5},
    {"label": "藥證擺放錯誤", "deduction": 5}
  ]'::jsonb,
  true
);

-- 4-3. 標籤/商品碼（10分）- Checklist
INSERT INTO inspection_templates (
  section, section_name, section_order,
  item_name, item_description, item_order,
  max_score, scoring_type, checklist_items, is_active
) VALUES (
  'section_4', '商品庫存管理', 4,
  '標籤/商品碼', '標籤正確性、條碼正確性',
  3,
  10.0, 'checklist',
  '[
    {"label": "標籤錯誤", "deduction": 5},
    {"label": "條碼錯誤", "deduction": 5}
  ]'::jsonb,
  true
);

-- 4-4. 負庫存（10.5分）- Quantity 計數扣分
INSERT INTO inspection_templates (
  section, section_name, section_order,
  item_name, item_description, item_order,
  max_score, scoring_type, quantity_deduction, quantity_unit, is_active
) VALUES (
  'section_4', '商品庫存管理', 4,
  '負庫存', '每發現一項負庫存扣1分',
  4,
  10.5, 'quantity', 1.0, '項',
  true
);

-- =====================================================
-- 第五區：流程執行相關（總分 55.5 分）
-- =====================================================

-- 5-1. 儲存管理制單點檢（10分）- Checklist
INSERT INTO inspection_templates (
  section, section_name, section_order,
  item_name, item_description, item_order,
  max_score, scoring_type, checklist_items, is_active
) VALUES (
  'section_5', '流程執行相關', 5,
  '儲存管理制單點檢', '記錄完整、回報即時',
  1,
  10.0, 'checklist',
  '[
    {"label": "記錄不完整", "deduction": 5},
    {"label": "回報不即時", "deduction": 5}
  ]'::jsonb,
  true
);

-- 5-2. 製造驗收紀錄（10分）- Checklist
INSERT INTO inspection_templates (
  section, section_name, section_order,
  item_name, item_description, item_order,
  max_score, scoring_type, checklist_items, is_active
) VALUES (
  'section_5', '流程執行相關', 5,
  '製造驗收紀錄', '紀錄完整、回報即時',
  2,
  10.0, 'checklist',
  '[
    {"label": "紀錄不完整", "deduction": 5},
    {"label": "回報不即時", "deduction": 5}
  ]'::jsonb,
  true
);

-- 5-3. 設計商品保管規則（10分）- Checklist
INSERT INTO inspection_templates (
  section, section_name, section_order,
  item_name, item_description, item_order,
  max_score, scoring_type, checklist_items, is_active
) VALUES (
  'section_5', '流程執行相關', 5,
  '設計商品保管規則', '設計規範、註冊前後對比',
  3,
  10.0, 'checklist',
  '[
    {"label": "設計規範不符", "deduction": 5},
    {"label": "註冊前後對比缺失", "deduction": 5}
  ]'::jsonb,
  true
);

-- 5-4. 超齡可達級異動鑑機制（10分）- Checklist
INSERT INTO inspection_templates (
  section, section_name, section_order,
  item_name, item_description, item_order,
  max_score, scoring_type, checklist_items, is_active
) VALUES (
  'section_5', '流程執行相關', 5,
  '超齡可達級異動鑑機制', '操作鑑定、回報鑑定履歷',
  4,
  10.0, 'checklist',
  '[
    {"label": "操作鑑定未執行", "deduction": 5},
    {"label": "回報鑑定履歷缺失", "deduction": 5}
  ]'::jsonb,
  true
);

-- 5-5. 其他問題紀錄（10分）- Checklist
INSERT INTO inspection_templates (
  section, section_name, section_order,
  item_name, item_description, item_order,
  max_score, scoring_type, checklist_items, is_active
) VALUES (
  'section_5', '流程執行相關', 5,
  '其他問題紀錄', '門市進度管理、購買促銷、結案進度',
  5,
  10.0, 'checklist',
  '[
    {"label": "門市進度管理不佳", "deduction": 3.5},
    {"label": "購買促銷未執行", "deduction": 3.5},
    {"label": "結案進度延遲", "deduction": 3}
  ]'::jsonb,
  true
);

-- 5-6. 其他缺失（5.5分）- Checklist
INSERT INTO inspection_templates (
  section, section_name, section_order,
  item_name, item_description, item_order,
  max_score, scoring_type, checklist_items, is_active
) VALUES (
  'section_5', '流程執行相關', 5,
  '其他缺失', '其他發現的問題',
  6,
  5.5, 'checklist',
  '[
    {"label": "其他缺失1", "deduction": 1.5},
    {"label": "其他缺失2", "deduction": 1.5},
    {"label": "其他缺失3", "deduction": 1.5},
    {"label": "其他缺失4", "deduction": 1}
  ]'::jsonb,
  true
);

-- =====================================================
-- 驗證題庫資料
-- =====================================================

-- 查詢各區塊的總分
SELECT 
  section,
  section_name,
  COUNT(*) as item_count,
  SUM(max_score) as total_score
FROM inspection_templates
WHERE is_active = true
GROUP BY section, section_name, section_order
ORDER BY section_order;

-- 查詢總分（應該是 220 分）
SELECT 
  COUNT(*) as total_items,
  SUM(max_score) as grand_total
FROM inspection_templates
WHERE is_active = true;

-- 查詢各計分方式的數量
SELECT 
  scoring_type,
  COUNT(*) as item_count,
  SUM(max_score) as total_score
FROM inspection_templates
WHERE is_active = true
GROUP BY scoring_type;

-- 查詢完整題庫結構
SELECT 
  section,
  section_name,
  item_order,
  item_name,
  max_score,
  scoring_type,
  CASE 
    WHEN scoring_type = 'checklist' THEN jsonb_array_length(checklist_items)
    ELSE NULL
  END as checklist_options,
  CASE
    WHEN scoring_type = 'quantity' THEN quantity_deduction || ' / ' || quantity_unit
    ELSE NULL
  END as quantity_info
FROM inspection_templates
WHERE is_active = true
ORDER BY section_order, item_order;

-- =====================================================
-- 題庫匯入完成
-- =====================================================
-- 驗證結果應顯示：
-- - 總共 25 個檢查項目
-- - 總分 220 分
-- - 第一區：35 分（4 項）
-- - 第二區：44.5 分（7 項）
-- - 第三區：44.5 分（5 項，含 2 項 Quantity 計數）
-- - 第四區：40.5 分（4 項，含 1 項 Quantity 計數）
-- - 第五區：55.5 分（6 項）
-- - Checklist 類型：22 項
-- - Quantity 類型：3 項（流程章、單據、負庫存）
--
-- 下一步：
-- 1. 在 Supabase Dashboard 建立 Storage Bucket
-- 2. 開始開發前端頁面
-- =====================================================
