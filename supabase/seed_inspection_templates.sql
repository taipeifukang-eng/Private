-- =====================================================
-- 督導巡店系統 - 題庫資料匯入
-- =====================================================
-- 版本: v2.0
-- 日期: 2026-02-13
-- 說明: 匯入 220 分督導巡店檢查項目題庫（根據實際 Excel）
--      包含五大區塊、兩種計分方式（Checklist/Quantity）
-- 依賴: 需先執行 migration_add_inspection_system.sql
-- =====================================================
-- 五大區塊：
-- 1. 門口外圍（35分）- 6項
-- 2. 店內環境與陳列（50分）- 7項
-- 3. 櫃檯區與倉庫（45分）- 6項
-- 4. 人員管理（40分）- 3項
-- 5. 處方作業與行政（50分）- 5項
-- =====================================================

-- 清空現有資料（僅在開發環境使用）
TRUNCATE TABLE inspection_templates RESTART IDENTITY CASCADE;

-- =====================================================
-- 第一區：門口外圍（總分 35 分）
-- =====================================================

-- 1-1. 門口外圍地板（5分）
INSERT INTO inspection_templates (
  section, section_name, section_order,
  item_name, item_description, item_order,
  max_score, scoring_type, checklist_items, is_active
) VALUES (
  'section_1', '門口外圍', 1,
  '門口外圍地板', '藥局給客人門面的乾淨度',
  1,
  5.0, 'checklist',
  '[
    {"label": "有紙屑垃圾", "deduction": 1},
    {"label": "堆放雜物/空箱", "deduction": 2},
    {"label": "地面明顯污漬", "deduction": 5}
  ]'::jsonb,
  true
);

-- 1-2. 陳列架/落地箱（5分）
INSERT INTO inspection_templates (
  section, section_name, section_order,
  item_name, item_description, item_order,
  max_score, scoring_type, checklist_items, is_active
) VALUES (
  'section_1', '門口外圍', 1,
  '陳列架/落地箱', '有賣百貨是否注意齊全度',
  2,
  5.0, 'checklist',
  '[
    {"label": "超過1/2商品未補齊", "deduction": 2},
    {"label": "超過1/2商品陳列混亂", "deduction": 2},
    {"label": "層架有陳年的髒污", "deduction": 2}
  ]'::jsonb,
  true
);

-- 1-3. 玻璃門與警示標語（10分）
INSERT INTO inspection_templates (
  section, section_name, section_order,
  item_name, item_description, item_order,
  max_score, scoring_type, checklist_items, is_active
) VALUES (
  'section_1', '門口外圍', 1,
  '玻璃門與警示標語', '門市透視度',
  3,
  10.0, 'checklist',
  '[
    {"label": "玻璃有指印/髒污", "deduction": 1},
    {"label": "過期的海報張貼", "deduction": 2},
    {"label": "未張貼警示標語", "deduction": 5},
    {"label": "未經允許張貼在腰線以上的海報", "deduction": 2}
  ]'::jsonb,
  true
);

-- 1-4. 布條、招牌（日）（5分）
INSERT INTO inspection_templates (
  section, section_name, section_order,
  item_name, item_description, item_order,
  max_score, scoring_type, checklist_items, is_active
) VALUES (
  'section_1', '門口外圍', 1,
  '布條、招牌（日）', '布條呈現的完整性與招牌注意',
  4,
  5.0, 'checklist',
  '[
    {"label": "傾斜/未拉平", "deduction": 3},
    {"label": "破損/脫落", "deduction": 5},
    {"label": "招牌破損未報修", "deduction": 2}
  ]'::jsonb,
  true
);

-- 1-5. 直招、橫招（夜）（5分）
INSERT INTO inspection_templates (
  section, section_name, section_order,
  item_name, item_description, item_order,
  max_score, scoring_type, checklist_items, is_active
) VALUES (
  'section_1', '門口外圍', 1,
  '直招、橫招（夜）', '招牌注意',
  5,
  5.0, 'checklist',
  '[
    {"label": "直招應開而未開燈", "deduction": 3},
    {"label": "直招已開但燈有毀損未報修", "deduction": 1},
    {"label": "橫招應開而未開燈", "deduction": 3},
    {"label": "橫招已開但燈有毀損未報修", "deduction": 1},
    {"label": "藥字燈應開而未開燈", "deduction": 3},
    {"label": "藥字燈已開但燈有毀損未報修", "deduction": 1}
  ]'::jsonb,
  true
);

