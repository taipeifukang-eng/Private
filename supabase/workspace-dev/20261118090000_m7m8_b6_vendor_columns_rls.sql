-- M7/M8 第 6 批 A（G20 服務分類與區域、G21 廠商資料）：欄位、收緊版 RLS、縣市行政區固定資料。
-- 內容：
--   1. 先決檢查；補齊廠商 13 個擴充欄位（DEV 已有，IF NOT EXISTS）；新增 updated_by（廠商、分類、區域）；contract_required 與 preferred_vendor 預設改 false，
--      DEV 既有廠商的 contract_required 一次性改為 false（V4；只在預設值還是 true 時做，重複執行不會再動）。
--   2. 分類與區域 code 唯一索引（縣市行政區固定資料以 code 冪等；DEV 的資料表沒有唯一約束，設計 3.1）。
--   3. RLS 收緊（Q22、V1）：廠商表只留 vendor.view／manage 讀、vendor.manage 寫；分類與區域表讀取給「自己的 view／manage」與廠商檢視／管理（廠商表單下拉），
--      寫入只給自己的 manage；一律沒有 DELETE 政策（廠商停用、分類與區域不可刪除）。其他權限者（合作紀錄、分類區域檢視）讀廠商一律走遮蔽欄位的 ga_ws_vendor_* 函式。
--      套用前的政策原文備份在 supabase/workspace-dev/_backup/20261118_b6_vendor_policies_before_b6.sql，rollback 依此還原。
--   4. 縣市行政區固定資料（來源 supabase/migration_general_affairs_taiwan_admin_regions.sql；補上它依賴的台灣與四大區，ON CONFLICT DO NOTHING，不覆蓋總務事後的編輯）。
-- 只用 DEV；正式區草稿為 docs/vue-workspace/parity-plan/m7m8-sql/42（欄位與固定資料）與 43（RLS，最後套用）。還原：20261118090000_m7m8_b6_vendor_columns_rls.rollback.sql。可重複執行。

DO $$
BEGIN
  IF to_regclass('public.ga_vendors') IS NULL OR to_regclass('public.ga_service_categories') IS NULL OR to_regclass('public.ga_service_regions') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table: ga_vendors／ga_service_categories／ga_service_regions';
  END IF;
  IF to_regprocedure('public.current_user_has_permission(character varying)') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite function: current_user_has_permission(varchar)';
  END IF;
  IF (SELECT count(*) FROM public.permissions WHERE code IN ('general_affairs.vendor.view', 'general_affairs.vendor.manage', 'general_affairs.service_category.view', 'general_affairs.service_category.manage',
        'general_affairs.service_region.view', 'general_affairs.service_region.manage', 'general_affairs.cooperation_record.view')) < 7 THEN
    RAISE EXCEPTION 'Missing prerequisite permission codes: 廠商與分類區域權限碼（20260824090000）';
  END IF;
END $$;

-- ================================================================ 0. 套用前現況存檔（審查 A3：撤回依此還原「套用前」，不再假設原況）
-- 一律 ON CONFLICT DO NOTHING：重複套用不會用「套用後」的狀態蓋掉最初的原況。
CREATE TABLE IF NOT EXISTS public.ga_m7m8_b6_apply_log (k text PRIMARY KEY, v jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ga_m7m8_b6_apply_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ga_m7m8_b6_apply_log FROM PUBLIC, anon, authenticated;
INSERT INTO public.ga_m7m8_b6_apply_log (k, v)
SELECT 'b42.updated_by_existed.' || t.n, to_jsonb(EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema = 'public' AND c.table_name = t.n AND c.column_name = 'updated_by'))
  FROM (VALUES ('ga_vendors'), ('ga_service_categories'), ('ga_service_regions')) t(n)
