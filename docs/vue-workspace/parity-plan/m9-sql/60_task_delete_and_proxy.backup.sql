-- 60_task_delete_and_proxy 的備份（先執行這份，再執行主檔）。
-- 白話說明：主檔會改寫正式區現有函式 workspace_save_task_template（讓被指派人可以是「跨部門支援人員」），
-- 並新增 logs.proxy 欄位。這份備份把「改之前的函式原始碼」存到備份表 m9_backup_m3_functions，
-- 萬一要回復，可直接用備份的原始碼重建。可重複執行：同一個函式、同一段原始碼只會備份一次。
-- 備份表啟用 RLS 並收回 anon／authenticated 權限，只有 service_role／資料庫管理者能讀。
-- 本檔只建立備份表並寫入備份，不修改任何既有資料表或函式。
CREATE TABLE IF NOT EXISTS public.m9_backup_m3_functions (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  func_name    text NOT NULL,
  func_def     text NOT NULL,
  backed_up_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (func_name, func_def)
);
ALTER TABLE public.m9_backup_m3_functions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.m9_backup_m3_functions FROM PUBLIC, anon, authenticated;

INSERT INTO public.m9_backup_m3_functions (func_name, func_def)
SELECT p.oid::regprocedure::text, pg_get_functiondef(p.oid)
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('workspace_save_task_template', 'workspace_save_task_v2',
                    'workspace_delete_assignment', 'workspace_delete_template',
                    'workspace_assignment_progress_complete')
ON CONFLICT (func_name, func_def) DO NOTHING;

-- 看備份結果（主檔尚未執行時，只會有 workspace_save_task_template；其餘函式本來就不存在，這是正常的）
SELECT func_name, length(func_def) AS def_length, backed_up_at FROM public.m9_backup_m3_functions ORDER BY id;