-- 1-6. 地滑立牌（5分）
INSERT INTO inspection_templates (
  section, section_name, section_order,
  item_name, item_description, item_order,
  max_score, scoring_type, checklist_items, is_active
) VALUES (
  'section_1', '門口外圍', 1,
  '地滑立牌', '如雨天未擺放導致客人摔倒，會有民事侵權行為賠償責任，嚴重時亦可能涉及刑事過失傷害罪',
  6,
  5.0, 'checklist',
  '[
    {"label": "未放置於顯眼處", "deduction": 2},
    {"label": "損壞", "deduction": 2},
    {"label": "應放而未放", "deduction": 5},
    {"label": "員工不清楚沒下雨時立牌放在哪", "deduction": 3}
  ]'::jsonb,
  true
);

-- =====================================================
-- 第二區：店內環境與陳列（總分 50 分）
-- =====================================================

-- 2-1. 價格牌*（10分）- 混合型Checklist + Quantity說明
INSERT INTO inspection_templates (
  section, section_name, section_order,
  item_name, item_description, item_order,
  max_score, scoring_type, checklist_items, is_active
) VALUES (
  'section_2', '店內環境與陳列', 2,
  '價格牌', '客人對於品牌販售價格誠信。擺放位置錯誤1個商品-2（請在改善建議中註明數量）',
  1,
  10.0, 'checklist',
  '[
    {"label": "漏價卡", "deduction": 2},
    {"label": "價格與系統不符", "deduction": 5},
    {"label": "擺放位置錯誤（1個商品-2，請計數）", "deduction": 2}
  ]'::jsonb,
  true
);

-- 2-2. 貨架清潔（10分）
INSERT INTO inspection_templates (
  section, section_name, section_order,
  item_name, item_description, item_order,
  max_score, scoring_type, checklist_items, is_active
) VALUES (
  'section_2', '店內環境與陳列', 2,
  '貨架清潔', '影響客人購物體驗與對我們的觀感',
  2,
  10.0, 'checklist',
  '[
    {"label": "層板有明顯1周以上的積塵", "deduction": 2},
    {"label": "護欄明顯有1周以上的髒污", "deduction": 1},
    {"label": "有蜘蛛網", "deduction": 5}
  ]'::jsonb,
  true
);

-- 2-3. 架上商品清潔（5分）
INSERT INTO inspection_templates (
  section, section_name, section_order,
  item_name, item_description, item_order,
  max_score, scoring_type, checklist_items, is_active
) VALUES (
  'section_2', '店內環境與陳列', 2,
  '架上商品清潔', '影響客人購物體驗與對我們的觀感',
  3,
  5.0, 'checklist',
  '[
    {"label": "有明顯瓶身灰塵", "deduction": 1},
    {"label": "包裝褪色/損壞未回報處理", "deduction": 2},
    {"label": "漏液/髒污", "deduction": 5}
  ]'::jsonb,
  true
);

-- 2-4. 架上商品庫存（5分）
INSERT INTO inspection_templates (
  section, section_name, section_order,
  item_name, item_description, item_order,
  max_score, scoring_type, checklist_items, is_active
) VALUES (
  'section_2', '店內環境與陳列', 2,
  '架上商品庫存', '影響銷售量',
  4,
  5.0, 'checklist',
  '[
    {"label": "缺貨未插牌", "deduction": 2},
    {"label": "補貨不及時(有後庫無前架)", "deduction": 3}
  ]'::jsonb,
  true
);

