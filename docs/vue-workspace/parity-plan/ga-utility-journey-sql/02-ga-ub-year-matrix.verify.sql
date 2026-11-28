-- 02-ga-ub-year-matrix 只讀驗證（年度逐月檢視）：每列回 pass 或 fail，全部 pass 才算套用成功。只有 SELECT，沒有任何寫入。
SELECT '函式 ga_ws_ub_year_matrix(integer) 存在' AS check_name, CASE WHEN to_regprocedure('public.ga_ws_ub_year_matrix(integer)') IS NOT NULL THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '只開放給登入者（匿名不能執行）' AS check_name, CASE WHEN to_regprocedure('public.ga_ws_ub_year_matrix(integer)') IS NOT NULL
  AND has_function_privilege('authenticated', 'public.ga_ws_ub_year_matrix(integer)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.ga_ws_ub_year_matrix(integer)', 'EXECUTE') THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '函式是唯讀（STABLE）' AS check_name, CASE WHEN to_regprocedure('public.ga_ws_ub_year_matrix(integer)') IS NOT NULL
  AND (SELECT provolatile FROM pg_proc WHERE oid = 'public.ga_ws_ub_year_matrix(integer)'::regprocedure) = 's' THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '既有月／季／年報表函式仍在' AS check_name, CASE WHEN to_regprocedure('public.ga_ws_ub_report(text,integer,text)') IS NOT NULL THEN 'pass' ELSE 'fail' END AS result;
