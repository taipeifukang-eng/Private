-- 總務採購與請款改善第一批（ga-improve-b1）階段 1：G12 權限顯示名稱「水電網費管理」改為「水電話網費管理」（DEV；正式區草稿 ga-improve-b1-sql/05 同一個替換，只在有舊名稱的函式與列動）。
-- 只改顯示字串：權限碼 general_affairs.utility_bill.manage 不變、不新增權限碼、不授權給任何角色。
-- 做法：
--   1. public 結構裡所有「函式本體含舊名稱」的函式，讀現行定義、整段文字替換後重新建立（只動字串；其他內容、屬性、權限完全相同）；已經是新名稱的略過。
--   2. permissions 表如果有「名稱」類文字欄位（name、title、label）或 description 含舊名稱，只更新含舊名稱的列；DEV 的 permissions 表沒有名稱欄位，description 也不含舊名稱，所以 DEV 這一步沒有任何動作。
--      畫面標籤的來源是程式內常數（UTILITY_BILL_MANAGE_LABEL）。
-- 可重複執行。還原：20261125090000_ga_improve_b1_perm_label.rollback.sql（把新名稱換回舊名稱）。

DO $$
DECLARE
  r record;
  v_def text;
  v_n integer := 0;
BEGIN
  FOR r IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.prokind = 'f' AND position('水電網費管理' IN p.prosrc) > 0 ORDER BY p.oid LOOP
    v_def := pg_get_functiondef(r.oid);
    EXECUTE replace(v_def, '水電網費管理', '水電話網費管理');
    v_n := v_n + 1;
  END LOOP;
  RAISE NOTICE '已更新 % 支函式的顯示名稱', v_n;
END $$;

DO $$
DECLARE
  v_col text;
BEGIN
  IF to_regclass('public.permissions') IS NULL THEN RETURN; END IF;
  FOREACH v_col IN ARRAY ARRAY['name', 'title', 'label', 'description'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'permissions' AND column_name = v_col AND data_type IN ('text', 'character varying')) THEN
      EXECUTE format('UPDATE public.permissions SET %1$I = replace(%1$I, %2$L, %3$L) WHERE code = %4$L AND position(%2$L IN %1$I) > 0', v_col, '水電網費管理', '水電話網費管理', 'general_affairs.utility_bill.manage');
    END IF;
  END LOOP;
END $$;
NOTIFY pgrst, 'reload schema';