-- 2-5. 商品先進先出 (FIFO)*（5分）
INSERT INTO inspection_templates (
  section, section_name, section_order,
  item_name, item_description, item_order,
  max_score, scoring_type, checklist_items, is_active
) VALUES (
  'section_2', '店內環境與陳列', 2,
  '商品先進先出 (FIFO)', '影響商譽',
  5,
  5.0, 'checklist',
  '[
    {"label": "人員補貨直接補在前排", "deduction": 2},
    {"label": "發現過期品（此項直接扣5分並強制記錄）", "deduction": 5}
  ]'::jsonb,
  true
);

-- 2-6. 架上試用品（5分）
INSERT INTO inspection_templates (
  section, section_name, section_order,
  item_name, item_description, item_order,
  max_score, scoring_type, checklist_items, is_active
) VALUES (
  'section_2', '店內環境與陳列', 2,
  '架上試用品', '影響銷售量',
  6,
  5.0, 'checklist',
  '[
    {"label": "已變質/變形", "deduction": 1},
    {"label": "用完(剩空瓶)", "deduction": 1},
    {"label": "未貼富康試用貼紙", "deduction": 2},
    {"label": "試用貼紙未寫上效期", "deduction": 2},
    {"label": "試用品過期", "deduction": 5}
  ]'::jsonb,
  true
);

-- 2-7. 賣場走道清潔/雨天（10分）
INSERT INTO inspection_templates (
  section, section_name, section_order,
  item_name, item_description, item_order,
  max_score, scoring_type, checklist_items, is_active
) VALUES (
  'section_2', '店內環境與陳列', 2,
  '賣場走道清潔/雨天', '影響客人購物動線與增加跌倒風險',
  7,
  10.0, 'checklist',
  '[
    {"label": "有些微紙屑垃圾", "deduction": 2},
    {"label": "箱子/物流箱隨意堆放在走道上", "deduction": 5},
    {"label": "雨天地板鋪紙箱", "deduction": 5},
    {"label": "小心地滑立牌未擺放", "deduction": 5}
  ]'::jsonb,
  true
);

-- =====================================================
-- 第三區：櫃檯區與倉庫（總分 45 分）
-- =====================================================

-- 3-1. 櫃檯主題陳列（10分）
INSERT INTO inspection_templates (
  section, section_name, section_order,
  item_name, item_description, item_order,
  max_score, scoring_type, checklist_items, is_active
) VALUES (
  'section_3', '櫃檯區與倉庫', 3,
  '櫃檯主題陳列', '加購區陳列成效',
  1,
  10.0, 'checklist',
  '[
    {"label": "擺放雜亂", "deduction": 2},
    {"label": "加價購商品未陳列", "deduction": 5},
    {"label": "標價不明", "deduction": 2}
  ]'::jsonb,
  true
);

-- 3-2. 收銀機與禮券（10分）
INSERT INTO inspection_templates (
  section, section_name, section_order,
  item_name, item_description, item_order,
  max_score, scoring_type, checklist_items, is_active
) VALUES (
  'section_3', '櫃檯區與倉庫', 3,
  '收銀機與禮券', '公共區檯面整潔與禮券管理',
  2,
  10.0, 'checklist',
  '[
    {"label": "台面堆放私人雜物", "deduction": 3},
    {"label": "禮券發放紀錄不全", "deduction": 5}
  ]'::jsonb,
  true
);

-- 3-3. 櫃檯平板播放（5分）
INSERT INTO inspection_templates (
  section, section_name, section_order,
  item_name, item_description, item_order,
  max_score, scoring_type, checklist_items, is_active
) VALUES (
  'section_3', '櫃檯區與倉庫', 3,
  '櫃檯平板播放', '待確認是否要放，如果要就要嚴格施行平板行銷規劃與政策',
  3,
  5.0, 'checklist',
  '[
    {"label": "平板未正常開啟", "deduction": 3},
    {"label": "輪播內容不符合公司當月活動", "deduction": 2}
  ]'::jsonb,
  true
);

-- 3-4. 倉庫/後場擺放（5分）
INSERT INTO inspection_templates (
  section, section_name, section_order,
  item_name, item_description, item_order,
  max_score, scoring_type, checklist_items, is_active
) VALUES (
  'section_3', '櫃檯區與倉庫', 3,
  '倉庫/後場擺放', '倉庫補貨進貨效率',
  4,
  5.0, 'checklist',
  '[
    {"label": "貨物直接著地", "deduction": 2},
    {"label": "阻礙走道", "deduction": 3},
    {"label": "未分類存放", "deduction": 2}
  ]'::jsonb,
  true
);

