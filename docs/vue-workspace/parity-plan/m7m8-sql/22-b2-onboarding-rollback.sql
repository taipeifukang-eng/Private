-- 22-b2-onboarding-rollback.sql
-- 撤回 22：移除設施貼標函式與觸發器、依備份把 ga_resource_attachment_can_manage 還原成套用前的內容、移除 ga_facilities 的 6 個貼標欄位。會寫入。
-- 注意：會刪除設施的貼標進度與複核紀錄（onboarding_* 欄位）。執行前請先備份：
--   CREATE TABLE ga_facilities_onboarding_bak AS SELECT id, onboarding_status, onboarding_review_note, onboarding_reviewed_at, onboarding_reviewed_by,
--          onboarding_requires_primary_photo, onboarding_requires_label_photo FROM ga_facilities;
-- 附件資料本身不動。23 不依賴本檔的物件，可獨立保留。
BEGIN;

DO $$
DECLARE
  v_def text;
BEGIN
  SELECT definition INTO v_def FROM public.ga_m7m8_function_backups WHERE name = 'ga_resource_attachment_can_manage(text,uuid)';
  IF v_def IS NULL THEN
    RAISE EXCEPTION '找不到 ga_resource_attachment_can_manage 的備份（ga_m7m8_function_backups），不要撤回，請先回報';
  END IF;
  EXECUTE v_def;
END $$;
DROP FUNCTION IF EXISTS public.ga_ws_onboarding_progress(uuid, boolean);
DROP FUNCTION IF EXISTS public.ga_ws_review_onboarding(text, uuid, text, text);
DROP FUNCTION IF EXISTS public.ga_ws_submit_onboarding_photo(text, uuid, text, text, text, text, bigint);
DROP FUNCTION IF EXISTS public.ga_ws_onboarding_list(text[], text, uuid, text, integer, integer);
DROP TRIGGER IF EXISTS trg_ga_resource_attachments_facility_onboarding_sync ON public.ga_resource_attachments;
DROP FUNCTION IF EXISTS public.ga_resource_attachment_sync_facility_onboarding();
DROP FUNCTION IF EXISTS public.ga_sync_facility_onboarding_status(uuid);
DROP FUNCTION IF EXISTS public.ga_calculate_facility_onboarding_status(uuid);
ALTER TABLE public.ga_facilities DROP CONSTRAINT IF EXISTS ga_facilities_onboarding_status_check;
DROP INDEX IF EXISTS public.idx_ga_facilities_onboarding_status;
ALTER TABLE public.ga_facilities
  DROP COLUMN IF EXISTS onboarding_requires_label_photo,
  DROP COLUMN IF EXISTS onboarding_requires_primary_photo,
  DROP COLUMN IF EXISTS onboarding_reviewed_by,
  DROP COLUMN IF EXISTS onboarding_reviewed_at,
  DROP COLUMN IF EXISTS onboarding_review_note,
  DROP COLUMN IF EXISTS onboarding_status;
NOTIFY pgrst, 'reload schema';
COMMIT;

-- 核對：應回 0 列（欄位已移除）。備份表保留，確認一切正常後可自行 DROP TABLE ga_m7m8_function_backups
SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_facilities' AND column_name LIKE 'onboarding_%';
