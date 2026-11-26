-- M9 草稿 20 任務核心：還原。移除觸發器、函式、收據表與兩個 workspace_version 欄位。
-- 注意：收據表內容（只用於重送去重）與版本號會消失；assignments／templates／logs／協作者的業務資料不動。
-- 順序：若已套用 60_task_delete_and_proxy，請先執行 60 的 rollback，再執行本檔（60 的 workspace_save_task_v2 要寫本檔的 workspace_task_receipts）。
-- 還原後新版任務頁無法存檔，需同時用 M9 逐頁開關把相關頁面切回舊版。可重複執行。
BEGIN;
DROP TRIGGER IF EXISTS workspace_task_version ON public.assignments;
DROP TRIGGER IF EXISTS workspace_task_logs_version ON public.logs;
DROP TRIGGER IF EXISTS workspace_task_collaborators_version ON public.assignment_collaborators;
DROP TRIGGER IF EXISTS workspace_task_template_version ON public.templates;
DROP TRIGGER IF EXISTS workspace_template_version ON public.templates;
DROP FUNCTION IF EXISTS public.workspace_dispatch_task(uuid,bigint,uuid,bigint,uuid,uuid,text,text,jsonb);
DROP FUNCTION IF EXISTS public.workspace_save_task_template(uuid,uuid,bigint,jsonb,uuid,text,jsonb);
DROP FUNCTION IF EXISTS public.workspace_archive_template_tasks(uuid,uuid,uuid,text,jsonb);
DROP FUNCTION IF EXISTS public.workspace_copy_archived_task(uuid,uuid,bigint,uuid,text);
DROP FUNCTION IF EXISTS public.workspace_save_task(uuid,uuid,bigint,uuid,text,jsonb,text);
DROP FUNCTION IF EXISTS public.workspace_template_version();
DROP FUNCTION IF EXISTS public.workspace_task_template_version();
DROP FUNCTION IF EXISTS public.workspace_task_child_version();
DROP FUNCTION IF EXISTS public.workspace_task_version();
DROP TABLE IF EXISTS public.workspace_task_dispatch_receipts;
DROP TABLE IF EXISTS public.workspace_template_receipts;
DROP TABLE IF EXISTS public.workspace_task_archive_receipts;
DROP TABLE IF EXISTS public.workspace_task_copy_receipts;
DROP TABLE IF EXISTS public.workspace_task_receipts;
ALTER TABLE public.assignments DROP COLUMN IF EXISTS workspace_version;
ALTER TABLE public.templates DROP COLUMN IF EXISTS workspace_version;
NOTIFY pgrst, 'reload schema';
COMMIT;
