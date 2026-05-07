-- 修正 quizzes 表的 403 權限問題（PostgREST /rest/v1/quizzes）
-- 根因分析：
--   1) code 42501: permission denied for table quizzes
--      → authenticated role 缺少 table-level GRANT
--   2) auth.jwt() ->> 'role' 永遠回傳 'authenticated'（非自訂角色名）
--      → 前版 policy 條件永遠為 false，導致 RLS 封鎖所有操作
--
-- 修正策略：
--   對內部系統，以「已登入」作為存取控制依據即可。
--   允許所有 authenticated 使用者讀寫 quizzes 及相關子表。

BEGIN;

-- ============================================================
-- 0. 確認 quizzes 表存在
-- ============================================================
DO $$
BEGIN
  IF to_regclass('public.quizzes') IS NULL THEN
    RAISE EXCEPTION 'table public.quizzes does not exist – 請確認在正確的 Supabase 專案執行此腳本';
  END IF;
END $$;

-- ============================================================
-- 1. Schema / Table GRANT（缺這個會直接 403，RLS 設定無效）
-- ============================================================
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.quizzes TO authenticated;

-- 若有 quiz_questions / quiz_options 子表，一並補上
DO $$
BEGIN
  IF to_regclass('public.quiz_questions') IS NOT NULL THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.quiz_questions TO authenticated;
  END IF;
  IF to_regclass('public.quiz_options') IS NOT NULL THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.quiz_options TO authenticated;
  END IF;
END $$;

-- 補 sequence 權限（identity / serial 主鍵）
DO $$
DECLARE
  v_seq text;
BEGIN
  FOR v_seq IN
    SELECT pg_get_serial_sequence(t, 'id')
    FROM (VALUES ('public.quizzes'), ('public.quiz_questions'), ('public.quiz_options')) AS x(t)
    WHERE to_regclass(t) IS NOT NULL
      AND pg_get_serial_sequence(t, 'id') IS NOT NULL
  LOOP
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO authenticated', v_seq);
  END LOOP;
END $$;

-- ============================================================
-- 2. RLS：啟用後建立「已登入即可」policy
-- ============================================================
ALTER TABLE public.quizzes ENABLE ROW LEVEL SECURITY;

-- 移除舊 policy
DROP POLICY IF EXISTS "quizzes_select_authenticated"  ON public.quizzes;
DROP POLICY IF EXISTS "quizzes_modify_authenticated"  ON public.quizzes;
DROP POLICY IF EXISTS "quizzes_all_authenticated"     ON public.quizzes;

-- 建立新 policy：只要 auth.uid() 不為 null（即已登入）即允許
CREATE POLICY "quizzes_all_authenticated"
  ON public.quizzes
  FOR ALL
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- 子表同步處理
DO $$
BEGIN
  IF to_regclass('public.quiz_questions') IS NOT NULL THEN
    ALTER TABLE public.quiz_questions ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "quiz_questions_all_authenticated" ON public.quiz_questions;
    CREATE POLICY "quiz_questions_all_authenticated"
      ON public.quiz_questions FOR ALL TO authenticated
      USING (auth.uid() IS NOT NULL)
      WITH CHECK (auth.uid() IS NOT NULL);
  END IF;

  IF to_regclass('public.quiz_options') IS NOT NULL THEN
    ALTER TABLE public.quiz_options ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "quiz_options_all_authenticated" ON public.quiz_options;
    CREATE POLICY "quiz_options_all_authenticated"
      ON public.quiz_options FOR ALL TO authenticated
      USING (auth.uid() IS NOT NULL)
      WITH CHECK (auth.uid() IS NOT NULL);
  END IF;
END $$;

COMMIT;

-- ============================================================
-- 驗證查詢（執行完上方腳本後，另開視窗依序執行）
-- ============================================================

-- 1) 確認 table-level grant 已補上
-- SELECT grantee, privilege_type
-- FROM information_schema.role_table_grants
-- WHERE table_schema = 'public' AND table_name = 'quizzes'
-- ORDER BY grantee, privilege_type;

-- 2) 確認 RLS 已啟用且 policy 建立正確
-- SELECT schemaname, tablename, policyname, cmd, roles, qual
-- FROM pg_policies
-- WHERE schemaname = 'public' AND tablename LIKE '%quiz%'
-- ORDER BY tablename, policyname;

-- 3) 確認相關子表是否存在
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public' AND table_name LIKE '%quiz%'
-- ORDER BY table_name;
