-- 05-ga-improve-b1-permission-label 只讀驗證（G12 權限顯示名稱）：每列回 pass 或 fail，全部 pass 才算套用成功。只有 SELECT，沒有任何寫入。
SELECT '沒有新增任何權限碼（預付、同仁帳戶、買受人公司都用既有權限）' AS check_name, CASE WHEN NOT EXISTS (SELECT 1 FROM public.permissions WHERE code ~ '(prepay|payout|buyer_compan|reimburs)') THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '函式本體不再有舊名稱「水電網費管理」' AS check_name, CASE WHEN NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.prokind = 'f' AND position('水電網費管理' IN p.prosrc) > 0) THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '權限碼 general_affairs.utility_bill.manage 仍存在（只改顯示名稱，權限碼不變）' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM public.permissions WHERE code = 'general_affairs.utility_bill.manage') THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT 'permissions 表沒有任何欄位還含舊名稱' AS check_name, CASE WHEN NOT EXISTS (SELECT 1 FROM public.permissions p WHERE to_jsonb(p)::text LIKE '%水電網費管理%') THEN 'pass' ELSE 'fail' END AS result
ORDER BY 1;