-- 3-5. 天花板/電扇/廁所（10分）
INSERT INTO inspection_templates (
  section, section_name, section_order,
  item_name, item_description, item_order,
  max_score, scoring_type, checklist_items, is_active
) VALUES (
  'section_3', '櫃檯區與倉庫', 3,
  '天花板/電扇/廁所', '店內環境整潔明亮是大家一起維護的',
  5,
  10.0, 'checklist',
  '[
    {"label": "電扇積滿黑色塵屑", "deduction": 2},
    {"label": "有燈管閃爍或不亮，未報修", "deduction": 2},
    {"label": "過期行銷布置未撤下", "deduction": 2},
    {"label": "廁所有異味", "deduction": 1},
    {"label": "廁所地上積水水漬", "deduction": 1},
    {"label": "廁所馬桶汙垢", "deduction": 1},
    {"label": "廁所洗手台汙垢", "deduction": 1},
    {"label": "廁所鏡面汙垢", "deduction": 1}
  ]'::jsonb,
  true
);

-- 3-6. 印表機/墨水/色帶（5分）
INSERT INTO inspection_templates (
  section, section_name, section_order,
  item_name, item_description, item_order,
  max_score, scoring_type, checklist_items, is_active
) VALUES (
  'section_3', '櫃檯區與倉庫', 3,
  '印表機/墨水/色帶', '工具使用維護',
  6,
  5.0, 'checklist',
  '[
    {"label": "機器積塵", "deduction": 1},
    {"label": "要袋列印字體不清晰", "deduction": 3}
  ]'::jsonb,
  true
);

-- =====================================================
-- 第四區：人員管理（總分 40 分）
-- =====================================================

-- 4-1. 服裝儀容與名牌（10分）
INSERT INTO inspection_templates (
  section, section_name, section_order,
  item_name, item_description, item_order,
  max_score, scoring_type, checklist_items, is_active
) VALUES (
  'section_4', '人員管理', 4,
  '服裝儀容與名牌', '品牌形象',
  1,
  10.0, 'checklist',
  '[
    {"label": "未戴名牌", "deduction": 3},
    {"label": "制服髒污/不整", "deduction": 2},
    {"label": "穿著不符規定未穿包鞋等", "deduction": 5}
  ]'::jsonb,
  true
);

-- 4-2. 門市應對禮儀（10分）
INSERT INTO inspection_templates (
  section, section_name, section_order,
  item_name, item_description, item_order,
  max_score, scoring_type, checklist_items, is_active
) VALUES (
  'section_4', '人員管理', 4,
  '門市應對禮儀', '品牌形象',
  2,
  10.0, 'checklist',
  '[
    {"label": "未說您好", "deduction": 2},
    {"label": "對顧客詢問不耐煩", "deduction": 5},
    {"label": "聊天無視顧客", "deduction": 10}
  ]'::jsonb,
  true
);

-- 4-3. 收銀作業流程（20分）
INSERT INTO inspection_templates (
  section, section_name, section_order,
  item_name, item_description, item_order,
  max_score, scoring_type, checklist_items, is_active
) VALUES (
  'section_4', '人員管理', 4,
  '收銀作業流程', '銷售誠信把關',
  3,
  20.0, 'checklist',
  '[
    {"label": "未核對品項", "deduction": 3},
    {"label": "找零未當面點清", "deduction": 2},
    {"label": "未主動給發票", "deduction": 5},
    {"label": "找錢直接丟桌上", "deduction": 5},
    {"label": "收您多少/找您多少沒有說出來", "deduction": 5}
  ]'::jsonb,
  true
);

-- =====================================================
-- 第五區：處方作業與行政（總分 50 分）
-- =====================================================

