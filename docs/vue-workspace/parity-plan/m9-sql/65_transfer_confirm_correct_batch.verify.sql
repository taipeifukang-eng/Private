-- ============================================================================
-- 65_transfer_confirm_correct_batch.verify.sql  （唯讀驗證，只有 SELECT；套用前後各跑一次）
-- 每列 ok 欄位：套用前只有「依賴」與「權限碼」兩列有意義（其餘表尚未建立時整段會報錯，屬正常）；套用後所有列都應為 true。
-- ============================================================================
SELECT '依賴：workspace_acting_active 存在（由其他草稿提供）' AS 檢查, to_regprocedure('public.workspace_acting_active(text,uuid,date)') IS NOT NULL AS ok
UNION ALL SELECT '依賴：workspace_roster_recompute 存在（由其他草稿提供）', to_regprocedure('public.workspace_roster_recompute(uuid,text,text,text,uuid,boolean,boolean,text,text,text)') IS NOT NULL
UNION ALL SELECT '權限碼 employee.store_transfer.confirm 存在且啟用（本草稿不建立、不授權）', EXISTS(SELECT 1 FROM public.permissions WHERE code='employee.store_transfer.confirm' AND is_active=true)
UNION ALL SELECT '正式區既有欄位 corrected_at／corrected_by／correction_reason', (SELECT count(*)=3 FROM information_schema.columns WHERE table_schema='public' AND table_name='store_transfer_requests' AND column_name IN('corrected_at','corrected_by','correction_reason'))
UNION ALL SELECT '申請表新欄位 requested_date／acting_ended／continue_acting／acting_movement_id', (SELECT count(*)=4 FROM information_schema.columns WHERE table_schema='public' AND table_name='store_transfer_requests' AND column_name IN('requested_date','acting_ended','continue_acting','acting_movement_id'))
UNION ALL SELECT '員工主檔 newbie_level 欄位', EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='store_employees' AND column_name='newbie_level')
UNION ALL SELECT '表 store_transfer_confirmations 存在', to_regclass('public.store_transfer_confirmations') IS NOT NULL
UNION ALL SELECT '表 workspace_transfer_corrections 存在', to_regclass('public.workspace_transfer_corrections') IS NOT NULL
UNION ALL SELECT '確認表有 request_id 唯一索引（一申請一筆）', EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='store_transfer_confirmations' AND indexdef ILIKE '%UNIQUE%(request_id)%')
UNION ALL SELECT '確認表沒有重複列', NOT EXISTS(SELECT 1 FROM public.store_transfer_confirmations GROUP BY request_id HAVING count(*)>1)
UNION ALL SELECT '兩張新表已啟用 RLS', (SELECT count(*)=2 FROM pg_class WHERE oid IN('public.store_transfer_confirmations'::regclass,'public.workspace_transfer_corrections'::regclass) AND relrowsecurity)
UNION ALL SELECT '兩張新表前端角色無任何權限', NOT EXISTS(SELECT 1 FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name IN('store_transfer_confirmations','workspace_transfer_corrections') AND grantee IN('anon','authenticated','PUBLIC'))
UNION ALL SELECT '函式 workspace_transfer_snapshot(uuid) 存在', to_regprocedure('public.workspace_transfer_snapshot(uuid)') IS NOT NULL
UNION ALL SELECT '函式 workspace_transfer_confirm(uuid,uuid,date,text) 存在', to_regprocedure('public.workspace_transfer_confirm(uuid,uuid,date,text)') IS NOT NULL
UNION ALL SELECT '函式 workspace_transfer_correct(uuid,uuid,date,text,text,uuid) 存在', to_regprocedure('public.workspace_transfer_correct(uuid,uuid,date,text,text,uuid)') IS NOT NULL
UNION ALL SELECT '舊的 3 參數 confirm 不存在（正式區本來就沒有）', to_regprocedure('public.workspace_transfer_confirm(uuid,uuid,date)') IS NULL
UNION ALL SELECT '三支函式只有 service_role 可執行', NOT EXISTS(SELECT 1 FROM information_schema.routine_privileges WHERE specific_schema='public' AND routine_name IN('workspace_transfer_snapshot','workspace_transfer_confirm','workspace_transfer_correct') AND grantee IN('anon','authenticated','PUBLIC'))
UNION ALL SELECT '函式已改成正式區權限語意（沒有 roles.is_active 與角色代碼白名單）', NOT EXISTS(
  SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN('workspace_transfer_confirm','workspace_transfer_correct')
   AND (pg_get_functiondef(oid) LIKE '%r.is_active=true%' OR pg_get_functiondef(oid) LIKE '%full_admin_role%'))
UNION ALL SELECT '函式沒有「未來日期不可」限制', NOT EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN('workspace_transfer_confirm','workspace_transfer_correct') AND pg_get_functiondef(oid) LIKE '%WORKSPACE_FUTURE_POLICY_PENDING%');

-- 資料面（唯讀，僅供人工查看）
SELECT '員工主檔階段欄位：有值筆數／在職新人行政仍為空筆數' AS 項目,
  count(*) FILTER (WHERE newbie_level IS NOT NULL) AS 有值,
  count(*) FILTER (WHERE newbie_level IS NULL AND is_active AND current_position IN ('新人','行政')) AS 在職新人行政仍為空
FROM public.store_employees;

SELECT '調店申請狀態分佈' AS 項目, status, count(*) AS 筆數 FROM public.store_transfer_requests GROUP BY status ORDER BY status;

-- 已確認但沒有確認紀錄的調店（套用前就已確認的舊資料會有，屬正常；僅供查看）
SELECT '已確認但無確認紀錄的調店申請筆數' AS 項目, count(*) AS 筆數
FROM public.store_transfer_requests r
WHERE r.status='confirmed' AND NOT EXISTS(SELECT 1 FROM public.store_transfer_confirmations c WHERE c.request_id=r.id);
