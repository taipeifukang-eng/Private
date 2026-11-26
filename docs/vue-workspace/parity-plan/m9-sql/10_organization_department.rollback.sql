-- 還原 10_organization_department.sql：只移除本草稿新增的 6 個函式與 2 張防重送表。
-- 不動正式區舊版的組織四表、work_* 三表、觸發器、權限碼，也不動它們的資料。
-- 注意：兩張 *_requests 表只存「防重送」紀錄，移除後不影響組織與職掌資料；若想保留，請先自行備份。
-- 可重複執行。
BEGIN;
DROP FUNCTION IF EXISTS public.workspace_department_save(uuid,uuid,jsonb,text);
DROP FUNCTION IF EXISTS public.workspace_department_catalog(uuid);
DROP FUNCTION IF EXISTS public.workspace_department_version(uuid);
DROP FUNCTION IF EXISTS public.workspace_organization_save(uuid,uuid,text,jsonb,text);
DROP FUNCTION IF EXISTS public.workspace_organization_catalog();
DROP FUNCTION IF EXISTS public.workspace_organization_snapshot();
DROP TABLE IF EXISTS public.workspace_department_requests;
DROP TABLE IF EXISTS public.workspace_organization_requests;
NOTIFY pgrst,'reload schema';
COMMIT;