ON CONFLICT (k) DO NOTHING;
INSERT INTO public.ga_m7m8_b6_apply_log (k, v)
SELECT 'b42.default.' || c.column_name, COALESCE(to_jsonb(c.column_default), 'null'::jsonb)
  FROM information_schema.columns c WHERE c.table_schema = 'public' AND c.table_name = 'ga_vendors' AND c.column_name IN ('contract_required', 'preferred_vendor')
ON CONFLICT (k) DO NOTHING;
INSERT INTO public.ga_m7m8_b6_apply_log (k, v) VALUES ('b42.region_ids_before', (SELECT COALESCE(jsonb_agg(id), '[]'::jsonb) FROM public.ga_service_regions)) ON CONFLICT (k) DO NOTHING;
INSERT INTO public.ga_m7m8_b6_apply_log (k, v) VALUES ('b42.indexes_before', (SELECT COALESCE(jsonb_agg(indexname), '[]'::jsonb) FROM pg_indexes
  WHERE schemaname = 'public' AND indexname IN ('uq_ga_service_categories_code', 'uq_ga_service_regions_code', 'idx_ga_vendors_contract_due'))) ON CONFLICT (k) DO NOTHING;

-- ================================================================ 1. 欄位
ALTER TABLE public.ga_vendors
  ADD COLUMN IF NOT EXISTS service_capability_note text,
  ADD COLUMN IF NOT EXISTS billing_title text,
  ADD COLUMN IF NOT EXISTS billing_address text,
  ADD COLUMN IF NOT EXISTS invoice_type text,
  ADD COLUMN IF NOT EXISTS payment_terms text,
  ADD COLUMN IF NOT EXISTS payment_methods text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS accounting_notes text,
  ADD COLUMN IF NOT EXISTS cooperation_start_date date,
  ADD COLUMN IF NOT EXISTS contract_end_date date,
  ADD COLUMN IF NOT EXISTS contract_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS preferred_vendor boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cooperation_notes text,
  ADD COLUMN IF NOT EXISTS attachment_names text[] NOT NULL DEFAULT '{}';

ALTER TABLE public.ga_vendors ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.ga_service_categories ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.ga_service_regions ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- V4：預設改 false；既有廠商的 contract_required 一次性改 false（只在預設值還是 true 時做，之後重複執行不會把總務改成「需簽約」的廠商再改回去）。
DO $$
DECLARE
  v_default text;
BEGIN
  SELECT column_default INTO v_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_vendors' AND column_name = 'contract_required';
  IF v_default = 'true' THEN
    INSERT INTO public.ga_m7m8_b6_apply_log (k, v) VALUES ('b42.contract_required_true_ids', (SELECT COALESCE(jsonb_agg(id), '[]'::jsonb) FROM public.ga_vendors WHERE contract_required)) ON CONFLICT (k) DO NOTHING;
    UPDATE public.ga_vendors SET contract_required = false WHERE contract_required;
  END IF;
END $$;
ALTER TABLE public.ga_vendors ALTER COLUMN contract_required SET DEFAULT false;
ALTER TABLE public.ga_vendors ALTER COLUMN preferred_vendor SET DEFAULT false;

-- ================================================================ 2. 索引（code 唯一：分類、區域；合約到期查詢）
CREATE UNIQUE INDEX IF NOT EXISTS uq_ga_service_categories_code ON public.ga_service_categories (code);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ga_service_regions_code ON public.ga_service_regions (code);
CREATE INDEX IF NOT EXISTS idx_ga_vendors_contract_due ON public.ga_vendors (contract_end_date) WHERE status = 'active' AND contract_required;

