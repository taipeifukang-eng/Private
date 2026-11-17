-- 41-b6-preview-before-apply.sql
-- M7/M8 第 6 批（G20 服務分類與區域、G21 廠商資料、工單進度廠商檢查）套用 42、44、47、43 之前先看的現況檢查。
-- 唯讀（只有 SELECT），整份可直接貼上執行，不會改任何資料。
-- 每列有 section（區）、item（項目）、value（數字或內容）、status：OK＝正常；MISSING＝缺東西，不要套用；ALREADY＝已經有了（重複套用沒問題，但請確認）；
-- WARN＝需要你看一下；INFO＝只是現況，給你決定上線怎麼安排。只需要看 MISSING、WARN、ALREADY；INFO 是現況數字與名單。
-- 重點（上線前一定要看）：
--   第 3 區：統編標準化後重複的廠商名單——新版新增與編輯會擋重複統編，既有重複不會被擋但請先整理（不影響 42 套用）。
--   第 4 區：分類與區域的 code 若有重複，42 建唯一索引會失敗（整份不生效），要先改掉重複的代碼。
--   第 5 區：廠商、分類、區域資料表現行 RLS 政策全文——套用 43 之前請把這一區整份存檔（rollback 43 要照這份還原）。
--   第 6 區：目前有廠商相關權限的角色與人——43（RLS 收緊）之後，廠商表只有「廠商檢視／管理」讀得到；只有分類、區域、合作紀錄權限者的舊版廠商頁會讀不到廠商（新版改走遮蔽欄位的函式）。
--   第 7 區：只有服務中心入口（含店長角色）目前讀得到全部廠商含統編與付款條件，43 之後讀不到。
--   第 8 區：目前靠需求單權限看得到採購分析、但沒有採購評估權限的角色與人——新版採購分析只認採購評估檢視／管理，這些人會失去入口，要的話先補授權。
-- 正式區尚未套用 42 時：第 2 區多半是 INFO（欄位將新增）；套用後再跑，欄位列會變 ALREADY。
WITH
req_tables AS (
  SELECT t AS name FROM unnest(ARRAY['ga_vendors', 'ga_service_categories', 'ga_service_regions', 'ga_purchase_orders', 'maintenance_requests', 'profiles', 'permissions', 'roles', 'role_permissions', 'user_roles']) t
),
req_fns AS (
  SELECT f AS name FROM unnest(ARRAY['has_permission', 'current_user_has_permission', 'ga_normalize_optional_text', 'ga_rq_err', 'ga_rq_raise', 'ga_rq_catch', 'ga_po_can_view', 'ga_po_like_escape', 'ga_po_today',
                                      'ga_wo_apply_fields', 'ga_wo_try_uuid']) f
),
need_perms AS (
  SELECT c AS code FROM unnest(ARRAY['general_affairs.vendor.view', 'general_affairs.vendor.manage', 'general_affairs.service_category.view', 'general_affairs.service_category.manage',
                                      'general_affairs.service_region.view', 'general_affairs.service_region.manage', 'general_affairs.cooperation_record.view', 'general_affairs.service_center.access',
                                      'general_affairs.purchase_review.view', 'general_affairs.purchase_review.manage', 'general_affairs.request.view_all', 'general_affairs.request.manage',
                                      'general_affairs.work_order.update', 'general_affairs.work_order.manage']) c
),
vendor_cols AS (
  SELECT c AS name FROM unnest(ARRAY['service_capability_note', 'billing_title', 'billing_address', 'invoice_type', 'payment_terms', 'payment_methods', 'accounting_notes', 'cooperation_start_date',
                                      'contract_end_date', 'contract_required', 'preferred_vendor', 'cooperation_notes', 'attachment_names', 'updated_by']) c
),
-- 有效的角色權限（照正式區 has_permission 語意：不看 roles.is_active 與 profiles.role）
role_perm AS (
  SELECT r.id AS role_id, r.code AS role_code, r.name AS role_name, p.code AS perm
    FROM public.roles r JOIN public.role_permissions rp ON rp.role_id = r.id AND rp.is_allowed JOIN public.permissions p ON p.id = rp.permission_id
),
user_perm AS (
  SELECT ur.user_id, rp.perm, rp.role_code FROM public.user_roles ur JOIN role_perm rp ON rp.role_id = ur.role_id WHERE ur.is_active
),
rows_out AS (
  -- 1. 先決
  SELECT 1 AS sec, '1 先決' AS section, 'table:' || t.name AS item, CASE WHEN to_regclass('public.' || t.name) IS NULL THEN '不存在' ELSE '存在' END AS value,
         CASE WHEN to_regclass('public.' || t.name) IS NULL THEN 'MISSING' ELSE 'OK' END AS status FROM req_tables t
  UNION ALL
  SELECT 1, '1 先決', 'function:' || f.name, CASE WHEN EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = f.name) THEN '存在' ELSE '不存在' END,
         CASE WHEN EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = f.name) THEN 'OK' ELSE 'MISSING' END FROM req_fns f
  UNION ALL
  SELECT 1, '1 先決', 'permission:' || n.code, CASE WHEN EXISTS (SELECT 1 FROM public.permissions p WHERE p.code = n.code) THEN '存在' ELSE '不存在' END,
         CASE WHEN EXISTS (SELECT 1 FROM public.permissions p WHERE p.code = n.code) THEN 'OK' ELSE 'MISSING' END FROM need_perms n
  UNION ALL
  SELECT 1, '1 先決', 'column:maintenance_requests.vendor_id', CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'maintenance_requests' AND column_name = 'vendor_id') THEN '存在' ELSE '不存在' END,
         CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'maintenance_requests' AND column_name = 'vendor_id') THEN 'OK' ELSE 'MISSING' END
  -- 2. 廠商表現況與欄位
  UNION ALL
  SELECT 2, '2 廠商表現況', 'ga_vendors 筆數', (SELECT count(*)::text FROM public.ga_vendors), 'INFO'
  UNION ALL
  SELECT 2, '2 廠商表現況', 'status=' || s.status, s.n::text, 'INFO' FROM (SELECT status, count(*) AS n FROM public.ga_vendors GROUP BY status) s
  UNION ALL
  SELECT 2, '2 廠商表現況', 'ga_vendors 最近修改時間', COALESCE((SELECT max(updated_at)::text FROM public.ga_vendors), '（沒有資料）'), 'INFO'
  UNION ALL
  SELECT 2, '2 廠商表現況', 'column:ga_vendors.' || c.name,
         CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_vendors' AND column_name = c.name) THEN '已有' ELSE '沒有（42 會新增）' END,
         CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_vendors' AND column_name = c.name) THEN 'ALREADY' ELSE 'INFO' END FROM vendor_cols c
  UNION ALL
  SELECT 2, '2 廠商表現況', 'contract_required 目前預設值', COALESCE((SELECT column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_vendors' AND column_name = 'contract_required'), '（欄位不存在）'),
         'INFO'
  UNION ALL
  SELECT 2, '2 廠商表現況', 'contract_required = true 的廠商數（預設值是 true 時 42 會一次性改為 false，V4）',
         COALESCE((SELECT count(*)::text FROM public.ga_vendors v WHERE to_jsonb(v) ->> 'contract_required' = 'true'), '0'),
         CASE WHEN COALESCE((SELECT count(*) FROM public.ga_vendors v WHERE to_jsonb(v) ->> 'contract_required' = 'true'), 0) > 0 THEN 'WARN' ELSE 'INFO' END
  UNION ALL
  SELECT 2, '2 廠商表現況', '已有統編的廠商數', (SELECT count(*)::text FROM public.ga_vendors WHERE nullif(btrim(tax_id), '') IS NOT NULL), 'INFO'
  -- 3. 重複統編（標準化：去空白、全形轉半角）
  UNION ALL
  SELECT 3, '3 重複統編', 'tax_id=' || d.tax || '（' || d.n || ' 家）', d.names, 'WARN'
    FROM (SELECT regexp_replace(normalize(tax_id, NFKC), '\s', '', 'g') AS tax, count(*) AS n, string_agg(name || '（' || status || '）', '、' ORDER BY name) AS names
            FROM public.ga_vendors WHERE nullif(btrim(tax_id), '') IS NOT NULL GROUP BY 1 HAVING count(*) > 1) d
  UNION ALL
  SELECT 3, '3 重複統編', '重複統編組數', (SELECT count(*)::text FROM (SELECT 1 FROM public.ga_vendors WHERE nullif(btrim(tax_id), '') IS NOT NULL GROUP BY regexp_replace(normalize(tax_id, NFKC), '\s', '', 'g') HAVING count(*) > 1) x), 'INFO'
  -- 4. 分類與區域 code 重複（會讓 42 的唯一索引失敗）與現況
  UNION ALL
  SELECT 4, '4 分類與區域', 'ga_service_categories 筆數', (SELECT count(*)::text FROM public.ga_service_categories), 'INFO'
  UNION ALL
  SELECT 4, '4 分類與區域', 'ga_service_regions 筆數', (SELECT count(*)::text FROM public.ga_service_regions), 'INFO'
  UNION ALL
  SELECT 4, '4 分類與區域', '分類 code 重複：' || d.code, d.n::text || ' 筆', 'WARN' FROM (SELECT code, count(*) AS n FROM public.ga_service_categories GROUP BY code HAVING count(*) > 1) d
  UNION ALL
  SELECT 4, '4 分類與區域', '區域 code 重複：' || d.code, d.n::text || ' 筆', 'WARN' FROM (SELECT code, count(*) AS n FROM public.ga_service_regions GROUP BY code HAVING count(*) > 1) d
  UNION ALL
  SELECT 4, '4 分類與區域', '已有縣市行政區固定資料的 code 數（TW、TW-N、TPE 等；42 用 ON CONFLICT DO NOTHING，不覆蓋）',
         (SELECT count(*)::text FROM public.ga_service_regions WHERE code IN ('TW', 'TW-N', 'TW-C', 'TW-S', 'TW-E', 'TPE', 'NWT', 'KHH', 'TXG', 'TNN')), 'INFO'
  UNION ALL
  SELECT 4, '4 分類與區域', 'region_type=' || s.region_type, s.n::text, 'INFO' FROM (SELECT region_type, count(*) AS n FROM public.ga_service_regions GROUP BY region_type) s
  -- 5. 現行 RLS 政策全文（備份用）
  UNION ALL
  SELECT 5, '5 現行政策（請存檔）', pol.tablename || '.' || pol.policyname || '（' || pol.cmd || '）',
         'USING: ' || COALESCE(pol.qual, '（無）') || ' ／ WITH CHECK: ' || COALESCE(pol.with_check, '（無）'), 'INFO'
    FROM pg_policies pol WHERE pol.schemaname = 'public' AND pol.tablename IN ('ga_vendors', 'ga_service_categories', 'ga_service_regions')
  UNION ALL
  SELECT 5, '5 現行政策（請存檔）', 'RLS 是否啟用:' || c.relname, CASE WHEN c.relrowsecurity THEN '啟用' ELSE '未啟用' END, CASE WHEN c.relrowsecurity THEN 'OK' ELSE 'WARN' END
    FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN ('ga_vendors', 'ga_service_categories', 'ga_service_regions')
  -- 6. 目前有廠商相關權限的角色與人
  UNION ALL
  SELECT 6, '6 廠商相關權限的角色', rp.role_code || '（' || rp.role_name || '）', string_agg(DISTINCT replace(rp.perm, 'general_affairs.', ''), '、' ORDER BY replace(rp.perm, 'general_affairs.', '')), 'INFO'
    FROM role_perm rp WHERE rp.perm IN ('general_affairs.vendor.view', 'general_affairs.vendor.manage', 'general_affairs.service_category.view', 'general_affairs.service_category.manage',
                                       'general_affairs.service_region.view', 'general_affairs.service_region.manage', 'general_affairs.cooperation_record.view') GROUP BY rp.role_code, rp.role_name
  UNION ALL
  SELECT 6, '6 只有分類、區域、合作紀錄權限（沒有廠商檢視／管理）的人', COALESCE(pr.full_name, up.user_id::text),
         string_agg(DISTINCT up.role_code, '、'), 'WARN'
    FROM user_perm up LEFT JOIN public.profiles pr ON pr.id = up.user_id
   WHERE up.perm IN ('general_affairs.service_category.view', 'general_affairs.service_category.manage', 'general_affairs.service_region.view', 'general_affairs.service_region.manage', 'general_affairs.cooperation_record.view')
     AND NOT EXISTS (SELECT 1 FROM user_perm x WHERE x.user_id = up.user_id AND x.perm IN ('general_affairs.vendor.view', 'general_affairs.vendor.manage'))
   GROUP BY pr.full_name, up.user_id
  -- 7 只有服務中心入口（含店長）目前讀得到全部廠商，43 之後讀不到
  UNION ALL
  SELECT 7, '7 只有服務中心入口、沒有廠商檢視／管理的角色（43 後讀不到廠商表）', rp.role_code || '（' || rp.role_name || '）',
         (SELECT count(*)::text FROM public.user_roles ur WHERE ur.role_id = rp.role_id AND ur.is_active) || ' 人', 'WARN'
    FROM (SELECT DISTINCT role_id, role_code, role_name FROM role_perm WHERE perm = 'general_affairs.service_center.access') rp
   WHERE NOT EXISTS (SELECT 1 FROM role_perm x WHERE x.role_id = rp.role_id AND x.perm IN ('general_affairs.vendor.view', 'general_affairs.vendor.manage'))
  -- 8 靠需求單權限看採購分析、但沒有採購評估權限的人
  UNION ALL
  SELECT 8, '8 有需求單檢視全部／管理、沒有採購評估檢視／管理的人（新版採購分析會失去入口）', COALESCE(pr.full_name, up.user_id::text), string_agg(DISTINCT up.role_code, '、'), 'WARN'
    FROM user_perm up LEFT JOIN public.profiles pr ON pr.id = up.user_id
   WHERE up.perm IN ('general_affairs.request.view_all', 'general_affairs.request.manage')
     AND NOT EXISTS (SELECT 1 FROM user_perm x WHERE x.user_id = up.user_id AND x.perm IN ('general_affairs.purchase_review.view', 'general_affairs.purchase_review.manage'))
   GROUP BY pr.full_name, up.user_id
  -- 9 單據綁定（停用廠商的提醒用）
  UNION ALL
  SELECT 9, '9 單據綁定', '綁定廠商的採購單數', (SELECT count(*)::text FROM public.ga_purchase_orders WHERE vendor_id IS NOT NULL), 'INFO'
  UNION ALL
  SELECT 9, '9 單據綁定', '綁定廠商的工單數', (SELECT count(*)::text FROM public.maintenance_requests WHERE vendor_id IS NOT NULL), 'INFO'
  UNION ALL
  SELECT 9, '9 單據綁定', '綁定「非合作中」廠商的未結工單數（47 之後新選不可選停用廠商，已綁的照舊）',
         (SELECT count(*)::text FROM public.maintenance_requests m JOIN public.ga_vendors v ON v.id = m.vendor_id WHERE v.status <> 'active' AND m.status <> 'COMPLETED'), 'INFO'
)
SELECT section, item, value, status FROM rows_out ORDER BY sec, status DESC, item;
-- 核對：沒有任何 MISSING 才能套用 42、44、47；第 4 區沒有 WARN（code 重複）才能套用 42；第 5 區存檔、第 6 與第 7 區名單經使用者確認後才能套用 43。
