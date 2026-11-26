-- 還原 15_employee_management.sql：先拿掉兩個觸發器（舊版寫入行為立刻恢復），再移除員工相關函式，最後移除空的資料表。
-- 不動舊版任何資料；觸發器只在 INSERT 時檢查，不曾修改既有資料列
-- （唯一例外：monthly_staff_status 手動新增列的 employment_type 曾被觸發器依員編寫入，還原不會改回）。
-- 資料表保護：4 張請求去重回執表與 monthly_staff_recheck 只有「完全沒有資料」才會移除；有資料就保留並提示，
--   以免遺失紀錄（monthly_staff_recheck 也可能已被異動回寫沿用）。確定不需要時請自行 DROP TABLE。
-- 共用函式保護：workspace_monthly_recheck_add、workspace_staff_month_locked、workspace_employee_id_valid、workspace_employee_id_type
--   若已被其他函式（例如之後套用的異動草稿）引用，會保留並提示，不會被刪除。
BEGIN;

DROP TRIGGER IF EXISTS workspace_guard_onboarding_code ON public.employee_movement_history;
DROP TRIGGER IF EXISTS workspace_guard_manual_staff_code ON public.monthly_staff_status;
DROP FUNCTION IF EXISTS public.workspace_guard_onboarding_code();
DROP FUNCTION IF EXISTS public.workspace_guard_manual_staff_code();

DROP FUNCTION IF EXISTS public.workspace_employee_import_save(uuid,uuid,jsonb,uuid[]);
DROP FUNCTION IF EXISTS public.workspace_employee_import_check(jsonb,uuid[]);
DROP FUNCTION IF EXISTS public.workspace_employee_edit(uuid,uuid,jsonb,jsonb);
DROP FUNCTION IF EXISTS public.workspace_employee_edit_state(text);
DROP FUNCTION IF EXISTS public.workspace_employee_create(uuid,uuid,jsonb);
DROP FUNCTION IF EXISTS public.workspace_birthday_save(uuid,uuid,jsonb,text,uuid[]);
DROP FUNCTION IF EXISTS public.workspace_birthday_snapshot(text[]);

DO $$
DECLARE n bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname NOT IN ('workspace_monthly_recheck_add','workspace_staff_month_locked') AND (p.prosrc LIKE '%workspace_monthly_recheck_add%' OR p.prosrc LIKE '%workspace_staff_month_locked%')) THEN
    RAISE NOTICE '保留 workspace_monthly_recheck_add／workspace_staff_month_locked：已被其他函式引用';
  ELSE
    DROP FUNCTION IF EXISTS public.workspace_monthly_recheck_add(uuid,text,text,uuid,text,uuid,text,text,text,text,text,text,text);
    DROP FUNCTION IF EXISTS public.workspace_staff_month_locked(uuid,text,text);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname NOT IN ('workspace_employee_id_valid','workspace_employee_id_type') AND (p.prosrc LIKE '%workspace_employee_id_valid%' OR p.prosrc LIKE '%workspace_employee_id_type%')) THEN
    RAISE NOTICE '保留 workspace_employee_id_valid／workspace_employee_id_type：已被其他函式引用';
  ELSE
    DROP FUNCTION IF EXISTS public.workspace_employee_id_valid(text);
    DROP FUNCTION IF EXISTS public.workspace_employee_id_type(text);
  END IF;

  IF to_regclass('public.workspace_birthday_requests') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.workspace_birthday_requests' INTO n;
    IF n=0 THEN DROP TABLE public.workspace_birthday_requests; ELSE RAISE NOTICE '保留 workspace_birthday_requests（% 筆）', n; END IF;
  END IF;
  IF to_regclass('public.workspace_employee_create_requests') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.workspace_employee_create_requests' INTO n;
    IF n=0 THEN DROP TABLE public.workspace_employee_create_requests; ELSE RAISE NOTICE '保留 workspace_employee_create_requests（% 筆）', n; END IF;
  END IF;
  IF to_regclass('public.workspace_employee_edit_requests') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.workspace_employee_edit_requests' INTO n;
    IF n=0 THEN DROP TABLE public.workspace_employee_edit_requests; ELSE RAISE NOTICE '保留 workspace_employee_edit_requests（% 筆）', n; END IF;
  END IF;
  IF to_regclass('public.workspace_employee_import_receipts') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.workspace_employee_import_receipts' INTO n;
    IF n=0 THEN DROP TABLE public.workspace_employee_import_receipts; ELSE RAISE NOTICE '保留 workspace_employee_import_receipts（% 筆）', n; END IF;
  END IF;
  IF to_regclass('public.monthly_staff_recheck') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.monthly_staff_recheck' INTO n;
    IF n=0 THEN DROP TABLE public.monthly_staff_recheck; ELSE RAISE NOTICE '保留 monthly_staff_recheck（% 筆）', n; END IF;
  END IF;
END $$;

NOTIFY pgrst,'reload schema';
COMMIT;
