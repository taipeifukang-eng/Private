-- ============================================================
-- 總務服務中心 - 廠商管理上層服務分類
-- 說明：
--   依總務服務中心廠商管理需求，建立指定的上層服務分類。
--   既有分類代碼會更新名稱與排序；所有項目皆為 parent_id = NULL。
-- ============================================================

UPDATE ga_service_categories
SET
  name = '門窗與出入口設備',
  code = 'DR',
  description = '門窗、玻璃、自動門與出入口設備維修',
  icon_key = 'door-open',
  sort_order = 3,
  common_items = ARRAY['門窗維修', '玻璃更換', '自動門維修'],
  parent_id = NULL,
  status = 'active',
  updated_at = NOW()
WHERE code = 'WD'
  AND NOT EXISTS (
    SELECT 1
    FROM ga_service_categories existing
    WHERE existing.code = 'DR'
  );

INSERT INTO ga_service_categories (name, code, parent_id, description, icon_key, sort_order, common_items)
VALUES
  ('空調與冷凍設備', 'AC', NULL, '空調、冷凍與相關設備維修保養', 'snowflake', 1, ARRAY['冷氣維修', '冷氣保養', '冷凍設備維修']),
  ('水電工程', 'EL', NULL, '水電維修、線路配置與給排水工程', 'zap', 2, ARRAY['水電維修', '線路配置', '給排水維修']),
  ('門窗與出入口設備', 'DR', NULL, '門窗、玻璃、自動門與出入口設備維修', 'door-open', 3, ARRAY['門窗維修', '玻璃更換', '自動門維修']),
  ('招牌與廣告工程', 'SG', NULL, '招牌製作、維修與廣告相關工程', 'signpost', 4, ARRAY['招牌製作', '招牌維修', '廣告工程']),
  ('裝修與木作工程', 'DW', NULL, '店面裝修、木作與室內修繕工程', 'hammer', 5, ARRAY['店面裝修', '木作工程', '室內修繕']),
  ('貨架與陳列設備', 'DS', NULL, '貨架、陳列架與展示設備維修調整', 'boxes', 6, ARRAY['貨架維修', '陳列設備調整', '展示架安裝']),
  ('資訊與弱電設備', 'IT', NULL, '資訊、網路、監控與弱電設備維護', 'monitor', 7, ARRAY['網路維修', '監控設備', '弱電工程']),
  ('消防與安全設備', 'FS', NULL, '消防、安全與緊急設備維護檢修', 'shield-check', 8, ARRAY['消防設備檢修', '安全設備維護', '緊急照明']),
  ('病媒防治與環境消毒', 'PC', NULL, '病媒防治、消毒與環境衛生處理', 'bug', 9, ARRAY['病媒防治', '環境消毒', '除蟲除害']),
  ('清潔與環境維護', 'CL', NULL, '清潔服務、環境維護與廢棄物處理', 'sparkles', 10, ARRAY['環境清潔', '地面清潔', '廢棄物處理']),
  ('辦公家具與庶務設備', 'OF', NULL, '辦公家具、庶務用品與一般設備維修', 'briefcase', 11, ARRAY['辦公家具維修', '庶務設備維護', '一般設備維修']),
  ('醫療與藥局專用設備', 'MD', NULL, '醫療、藥局與門市專用設備維護', 'cross', 12, ARRAY['藥局設備維修', '醫療設備維護', '專用設備檢修'])
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  parent_id = NULL,
  description = EXCLUDED.description,
  icon_key = EXCLUDED.icon_key,
  status = 'active',
  sort_order = EXCLUDED.sort_order,
  common_items = EXCLUDED.common_items,
  updated_at = NOW();
