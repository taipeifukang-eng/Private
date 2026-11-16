-- 36-b5-preview-before-apply.sql
-- M7/M8 第 5 批（G18 工單中心：工單規則函式、補資料同步、領用料件、RLS 收緊）套用 37、38、39、40 之前先看的現況檢查。
-- 唯讀（只有 SELECT），整份可直接貼上執行，不會改任何資料。
-- 每列有 section（區）、item（項目）、value（數字或內容）、status：OK＝正常；MISSING＝缺東西，不要套用；ALREADY＝已經有了（重複套用沒問題，但請確認不是別人先套的）；
-- WARN＝需要你看一下；INFO＝只是現況，給你決定上線怎麼安排。只需要看 MISSING、WARN、ALREADY；INFO 是現況數字與名單。
-- 重點（上線前一定要看）：
--   第 6 區：Q20「只有查看全部、沒有更新權限」的人與角色名單——套用 40（RLS 收緊）之後，這些人在舊版工單頁不能再改、不能再刪；請先確認補授權，名單確認前不得套用 40。
--   第 7 區：W9「profiles.role = admin 但沒有任何帶更新或管理權限的有效角色」的管理員名單——新版以角色權限為準，這些人只能看、不能改，要改請先授權。
--   第 5 區：maintenance-photos 儲存空間（舊照片）是否存在、是否私有。
--   第 3 區：第 4 批兩個函式（ga_ws_req_transition、ga_ws_req_store_action）目前的 md5；38 會覆蓋它們，套用前要與 DEV 備份（supabase/workspace-dev/_backup）一致。
-- 在 DEV 已套用 37 至 40 之後再跑：第 2 區會出現 ALREADY、第 4 區政策不再含 view_all，都是預期的；正式區尚未套用時第 2 區應全部 OK。
WITH
req_tables AS (
  SELECT t AS name FROM unnest(ARRAY['maintenance_requests', 'maintenance_updates', 'maintenance_ticket_events', 'maintenance_categories', 'maintenance_photos', 'maintenance_update_photos',
                                      'maintenance_progress_stages', 'ga_service_requests', 'ga_service_request_events', 'ga_resource_attachments', 'ga_inventory_transactions', 'ga_parts',
                                      'ga_inventory_locations', 'stores', 'store_managers', 'profiles', 'permissions', 'roles', 'role_permissions', 'user_roles']) t
),
req_fns AS (
  SELECT f AS name FROM unnest(ARRAY['has_permission', 'current_user_has_permission', 'ga_normalize_optional_text', 'ga_rq_err', 'ga_rq_raise', 'ga_rq_catch', 'ga_rq_event', 'ga_rq_docs',
                                      'ga_rq_is_store_member', 'ga_po_like_escape', 'ga_po_fmt', 'ga_ws_inv_post', 'ga_ws_req_transition', 'ga_ws_req_store_action']) f
),
new_fns AS (
  SELECT f AS name FROM unnest(ARRAY['ga_ws_wo_list', 'ga_ws_wo_get', 'ga_ws_wo_summary', 'ga_ws_wo_print', 'ga_ws_wo_transition', 'ga_ws_wo_store_confirm', 'ga_ws_wo_report_unresolved',
                                      'ga_ws_wo_reply_supplement', 'ga_ws_wo_delete', 'ga_ws_wo_create_legacy', 'ga_ws_wo_category', 'ga_ws_wo_issue_part', 'ga_wo_sync_request',
                                      'ga_wo_apply_completion_request', 'ga_wo_apply_supplement_request', 'ga_wo_apply_supplement_reply']) f
),
need_perms AS (
  SELECT c AS code FROM unnest(ARRAY['general_affairs.work_order.view_own_store', 'general_affairs.work_order.view_all', 'general_affairs.work_order.update', 'general_affairs.work_order.manage',
                                      'general_affairs.maintenance_request.create', 'general_affairs.maintenance_request.view_own_store', 'general_affairs.maintenance_request.view_all',
                                      'general_affairs.maintenance_request.update', 'cross_dept.maintenance.submit', 'cross_dept.maintenance.view_all', 'cross_dept.maintenance.update',
                                      'cross_dept.maintenance.category.edit', 'general_affairs.service_center.force_close', 'general_affairs.inventory_transaction.manage',
                                      'general_affairs.part.view', 'general_affairs.part.manage']) c
),
-- 有「更新或管理」權限的碼（Q20：修改與刪除要有這些之一）與「只算查看全部」的碼
upd_codes AS (
  SELECT c AS code FROM unnest(ARRAY['general_affairs.work_order.update', 'general_affairs.work_order.manage', 'general_affairs.maintenance_request.update', 'cross_dept.maintenance.update']) c
),
view_codes AS (
  SELECT c AS code FROM unnest(ARRAY['general_affairs.work_order.view_all', 'general_affairs.maintenance_request.view_all', 'cross_dept.maintenance.view_all']) c
),
-- 每個有效角色成員擁有的權限碼（正式區 has_permission 語意：只看 user_roles 啟用且未過期、role_permissions.is_allowed、permissions.is_active，不看 roles.is_active）
user_perm AS (
  SELECT DISTINCT ur.user_id, p.code
    FROM public.user_roles ur
    JOIN public.role_permissions rp ON rp.role_id = ur.role_id AND rp.is_allowed = true
    JOIN public.permissions p ON p.id = rp.permission_id AND p.is_active = true
   WHERE ur.is_active = true AND (ur.expires_at IS NULL OR ur.expires_at > now())
),
viewonly_users AS (
  SELECT u.user_id FROM (SELECT DISTINCT user_id FROM user_perm WHERE code IN (SELECT code FROM view_codes)) u
   WHERE NOT EXISTS (SELECT 1 FROM user_perm x WHERE x.user_id = u.user_id AND x.code IN (SELECT code FROM upd_codes))
),
admin_no_update AS (
  SELECT pr.id FROM public.profiles pr
   WHERE pr.role = 'admin' AND NOT EXISTS (SELECT 1 FROM user_perm x WHERE x.user_id = pr.id AND x.code IN (SELECT code FROM upd_codes))
),
viewonly_roles AS (
  SELECT r.id, r.code, r.name, r.is_active FROM public.roles r
   WHERE EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions p ON p.id = rp.permission_id WHERE rp.role_id = r.id AND rp.is_allowed AND p.is_active AND p.code IN (SELECT code FROM view_codes))
     AND NOT EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions p ON p.id = rp.permission_id WHERE rp.role_id = r.id AND rp.is_allowed AND p.is_active AND p.code IN (SELECT code FROM upd_codes))
),
linked AS (
  SELECT m.id, m.status, m.progress_stage, r.main_status, (r.id IS NULL OR r.deleted_at IS NOT NULL) AS req_missing
    FROM public.maintenance_requests m LEFT JOIN public.ga_service_requests r ON r.id = m.ga_service_request_id WHERE m.ga_service_request_id IS NOT NULL
),
fn_md5 AS (
  SELECT p.proname, md5(pg_get_functiondef(p.oid)) AS m FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('ga_ws_req_transition', 'ga_ws_req_store_action')
)
SELECT * FROM (
  -- 1. 先決資料表與函式（缺了就不要套用）
  SELECT 1 AS ord, '1 先決' AS section, 'table ' || t.name AS item, COALESCE(to_regclass('public.' || t.name)::text, '（不存在）') AS value,
         CASE WHEN to_regclass('public.' || t.name) IS NULL THEN 'MISSING' ELSE 'OK' END AS status FROM req_tables t
  UNION ALL
  SELECT 2, '1 先決', 'function ' || f.name, (SELECT count(*)::text || ' 個' FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = f.name),
         CASE WHEN EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = f.name) THEN 'OK' ELSE 'MISSING' END FROM req_fns f
  UNION ALL
  SELECT 3, '1 先決', 'permission ' || n.code, COALESCE((SELECT 'is_active=' || p.is_active::text FROM public.permissions p WHERE p.code = n.code), '（不存在）'),
         CASE WHEN EXISTS (SELECT 1 FROM public.permissions p WHERE p.code = n.code AND p.is_active) THEN 'OK' ELSE 'MISSING' END FROM need_perms n
  UNION ALL
  -- 2. 第 5 批物件是否已存在
  SELECT 10, '2 第 5 批物件', 'function ' || f.name, (SELECT count(*)::text || ' 個' FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = f.name),
         CASE WHEN EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = f.name) THEN 'ALREADY' ELSE 'OK' END FROM new_fns f
  UNION ALL
  -- 3. 第 4 批兩個會被 38 覆蓋的函式（md5 要與 DEV 備份一致才能直接覆蓋）
  SELECT 20, '3 第 4 批函式 md5', f.proname, f.m, 'INFO' FROM fn_md5 f
  UNION ALL
  SELECT 21, '3 第 4 批函式 md5', 'DEV 備份（supabase/workspace-dev/_backup/20261117_b4_req_functions_before_b5.sql）',
         'ga_ws_req_store_action=20a40759bb4488685c08cd885f785158；ga_ws_req_transition=a962e584ccd1679a2c246fddde688d3c', 'INFO'
  UNION ALL
  SELECT 22, '3 第 4 批函式 md5', 'md5 與 DEV 備份比對', COALESCE(string_agg(f.proname || '=' || CASE WHEN f.m = CASE f.proname WHEN 'ga_ws_req_store_action' THEN '20a40759bb4488685c08cd885f785158'
         WHEN 'ga_ws_req_transition' THEN 'a962e584ccd1679a2c246fddde688d3c' END THEN '一致' ELSE '不同' END, '；'), '（沒有這兩個函式）'),
         CASE WHEN count(*) < 2 THEN 'MISSING' WHEN bool_and(f.m = CASE f.proname WHEN 'ga_ws_req_store_action' THEN '20a40759bb4488685c08cd885f785158' WHEN 'ga_ws_req_transition' THEN 'a962e584ccd1679a2c246fddde688d3c' END) THEN 'OK' ELSE 'WARN' END
    FROM fn_md5 f
  UNION ALL
  SELECT 23, '3 第 4 批函式 md5', '38 套用前提醒', 'md5 不同＝正式區的第 4 批函式與 DEV 不一致（或已被 38 覆蓋），先用 pg_get_functiondef 比對差異再決定；已套用 38 的環境 md5 也會不同', 'INFO'
  UNION ALL
  -- 4. RLS 政策現況（40 要收緊的三條）
  SELECT 30, '4 RLS 政策', pol.policyname || '（' || pol.cmd || '）', CASE WHEN pol.qual LIKE '%view_all%' OR pol.with_check LIKE '%view_all%' THEN '目前含 view_all（尚未收緊）' ELSE '不含 view_all（已收緊或自訂）' END ||
         CASE WHEN pol.policyname = 'p1e_maintenance_requests_delete' THEN CASE WHEN pol.qual LIKE '%reported_by = auth.uid()%' AND pol.qual NOT LIKE '%UNACCEPTED%' THEN '；回報人本人無條件可刪' ELSE '' END ELSE '' END,
         CASE WHEN pol.qual LIKE '%view_all%' OR pol.with_check LIKE '%view_all%' THEN 'INFO' ELSE 'ALREADY' END
    FROM pg_policies pol WHERE pol.schemaname = 'public' AND pol.policyname IN ('p1e_maintenance_requests_update', 'p1e_maintenance_requests_delete', 'p1e_maintenance_updates_write')
  UNION ALL
  SELECT 31, '4 RLS 政策', '三條政策是否都存在', (SELECT count(*)::text || ' / 3' FROM pg_policies pol WHERE pol.schemaname = 'public' AND pol.policyname IN ('p1e_maintenance_requests_update', 'p1e_maintenance_requests_delete', 'p1e_maintenance_updates_write')),
         CASE WHEN (SELECT count(*) FROM pg_policies pol WHERE pol.schemaname = 'public' AND pol.policyname IN ('p1e_maintenance_requests_update', 'p1e_maintenance_requests_delete', 'p1e_maintenance_updates_write')) = 3 THEN 'OK' ELSE 'WARN' END
  UNION ALL
  -- 5. 儲存空間（舊照片）：maintenance-photos 是否存在、是否私有、有多少檔案與政策
  SELECT 40, '5 儲存空間', 'bucket maintenance-photos', COALESCE((SELECT 'public=' || b.public::text FROM storage.buckets b WHERE b.id = 'maintenance-photos'), '（不存在）'),
         CASE WHEN NOT EXISTS (SELECT 1 FROM storage.buckets b WHERE b.id = 'maintenance-photos') THEN 'WARN' WHEN (SELECT b.public FROM storage.buckets b WHERE b.id = 'maintenance-photos') THEN 'WARN' ELSE 'OK' END
  UNION ALL
  SELECT 41, '5 儲存空間', 'maintenance-photos 內檔案數', (SELECT count(*)::text FROM storage.objects o WHERE o.bucket_id = 'maintenance-photos'), 'INFO'
  UNION ALL
  SELECT 42, '5 儲存空間', 'storage.objects 中提到 maintenance-photos 的政策數', (SELECT count(*)::text FROM pg_policies pol WHERE pol.schemaname = 'storage' AND pol.tablename = 'objects' AND (pol.qual LIKE '%maintenance-photos%' OR pol.with_check LIKE '%maintenance-photos%')), 'INFO'
  UNION ALL
  SELECT 43, '5 儲存空間', 'bucket general-affairs-attachments（新照片走共用附件）', COALESCE((SELECT 'public=' || b.public::text FROM storage.buckets b WHERE b.id = 'general-affairs-attachments'), '（不存在）'),
         CASE WHEN NOT EXISTS (SELECT 1 FROM storage.buckets b WHERE b.id = 'general-affairs-attachments') THEN 'MISSING' WHEN (SELECT b.public FROM storage.buckets b WHERE b.id = 'general-affairs-attachments') THEN 'WARN' ELSE 'OK' END
  UNION ALL
  -- 6. Q20 名單：只有「查看全部」、沒有更新或管理權限（套 40 之後不能再改、不能再刪）
  SELECT 50, '6 Q20 只能查看全部的角色', COALESCE(r.code, '（無）'), r.name || '｜roles.is_active=' || r.is_active::text || '｜有效成員 ' ||
         (SELECT count(*)::text FROM public.user_roles ur WHERE ur.role_id = r.id AND ur.is_active = true AND (ur.expires_at IS NULL OR ur.expires_at > now())) || ' 人', 'WARN' FROM viewonly_roles r
  UNION ALL
  SELECT 51, '6 Q20 只能查看全部的人', COALESCE(pr.full_name, '（未命名）') || '｜' || COALESCE(pr.email, ''), '角色：' || COALESCE((SELECT string_agg(DISTINCT r.code, '、') FROM public.user_roles ur JOIN public.roles r ON r.id = ur.role_id
         WHERE ur.user_id = pr.id AND ur.is_active = true AND (ur.expires_at IS NULL OR ur.expires_at > now())), '（無）') || '｜profiles.role=' || COALESCE(pr.role, ''), 'WARN'
    FROM viewonly_users vu JOIN public.profiles pr ON pr.id = vu.user_id
  UNION ALL
  SELECT 52, '6 Q20 只能查看全部的人', '人數合計', (SELECT count(*)::text FROM viewonly_users), CASE WHEN (SELECT count(*) FROM viewonly_users) = 0 THEN 'OK' ELSE 'WARN' END
  UNION ALL
  -- 7. W9：profiles.role = admin 但沒有任何帶更新或管理權限的有效角色（只能看、不能改）
  SELECT 60, '7 W9 管理員沒有更新角色', COALESCE(pr.full_name, '（未命名）') || '｜' || COALESCE(pr.email, ''), '角色：' || COALESCE((SELECT string_agg(DISTINCT r.code, '、') FROM public.user_roles ur JOIN public.roles r ON r.id = ur.role_id
         WHERE ur.user_id = pr.id AND ur.is_active = true AND (ur.expires_at IS NULL OR ur.expires_at > now())), '（無）'), 'WARN'
    FROM admin_no_update a JOIN public.profiles pr ON pr.id = a.id
  UNION ALL
  SELECT 61, '7 W9 管理員沒有更新角色', '人數合計', (SELECT count(*)::text FROM admin_no_update) || ' / profiles.role=admin 共 ' || (SELECT count(*)::text FROM public.profiles WHERE role = 'admin'), CASE WHEN (SELECT count(*) FROM admin_no_update) = 0 THEN 'OK' ELSE 'WARN' END
  UNION ALL
  -- 8. 工單資料現況
  SELECT 70, '8 工單資料', 'maintenance_requests 總筆數', (SELECT count(*)::text FROM public.maintenance_requests), 'INFO'
  UNION ALL
  SELECT 71, '8 工單資料', '各狀態筆數', COALESCE((SELECT string_agg(s.status || '=' || s.n, '、' ORDER BY s.status) FROM (SELECT status, count(*)::text AS n FROM public.maintenance_requests GROUP BY status) s), '（沒有工單）'), 'INFO'
  UNION ALL
  SELECT 72, '8 工單資料', '舊式工單（沒有連需求單）筆數', (SELECT count(*)::text FROM public.maintenance_requests WHERE ga_service_request_id IS NULL), 'INFO'
  UNION ALL
  SELECT 73, '8 工單資料', '有連需求單但需求單已刪除、已結案（完成／退回／取消）而工單還沒完成', (SELECT count(*)::text FROM linked l WHERE l.status <> 'COMPLETED' AND (l.req_missing OR l.main_status IN ('COMPLETED', 'REJECTED', 'CANCELED'))),
         CASE WHEN (SELECT count(*) FROM linked l WHERE l.status <> 'COMPLETED' AND (l.req_missing OR l.main_status IN ('COMPLETED', 'REJECTED', 'CANCELED'))) = 0 THEN 'OK' ELSE 'WARN' END
  UNION ALL
  SELECT 74, '8 工單資料', '狀態與階段不一致（未受理卻有階段、待門市確認階段卻不是處理中、已完成卻是「待確認」之外的處理中階段等）',
         (SELECT count(*)::text FROM public.maintenance_requests m WHERE (m.status = 'UNACCEPTED' AND m.progress_stage IS NOT NULL) OR (m.progress_stage = 'WAITING_STORE_CONFIRMATION' AND m.status NOT IN ('PROCESSING', 'COMPLETED'))
            OR (m.status = 'COMPLETED' AND m.completion_method IS NULL)),
         CASE WHEN (SELECT count(*) FROM public.maintenance_requests m WHERE (m.status = 'UNACCEPTED' AND m.progress_stage IS NOT NULL) OR (m.progress_stage = 'WAITING_STORE_CONFIRMATION' AND m.status NOT IN ('PROCESSING', 'COMPLETED'))
            OR (m.status = 'COMPLETED' AND m.completion_method IS NULL)) = 0 THEN 'OK' ELSE 'WARN' END
  UNION ALL
  SELECT 75, '8 工單資料', '承辦人或處理方式疑似被舊版每次存進度覆蓋（有 2 筆以上進度紀錄但承辦人或處理方式是空的）',
         (SELECT count(*)::text FROM public.maintenance_requests m WHERE m.status <> 'UNACCEPTED' AND (m.assignee_name IS NULL OR m.handling_method IS NULL) AND (SELECT count(*) FROM public.maintenance_updates u WHERE u.request_id = m.id) >= 2), 'INFO'
  UNION ALL
  SELECT 76, '8 工單資料', '舊式未受理工單（回報人與總務可在新版刪除的對象）', (SELECT count(*)::text FROM public.maintenance_requests WHERE status = 'UNACCEPTED' AND ga_service_request_id IS NULL), 'INFO'
  UNION ALL
  SELECT 77, '8 工單資料', '舊照片列數（maintenance_photos／maintenance_update_photos）', (SELECT count(*)::text FROM public.maintenance_photos) || ' ／ ' || (SELECT count(*)::text FROM public.maintenance_update_photos), 'INFO'
  UNION ALL
  SELECT 78, '8 工單資料', '共用附件（維修類）筆數', (SELECT count(*)::text FROM public.ga_resource_attachments WHERE resource_type IN ('MAINTENANCE_REQUEST', 'MAINTENANCE_UPDATE') AND deleted_at IS NULL), 'INFO'
  UNION ALL
  SELECT 79, '8 工單資料', '維修分類筆數（新版跨部門頁的分類管理用）', (SELECT count(*)::text FROM public.maintenance_categories), 'INFO'
  UNION ALL
  -- 9. 16 個進度階段（程式常數固定 16 碼；OTHER 排序以 990 為準）
  SELECT 80, '9 進度階段', 'maintenance_progress_stages 列數', (SELECT count(*)::text FROM public.maintenance_progress_stages), CASE WHEN (SELECT count(*) FROM public.maintenance_progress_stages) = 16 THEN 'OK' ELSE 'WARN' END
  UNION ALL
  SELECT 81, '9 進度階段', 'OTHER 的排序', COALESCE((SELECT sort_order::text FROM public.maintenance_progress_stages WHERE code = 'OTHER'), '（沒有 OTHER）'),
         CASE WHEN (SELECT sort_order FROM public.maintenance_progress_stages WHERE code = 'OTHER') = 990 THEN 'OK' ELSE 'WARN' END
  UNION ALL
  SELECT 82, '9 進度階段', '階段碼與新版常數不同的碼', COALESCE((SELECT string_agg(code, '、') FROM public.maintenance_progress_stages WHERE code <> ALL (ARRAY['INITIAL_REVIEW', 'WAITING_STORE_INFO', 'INTERNAL_HANDLING', 'SEARCHING_VENDOR',
         'WAITING_VENDOR_REPLY', 'WAITING_VENDOR_QUOTE', 'QUOTE_REVIEW', 'VENDOR_ASSIGNED', 'WAITING_VENDOR_VISIT', 'VENDOR_WORKING', 'WAITING_PARTS', 'PARTS_IN_TRANSIT', 'WAITING_INTERNAL_APPROVAL',
         'WAITING_STORE_CONFIRMATION', 'REOPENED', 'OTHER']::text[])), '（無）'),
         CASE WHEN EXISTS (SELECT 1 FROM public.maintenance_progress_stages WHERE code <> ALL (ARRAY['INITIAL_REVIEW', 'WAITING_STORE_INFO', 'INTERNAL_HANDLING', 'SEARCHING_VENDOR', 'WAITING_VENDOR_REPLY', 'WAITING_VENDOR_QUOTE',
         'QUOTE_REVIEW', 'VENDOR_ASSIGNED', 'WAITING_VENDOR_VISIT', 'VENDOR_WORKING', 'WAITING_PARTS', 'PARTS_IN_TRANSIT', 'WAITING_INTERNAL_APPROVAL', 'WAITING_STORE_CONFIRMATION', 'REOPENED', 'OTHER']::text[])) THEN 'WARN' ELSE 'OK' END
  UNION ALL
  -- 10. 庫存流水的參考單據（領用料件 W2 用 MAINTENANCE_REQUEST）：不能有值域 CHECK 擋住
  SELECT 90, '10 庫存流水', 'ga_inventory_transactions.reference_type 的 CHECK', COALESCE((SELECT string_agg(conname, '、') FROM pg_constraint WHERE conrelid = 'public.ga_inventory_transactions'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%reference_type%IN%'), '（沒有值域限制）'),
         CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.ga_inventory_transactions'::regclass AND contype = 'c' AND (pg_get_constraintdef(oid) ILIKE '%reference_type%IN%' OR pg_get_constraintdef(oid) ILIKE '%reference_type%ANY%')) THEN 'WARN' ELSE 'OK' END
  UNION ALL
  SELECT 91, '10 庫存流水', 'maintenance_ticket_events.event_type 的 CHECK（新事件類型 PART_ISSUED 等）', COALESCE((SELECT string_agg(conname, '、') FROM pg_constraint WHERE conrelid = 'public.maintenance_ticket_events'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%event_type%'), '（沒有值域限制）'),
         CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.maintenance_ticket_events'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%event_type%') THEN 'WARN' ELSE 'OK' END
) q
ORDER BY ord, section, item;
