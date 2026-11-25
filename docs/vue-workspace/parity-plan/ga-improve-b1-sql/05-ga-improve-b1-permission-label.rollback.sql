-- 正式區草稿 ga-improve-b1-sql/05-ga-improve-b1-permission-label.rollback.sql（G12 權限顯示名稱）：SQL 內容與 DEV 實測檔 supabase/workspace-dev/20261125090000_ga_improve_b1_perm_label.rollback.sql 完全相同（只差這幾行說明）。
-- 套用前先跑 00-preview-before-apply.sql 確認現況與先決條件；套用後跑 05-ga-improve-b1-permission-label.verify.sql，全部 pass 才算成功。不新增權限碼、不授權給任何角色。
-- 既有函式採「讀現行定義＋文字替換」：形狀與預期不符就中止（不整支覆蓋），所以正式區函式與 DEV 有出入時會停下來，不會寫壞。
-- 還原 20261125090000_ga_improve_b1_perm_label.sql：把函式本體裡的「水電話網費管理」換回「水電網費管理」；permissions 表有名稱類文字欄位時同樣換回（DEV 沒有，不動）。其他內容不動。可重複執行。
DO $$
DECLARE
  r record;
  v_def text;
  v_n integer := 0;
BEGIN
  FOR r IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.prokind = 'f' AND position('水電話網費管理' IN p.prosrc) > 0 ORDER BY p.oid LOOP
    v_def := pg_get_functiondef(r.oid);
    EXECUTE replace(v_def, '水電話網費管理', '水電網費管理');
    v_n := v_n + 1;
  END LOOP;
  RAISE NOTICE '已還原 % 支函式的顯示名稱', v_n;
END $$;

DO $$
DECLARE
  v_col text;
BEGIN
  IF to_regclass('public.permissions') IS NULL THEN RETURN; END IF;
  FOREACH v_col IN ARRAY ARRAY['name', 'title', 'label', 'description'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'permissions' AND column_name = v_col AND data_type IN ('text', 'character varying')) THEN
      EXECUTE format('UPDATE public.permissions SET %1$I = replace(%1$I, %2$L, %3$L) WHERE code = %4$L AND position(%2$L IN %1$I) > 0', v_col, '水電話網費管理', '水電網費管理', 'general_affairs.utility_bill.manage');
    END IF;
  END LOOP;
END $$;
NOTIFY pgrst, 'reload schema';