-- ================================================================ 3. RLS 收緊（原政策已存檔在 ga_m7m8_b6_apply_log，rollback 直接還原）
-- 現行政策存檔成可直接執行的 CREATE POLICY 語句（審查 A3：43 撤回直接執行這份，不靠人工改寫；ON CONFLICT DO NOTHING 保留最初原況）。
CREATE TABLE IF NOT EXISTS public.ga_m7m8_b6_apply_log (k text PRIMARY KEY, v jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ga_m7m8_b6_apply_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ga_m7m8_b6_apply_log FROM PUBLIC, anon, authenticated;
INSERT INTO public.ga_m7m8_b6_apply_log (k, v)
SELECT 'b43.policies.' || t.n, jsonb_build_object(
  'rls_enabled', (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = ('public.' || t.n)::regclass),
  'statements', COALESCE((SELECT jsonb_agg(format('CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s%s%s', p.policyname, p.schemaname, p.tablename, p.permissive, p.cmd, array_to_string(p.roles, ', '),
                                      CASE WHEN p.qual IS NOT NULL THEN ' USING (' || p.qual || ')' ELSE '' END, CASE WHEN p.with_check IS NOT NULL THEN ' WITH CHECK (' || p.with_check || ')' ELSE '' END) ORDER BY p.policyname)
                            FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = t.n), '[]'::jsonb))
  FROM (VALUES ('ga_vendors'), ('ga_service_categories'), ('ga_service_regions')) t(n)
ON CONFLICT (k) DO NOTHING;

ALTER TABLE public.ga_vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ga_service_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ga_service_regions ENABLE ROW LEVEL SECURITY;

-- 廠商
DROP POLICY IF EXISTS p1e_ga_vendors_read ON public.ga_vendors;
DROP POLICY IF EXISTS p1e_ga_vendors_write ON public.ga_vendors;
DROP POLICY IF EXISTS p1e_ga_vendors_insert ON public.ga_vendors;
DROP POLICY IF EXISTS p1e_ga_vendors_update ON public.ga_vendors;
CREATE POLICY p1e_ga_vendors_read ON public.ga_vendors FOR SELECT TO authenticated
USING (public.current_user_has_permission('general_affairs.vendor.view') OR public.current_user_has_permission('general_affairs.vendor.manage'));
CREATE POLICY p1e_ga_vendors_insert ON public.ga_vendors FOR INSERT TO authenticated
WITH CHECK (public.current_user_has_permission('general_affairs.vendor.manage'));
CREATE POLICY p1e_ga_vendors_update ON public.ga_vendors FOR UPDATE TO authenticated
USING (public.current_user_has_permission('general_affairs.vendor.manage'))
WITH CHECK (public.current_user_has_permission('general_affairs.vendor.manage'));

-- 服務分類
DROP POLICY IF EXISTS p1e_ga_service_categories_read ON public.ga_service_categories;
DROP POLICY IF EXISTS p1e_ga_service_categories_write ON public.ga_service_categories;
DROP POLICY IF EXISTS p1e_ga_service_categories_insert ON public.ga_service_categories;
DROP POLICY IF EXISTS p1e_ga_service_categories_update ON public.ga_service_categories;
CREATE POLICY p1e_ga_service_categories_read ON public.ga_service_categories FOR SELECT TO authenticated
USING (public.current_user_has_permission('general_affairs.service_category.view') OR public.current_user_has_permission('general_affairs.service_category.manage')
  OR public.current_user_has_permission('general_affairs.vendor.view') OR public.current_user_has_permission('general_affairs.vendor.manage'));
CREATE POLICY p1e_ga_service_categories_insert ON public.ga_service_categories FOR INSERT TO authenticated
WITH CHECK (public.current_user_has_permission('general_affairs.service_category.manage'));
CREATE POLICY p1e_ga_service_categories_update ON public.ga_service_categories FOR UPDATE TO authenticated
USING (public.current_user_has_permission('general_affairs.service_category.manage'))
WITH CHECK (public.current_user_has_permission('general_affairs.service_category.manage'));

-- 服務區域
DROP POLICY IF EXISTS p1e_ga_service_regions_read ON public.ga_service_regions;
DROP POLICY IF EXISTS p1e_ga_service_regions_write ON public.ga_service_regions;
DROP POLICY IF EXISTS p1e_ga_service_regions_insert ON public.ga_service_regions;
DROP POLICY IF EXISTS p1e_ga_service_regions_update ON public.ga_service_regions;
CREATE POLICY p1e_ga_service_regions_read ON public.ga_service_regions FOR SELECT TO authenticated
USING (public.current_user_has_permission('general_affairs.service_region.view') OR public.current_user_has_permission('general_affairs.service_region.manage')
  OR public.current_user_has_permission('general_affairs.vendor.view') OR public.current_user_has_permission('general_affairs.vendor.manage'));
CREATE POLICY p1e_ga_service_regions_insert ON public.ga_service_regions FOR INSERT TO authenticated
WITH CHECK (public.current_user_has_permission('general_affairs.service_region.manage'));
CREATE POLICY p1e_ga_service_regions_update ON public.ga_service_regions FOR UPDATE TO authenticated
USING (public.current_user_has_permission('general_affairs.service_region.manage'))
WITH CHECK (public.current_user_has_permission('general_affairs.service_region.manage'));

-- ================================================================ 4. 縣市行政區固定資料（冪等）
INSERT INTO public.ga_service_regions (name, code, parent_id, region_type, description, included_locations, sort_order)
VALUES
  ('台灣地區', 'TW', NULL, 'country', '台灣全區', ARRAY['全台灣'], 1),
  ('北部地區', 'TW-N', NULL, 'region', '北部主要服務區域', ARRAY['台北市', '新北市', '基隆市', '桃園市', '新竹縣市'], 2),
  ('中部地區', 'TW-C', NULL, 'region', '中部主要服務區域', ARRAY['苗栗縣', '台中市', '彰化縣', '南投縣', '雲林縣'], 3),
  ('南部地區', 'TW-S', NULL, 'region', '南部主要服務區域', ARRAY['嘉義縣市', '台南市', '高雄市', '屏東縣'], 4),
  ('東部地區', 'TW-E', NULL, 'region', '東部主要服務區域', ARRAY['宜蘭縣', '花蓮縣', '台東縣'], 5)
ON CONFLICT (code) DO NOTHING;

INSERT INTO ga_service_regions (name, code, parent_id, region_type, description, included_locations, sort_order)
VALUES
  ('離島地區', 'TW-O', NULL, 'region', '離島主要服務區域', ARRAY['澎湖縣', '金門縣', '連江縣'], 6)
ON CONFLICT (code) DO NOTHING;

WITH city_seed(name, code, parent_code, sort_order) AS (
  VALUES
    ('基隆市', 'KEE', 'TW-N', 1),
    ('台北市', 'TPE', 'TW-N', 2),
    ('新北市', 'TPH', 'TW-N', 3),
    ('桃園市', 'TYC', 'TW-N', 4),
    ('新竹市', 'HSZ', 'TW-N', 5),
    ('新竹縣', 'HSQ', 'TW-N', 6),
    ('宜蘭縣', 'ILA', 'TW-N', 7),
    ('苗栗縣', 'MIA', 'TW-C', 1),
    ('台中市', 'TXG', 'TW-C', 2),
    ('彰化縣', 'CHA', 'TW-C', 3),
    ('南投縣', 'NAN', 'TW-C', 4),
    ('雲林縣', 'YUN', 'TW-C', 5),
    ('嘉義市', 'CYI', 'TW-S', 1),
    ('嘉義縣', 'CYQ', 'TW-S', 2),
    ('台南市', 'TNN', 'TW-S', 3),
    ('高雄市', 'KHH', 'TW-S', 4),
    ('屏東縣', 'PIF', 'TW-S', 5),
    ('花蓮縣', 'HUA', 'TW-E', 1),
    ('台東縣', 'TTT', 'TW-E', 2),
    ('澎湖縣', 'PEN', 'TW-O', 1),
    ('金門縣', 'KIN', 'TW-O', 2),
    ('連江縣', 'LIE', 'TW-O', 3)
)
INSERT INTO ga_service_regions (name, code, parent_id, region_type, description, included_locations, sort_order)
SELECT
  city_seed.name,
  city_seed.code,
  parent.id,
  'city',
  city_seed.name || '全區',
  ARRAY[city_seed.name],
  city_seed.sort_order
FROM city_seed
JOIN ga_service_regions parent ON parent.code = city_seed.parent_code
ON CONFLICT (code) DO NOTHING;

WITH district_seed(city_code, names) AS (
  VALUES
    ('KEE', ARRAY['仁愛區','信義區','中正區','中山區','安樂區','暖暖區','七堵區']),
    ('TPE', ARRAY['中正區','大同區','中山區','松山區','大安區','萬華區','信義區','士林區','北投區','內湖區','南港區','文山區']),
    ('TPH', ARRAY['板橋區','三重區','中和區','永和區','新莊區','新店區','土城區','蘆洲區','樹林區','汐止區','鶯歌區','三峽區','淡水區','瑞芳區','五股區','泰山區','林口區','深坑區','石碇區','坪林區','三芝區','石門區','八里區','平溪區','雙溪區','貢寮區','金山區','萬里區','烏來區']),
    ('TYC', ARRAY['桃園區','中壢區','平鎮區','八德區','楊梅區','蘆竹區','大溪區','龍潭區','龜山區','大園區','觀音區','新屋區','復興區']),
    ('HSZ', ARRAY['東區','北區','香山區']),
    ('HSQ', ARRAY['竹北市','竹東鎮','新埔鎮','關西鎮','湖口鄉','新豐鄉','芎林鄉','橫山鄉','北埔鄉','寶山鄉','峨眉鄉','尖石鄉','五峰鄉']),
    ('ILA', ARRAY['宜蘭市','羅東鎮','蘇澳鎮','頭城鎮','礁溪鄉','壯圍鄉','員山鄉','冬山鄉','五結鄉','三星鄉','大同鄉','南澳鄉']),
    ('MIA', ARRAY['苗栗市','苑裡鎮','通霄鎮','竹南鎮','頭份市','後龍鎮','卓蘭鎮','大湖鄉','公館鄉','銅鑼鄉','南庄鄉','頭屋鄉','三義鄉','西湖鄉','造橋鄉','三灣鄉','獅潭鄉','泰安鄉']),
    ('TXG', ARRAY['中區','東區','南區','西區','北區','西屯區','南屯區','北屯區','豐原區','東勢區','大甲區','清水區','沙鹿區','梧棲區','后里區','神岡區','潭子區','大雅區','新社區','石岡區','外埔區','大安區','烏日區','大肚區','龍井區','霧峰區','太平區','大里區','和平區']),
    ('CHA', ARRAY['彰化市','鹿港鎮','和美鎮','線西鄉','伸港鄉','福興鄉','秀水鄉','花壇鄉','芬園鄉','員林市','溪湖鎮','田中鎮','大村鄉','埔鹽鄉','埔心鄉','永靖鄉','社頭鄉','二水鄉','北斗鎮','二林鎮','田尾鄉','埤頭鄉','芳苑鄉','大城鄉','竹塘鄉','溪州鄉']),
    ('NAN', ARRAY['南投市','埔里鎮','草屯鎮','竹山鎮','集集鎮','名間鄉','鹿谷鄉','中寮鄉','魚池鄉','國姓鄉','水里鄉','信義鄉','仁愛鄉']),
    ('YUN', ARRAY['斗六市','斗南鎮','虎尾鎮','西螺鎮','土庫鎮','北港鎮','古坑鄉','大埤鄉','莿桐鄉','林內鄉','二崙鄉','崙背鄉','麥寮鄉','東勢鄉','褒忠鄉','臺西鄉','元長鄉','四湖鄉','口湖鄉','水林鄉']),
    ('CYI', ARRAY['東區','西區']),
    ('CYQ', ARRAY['太保市','朴子市','布袋鎮','大林鎮','民雄鄉','溪口鄉','新港鄉','六腳鄉','東石鄉','義竹鄉','鹿草鄉','水上鄉','中埔鄉','竹崎鄉','梅山鄉','番路鄉','大埔鄉','阿里山鄉']),
    ('TNN', ARRAY['中西區','東區','南區','北區','安平區','安南區','永康區','歸仁區','新化區','左鎮區','玉井區','楠西區','南化區','仁德區','關廟區','龍崎區','官田區','麻豆區','佳里區','西港區','七股區','將軍區','學甲區','北門區','新營區','後壁區','白河區','東山區','六甲區','下營區','柳營區','鹽水區','善化區','大內區','山上區','新市區','安定區']),
    ('KHH', ARRAY['楠梓區','左營區','鼓山區','三民區','鹽埕區','前金區','新興區','苓雅區','前鎮區','旗津區','小港區','鳳山區','林園區','大寮區','大樹區','大社區','仁武區','鳥松區','岡山區','橋頭區','燕巢區','田寮區','阿蓮區','路竹區','湖內區','茄萣區','永安區','彌陀區','梓官區','旗山區','美濃區','六龜區','甲仙區','杉林區','內門區','茂林區','桃源區','那瑪夏區']),
    ('PIF', ARRAY['屏東市','潮州鎮','東港鎮','恆春鎮','萬丹鄉','長治鄉','麟洛鄉','九如鄉','里港鄉','鹽埔鄉','高樹鄉','萬巒鄉','內埔鄉','竹田鄉','新埤鄉','枋寮鄉','新園鄉','崁頂鄉','林邊鄉','南州鄉','佳冬鄉','琉球鄉','車城鄉','滿州鄉','枋山鄉','三地門鄉','霧臺鄉','瑪家鄉','泰武鄉','來義鄉','春日鄉','獅子鄉','牡丹鄉']),
    ('HUA', ARRAY['花蓮市','鳳林鎮','玉里鎮','新城鄉','吉安鄉','壽豐鄉','光復鄉','豐濱鄉','瑞穗鄉','富里鄉','秀林鄉','萬榮鄉','卓溪鄉']),
    ('TTT', ARRAY['台東市','成功鎮','關山鎮','卑南鄉','鹿野鄉','池上鄉','東河鄉','長濱鄉','太麻里鄉','大武鄉','綠島鄉','海端鄉','延平鄉','金峰鄉','達仁鄉','蘭嶼鄉']),
    ('PEN', ARRAY['馬公市','湖西鄉','白沙鄉','西嶼鄉','望安鄉','七美鄉']),
    ('KIN', ARRAY['金城鎮','金湖鎮','金沙鎮','金寧鄉','烈嶼鄉','烏坵鄉']),
    ('LIE', ARRAY['南竿鄉','北竿鄉','莒光鄉','東引鄉'])
),
expanded AS (
  SELECT
    district_seed.city_code,
    district_name,
    ordinality::INTEGER AS sort_order
  FROM district_seed
  CROSS JOIN LATERAL unnest(district_seed.names) WITH ORDINALITY AS item(district_name, ordinality)
)
INSERT INTO ga_service_regions (name, code, parent_id, region_type, description, included_locations, sort_order)
SELECT
  expanded.district_name,
  expanded.city_code || '-' || LPAD(expanded.sort_order::TEXT, 2, '0'),
  city.id,
  'district',
  city.name || expanded.district_name,
  ARRAY[city.name, expanded.district_name],
  expanded.sort_order
FROM expanded
JOIN ga_service_regions city ON city.code = expanded.city_code
ON CONFLICT (code) DO NOTHING;

NOTIFY pgrst, 'reload schema';