-- 5-1. 處方章與相關印章*（10分）
INSERT INTO inspection_templates (
  section, section_name, section_order,
  item_name, item_description, item_order,
  max_score, scoring_type, checklist_items, is_active
) VALUES (
  'section_5', '處方作業與行政', 5,
  '處方章與相關印章', '減少錯誤與主管機關稽核時的罰鍰。按項檢查，每項未達標-2',
  1,
  10.0, 'checklist',
  '[
    {"label": "流程章未蓋", "deduction": 2},
    {"label": "管三處方箋客人未簽名", "deduction": 2},
    {"label": "藥師章未蓋", "deduction": 2}
  ]'::jsonb,
  true
);

-- 5-2. 管制藥品抽盤（10分）
INSERT INTO inspection_templates (
  section, section_name, section_order,
  item_name, item_description, item_order,
  max_score, scoring_type, checklist_items, is_active
) VALUES (
  'section_5', '處方作業與行政', 5,
  '管制藥品抽盤', '減少管制藥品管理疏失與罰鍰',
  2,
  10.0, 'checklist',
  '[
    {"label": "抽兩樣數量與簿冊不符", "deduction": 5},
    {"label": "未遵守一周兩次盤點紀錄", "deduction": 5}
  ]'::jsonb,
  true
);

-- 5-3. 客訂表與存根管理（10分）
INSERT INTO inspection_templates (
  section, section_name, section_order,
  item_name, item_description, item_order,
  max_score, scoring_type, checklist_items, is_active
) VALUES (
  'section_5', '處方作業與行政', 5,
  '客訂表與存根管理', '減少客戶溝通與交接落差',
  3,
  10.0, 'checklist',
  '[
    {"label": "客訂未登記在登記表上", "deduction": 5},
    {"label": "存根未與商品綁定", "deduction": 3}
  ]'::jsonb,
  true
);

-- 5-4. 總部/分店調撥單據檢查*（10分）- Quantity說明於描述中
INSERT INTO inspection_templates (
  section, section_name, section_order,
  item_name, item_description, item_order,
  max_score, scoring_type, checklist_items, is_active
) VALUES (
  'section_5', '處方作業與行政', 5,
  '總部/分店調撥單據檢查', '減少未驗單據造成的庫存異常。檢視店內調撥單據是否有驗收（未驗收1張單-5，請在改善建議中註明張數）',
  4,
  10.0, 'checklist',
  '[
    {"label": "未驗收單據（1張-5，請計數）", "deduction": 5}
  ]'::jsonb,
  true
);

-- 5-5. 負庫存商品*（10分）- Quantity說明於描述中
INSERT INTO inspection_templates (
  section, section_name, section_order,
  item_name, item_description, item_order,
  max_score, scoring_type, checklist_items, is_active
) VALUES (
  'section_5', '處方作業與行政', 5,
  '負庫存商品', '門市庫存管理異常點檢視。先從系統中列印出負庫存商品明細，請店長逐一說明負庫存的原因，如有存在三天以上卻說明不了原因的品項（1個品項-2，請在改善建議中註明品項數）',
  5,
  10.0, 'checklist',
  '[
    {"label": "存在三天以上無法說明原因的負庫存品項（1個-2，請計數）", "deduction": 2}
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

-- =====================================================
-- 題庫匯入完成
-- =====================================================
-- 摘要：
-- 
-- 第一區：門口外圍（35分）
-- - 6 項檢查項目，全部使用 Checklist
--
-- 第二區：店內環境與陳列（50分）
-- - 7 項檢查項目，全部使用 Checklist
-- - 注意：價格牌*、FIFO* 的 Quantity 計數已整合在 Checklist 中
--
-- 第三區：櫃檯區與倉庫（45分）
-- - 6 項檢查項目，全部使用 Checklist
--
-- 第四區：人員管理（40分）
-- - 3 項檢查項目，全部使用 Checklist
--
-- 第五區：處方作業與行政（50分）
-- - 5 項檢查項目，全部使用 Checklist
-- - 注意：處方章*、單據檢查*、負庫存* 的 Quantity 計數已整合在 Checklist 中並於描述說明
--
-- 總計：27 項檢查項目，220 分
-- =====================================================
