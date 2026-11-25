-- M9 正式區草稿 09：舊版「庫存／附件」6 支 migration 中，00d 發現正式區沒套用、且沒有任何後續步驟會補的內容（2026-11-25 正式區 00d 唯讀檢查）。尚未套用，需人確認後才轉正式 migration。
-- 只改函式內容、EXECUTE／序列授權；不改任何資料表、不寫資料、不建也不授權任何權限碼、不碰 RLS 政策。可重複執行（取最終狀態）。
-- 補的 4 組（對應舊版 migration，內容與 supabase/migrations 逐字相同，DEV 已是這個狀態）：
--   1. 20260722055852：ga_soft_delete_inventory_location（刪除庫存位置時，連帶刪除的下層明細，原因與上層相同；正式區仍是「父庫存位置刪除衍生：」前綴的舊版）。
--   2. 20260722094917：ga_post_inventory_transaction 的 ON CONFLICT (location_id, part_id) 改成 ON CONFLICT ON CONSTRAINT ga_inventory_balances_location_part_unique。
--      正式區的函式回傳表有 location_id、part_id 欄，舊寫法會報「column reference is ambiguous」，庫存過帳（總務第 3 批 ga_ws_inv_post 會呼叫它）第一次建立餘額列就會失敗。
--      做法與舊版相同：讀出現行定義、只換這一句再重建；已是新寫法就略過；兩種寫法都找不到就中止。
--   3. 20260722091526、20260722092849：收回庫存交易序號序列 ga_inventory_transaction_no_seq 與取號函式 ga_next_inventory_transaction_no() 對 anon、authenticated 的授權；
--      ga_post_inventory_transaction 只留 authenticated（收回 PUBLIC、anon）。正式區現況是 anon、authenticated 都有（任何登入者或匿名者可直接 nextval 取號）。
--   4. 20260826042500：ga_resource_attachment_can_manage 換成「舊版最終版」（設備店長貼標分支、需求單建立人與門市店長可管理自己的附件）。
--      這一步有硬性理由：總務第 2 批「設施上線貼標」（m7m8-sql/22-b2-onboarding.sql）開頭有 md5 檢查（不符就自己中止），要求此函式內容 md5 = 41a29efc4e62b01a7ce8f7d0fce9eead（即本版）；
--      正式區現在是 20260826004500 版（md5 不同），不先做 09，22 會自己中止。本檔建立的函式 md5 就是 41a29efc4e62b01a7ce8f7d0fce9eead（已在 DEV 驗證）。
--      之後 22（加設施分支）、水電帳單與附件類型（補 UTILITY_BILL、PURCHASE_INVOICE、PURCHASE_RECEIPT 分支）會在這版上疊加；所以本檔重跑時，只要函式已含設備貼標分支就略過、不會把後面步驟的內容蓋掉。
-- 明確不補（維修回報 20260727021000 的 p1e_maintenance_requests_read 政策）：正式區 maintenance_* 七張表用的是更早的「全開」政策（maintenance_requests_read／_write 等，登入者皆可讀寫，
--   名稱沒有 p1e_ 前綴），舊版 20260724011554 與 20260727021000 的 p1e_ 政策組從沒套用。改成 p1e_ 政策組會讓沒有總務權限碼的登入者立刻讀不到、寫不了維修資料（舊版畫面直接用登入者身分查表），
--   必須和角色授權一起決定，不屬於「補漏套用」。新版函式是 SECURITY DEFINER，不受這些政策影響。待老闆決定（見 README 09 的說明）。
-- 前置：庫存、設備、設施、需求單、維修回報等既有表與 current_user_has_permission(varchar)、ga_normalize_optional_text；ga_inventory_balances 的唯一約束 ga_inventory_balances_location_part_unique；ga_equipment.onboarding_status。缺就中止。
-- 備份：不需要（只改函式與授權）。要還原的「正式區現況」原文放在 09_legacy_inventory_maintenance_attachment.rollback.sql。
-- 還原：.rollback.sql；驗證：.verify.sql（只有 SELECT）。檔案自己 BEGIN ... COMMIT，任何一句出錯整份不生效。
-- 函式本文在貼上時若被換行字元（CR）污染，會先濾掉再建立，確保 md5 與 22 的檢查一致。
BEGIN;

DO $$
DECLARE
  v_missing text[];
BEGIN
  SELECT array_remove(ARRAY[
    CASE WHEN to_regclass('public.ga_inventory_locations') IS NULL THEN 'table public.ga_inventory_locations' END,
    CASE WHEN to_regclass('public.ga_inventory_location_parts') IS NULL THEN 'table public.ga_inventory_location_parts' END,
    CASE WHEN to_regclass('public.ga_inventory_balances') IS NULL THEN 'table public.ga_inventory_balances' END,
    CASE WHEN to_regclass('public.ga_inventory_transactions') IS NULL THEN 'table public.ga_inventory_transactions' END,
    CASE WHEN to_regclass('public.ga_parts') IS NULL THEN 'table public.ga_parts' END,
    CASE WHEN to_regclass('public.ga_equipment') IS NULL THEN 'table public.ga_equipment' END,
    CASE WHEN to_regclass('public.ga_facilities') IS NULL THEN 'table public.ga_facilities' END,
    CASE WHEN to_regclass('public.ga_service_requests') IS NULL THEN 'table public.ga_service_requests' END,
    CASE WHEN to_regclass('public.ga_service_request_comments') IS NULL THEN 'table public.ga_service_request_comments' END,
    CASE WHEN to_regclass('public.maintenance_requests') IS NULL THEN 'table public.maintenance_requests' END,
    CASE WHEN to_regclass('public.maintenance_updates') IS NULL THEN 'table public.maintenance_updates' END,
    CASE WHEN to_regclass('public.store_managers') IS NULL THEN 'table public.store_managers' END,
    CASE WHEN to_regclass('public.ga_inventory_transaction_no_seq') IS NULL THEN 'sequence public.ga_inventory_transaction_no_seq' END,
    CASE WHEN to_regprocedure('public.current_user_has_permission(character varying)') IS NULL THEN 'function public.current_user_has_permission(varchar)' END,
    CASE WHEN to_regprocedure('public.ga_normalize_optional_text(text)') IS NULL THEN 'function public.ga_normalize_optional_text(text)' END,
    CASE WHEN to_regprocedure('public.ga_next_inventory_transaction_no()') IS NULL THEN 'function public.ga_next_inventory_transaction_no()' END,
    CASE WHEN to_regprocedure('public.ga_post_inventory_transaction(text, uuid, uuid, numeric, text, text, text, text, uuid, text, timestamp with time zone, jsonb)') IS NULL THEN 'function public.ga_post_inventory_transaction(...)' END,
    CASE WHEN NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.ga_inventory_balances'::regclass AND conname = 'ga_inventory_balances_location_part_unique') THEN 'constraint ga_inventory_balances_location_part_unique' END,
    CASE WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_equipment' AND column_name = 'onboarding_status') THEN 'column ga_equipment.onboarding_status' END,
    CASE WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_service_requests' AND column_name = 'created_by') THEN 'column ga_service_requests.created_by' END
  ], NULL) INTO v_missing;
  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION 'Missing prerequisite: %', array_to_string(v_missing, ', ');
  END IF;
END $$;

-- ================================================================ 1. 刪除庫存位置：連帶刪除的下層明細，原因與上層相同（20260722055852）
DO $m09$
BEGIN
  EXECUTE replace($def$
CREATE OR REPLACE FUNCTION public.ga_soft_delete_inventory_location(
  p_location_id UUID,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_reason TEXT := ga_normalize_optional_text(p_reason);
  v_deleted_at TIMESTAMPTZ := NOW();
  v_updated_count INTEGER := 0;
  v_child_count INTEGER := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'status', 401, 'error', '未登入');
  END IF;

  IF NOT current_user_has_permission('general_affairs.inventory_location.manage') THEN
    RETURN jsonb_build_object('ok', false, 'status', 403, 'error', '沒有庫存位置管理權限');
  END IF;

  IF v_reason IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '請輸入刪除原因');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.ga_inventory_locations WHERE id = p_location_id) THEN
    RETURN jsonb_build_object('ok', false, 'status', 404, 'error', '找不到庫存位置');
  END IF;

  IF EXISTS (SELECT 1 FROM public.ga_inventory_locations WHERE id = p_location_id AND deleted_at IS NOT NULL) THEN
    RETURN jsonb_build_object('ok', false, 'status', 409, 'error', '此庫存位置已被刪除');
  END IF;

  -- 後續建立交易表後，若位置已有任何交易紀錄，這裡必須拒絕 soft delete，改以 is_active=false 停用。
  PERFORM set_config('app.ga_soft_delete_inventory_location_part', 'true', true);
  UPDATE public.ga_inventory_location_parts
  SET
    is_active = false,
    deleted_at = v_deleted_at,
    deleted_by = v_user_id,
    deletion_reason = v_reason,
    updated_by = v_user_id
  WHERE location_id = p_location_id
    AND deleted_at IS NULL;
  GET DIAGNOSTICS v_child_count = ROW_COUNT;

  PERFORM set_config('app.ga_soft_delete_inventory_location', 'true', true);
  UPDATE public.ga_inventory_locations
  SET
    is_active = false,
    is_default = false,
    deleted_at = v_deleted_at,
    deleted_by = v_user_id,
    deletion_reason = v_reason,
    updated_by = v_user_id
  WHERE id = p_location_id
    AND deleted_at IS NULL;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  IF v_updated_count = 0 THEN
    RAISE EXCEPTION '庫存位置 soft delete 失敗，交易已中止';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'status', 200,
    'data', jsonb_build_object(
      'id', p_location_id,
      'is_active', false,
      'is_default', false,
      'deleted_at', v_deleted_at,
      'deleted_by', v_user_id,
      'deletion_reason', v_reason,
      'deleted_location_parts', v_child_count
    )
  );
END;
$$;
$def$, chr(13), '');
END
$m09$;

REVOKE ALL ON FUNCTION public.ga_soft_delete_inventory_location(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ga_soft_delete_inventory_location(UUID, TEXT) TO authenticated;

-- ================================================================ 2. 過帳函式：ON CONFLICT 改指定約束名稱（20260722094917）
DO $m09$
DECLARE
  v_oid oid;
  v_def text;
  v_new text;
  v_ambiguous text := 'ON CONFLICT (' || 'location_id, part_id' || ') DO NOTHING;';
  v_constraint text := 'ON CONFLICT ON CONSTRAINT ga_inventory_balances_location_part_unique DO NOTHING;';
BEGIN
  v_oid := to_regprocedure('public.ga_post_inventory_transaction(text, uuid, uuid, numeric, text, text, text, text, uuid, text, timestamp with time zone, jsonb)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite function: public.ga_post_inventory_transaction';
  END IF;
  v_def := pg_get_functiondef(v_oid);
  IF position(v_constraint IN v_def) > 0 THEN
    RAISE NOTICE 'ga_post_inventory_transaction 已是 ON CONFLICT ON CONSTRAINT 寫法，略過';
  ELSIF position(v_ambiguous IN v_def) = 0 THEN
    RAISE EXCEPTION 'ga_post_inventory_transaction 找不到預期的 ON CONFLICT 寫法（兩種都沒有），請人工確認後再處理';
  ELSE
    v_new := replace(v_def, v_ambiguous, v_constraint);
    IF v_new = v_def OR position(v_ambiguous IN v_new) > 0 OR position(v_constraint IN v_new) = 0 THEN
      RAISE EXCEPTION 'ga_post_inventory_transaction 替換 ON CONFLICT 寫法失敗';
    END IF;
    EXECUTE v_new;
  END IF;
END
$m09$;

-- ================================================================ 3. 授權整理（20260722091526、20260722092849；對應 DEV 現況）
REVOKE ALL ON SEQUENCE public.ga_inventory_transaction_no_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.ga_inventory_transaction_no_seq FROM anon;
REVOKE ALL ON SEQUENCE public.ga_inventory_transaction_no_seq FROM authenticated;

REVOKE ALL ON FUNCTION public.ga_next_inventory_transaction_no() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ga_next_inventory_transaction_no() FROM anon;
REVOKE ALL ON FUNCTION public.ga_next_inventory_transaction_no() FROM authenticated;

REVOKE ALL ON FUNCTION public.ga_post_inventory_transaction(TEXT, UUID, UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TIMESTAMPTZ, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ga_post_inventory_transaction(TEXT, UUID, UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TIMESTAMPTZ, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.ga_post_inventory_transaction(TEXT, UUID, UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TIMESTAMPTZ, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ga_post_inventory_transaction(TEXT, UUID, UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TIMESTAMPTZ, JSONB) TO authenticated;

-- ================================================================ 4. 附件管理判斷：換成舊版最終版（20260826042500）
-- 只在還沒有「設備待貼標分支」時才換；已經是這版或更新的版本（總務第 2 批以後）就略過，避免蓋掉後面步驟的內容。
DO $m09$
DECLARE
  v_def text;
BEGIN
  v_def := pg_get_functiondef('public.ga_resource_attachment_can_manage(text,uuid)'::regprocedure);
  IF position('e.onboarding_status IN (''NEEDS_EQUIPMENT_PHOTO''' IN v_def) > 0 THEN
    RAISE NOTICE 'ga_resource_attachment_can_manage 已含設備待貼標分支（本檔或後面的步驟已套用），略過';
  ELSE
    EXECUTE replace($def$
CREATE OR REPLACE FUNCTION public.ga_resource_attachment_can_manage(
  p_resource_type TEXT,
  p_resource_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_resource_type = 'EQUIPMENT' THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.ga_equipment e
      WHERE e.id = p_resource_id
        AND e.deleted_at IS NULL
        AND (
          public.current_user_has_permission('general_affairs.equipment.manage')
          OR (
            e.onboarding_status IN ('NEEDS_EQUIPMENT_PHOTO', 'NEEDS_LABEL_PHOTO')
            AND EXISTS (
              SELECT 1
              FROM public.store_managers sm
              WHERE sm.store_id = e.store_id
                AND sm.user_id = auth.uid()
            )
          )
        )
    );
  END IF;

  IF p_resource_type = 'FACILITY' THEN
    RETURN public.current_user_has_permission('general_affairs.facility.manage')
      AND EXISTS (
        SELECT 1 FROM public.ga_facilities f
        WHERE f.id = p_resource_id
          AND f.deleted_at IS NULL
      );
  END IF;

  IF p_resource_type = 'PART' THEN
    RETURN public.current_user_has_permission('general_affairs.part.manage')
      AND EXISTS (
        SELECT 1 FROM public.ga_parts p
        WHERE p.id = p_resource_id
          AND p.deleted_at IS NULL
      );
  END IF;

  IF p_resource_type = 'MAINTENANCE_REQUEST' THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.maintenance_requests mr
      WHERE mr.id = p_resource_id
        AND (
          public.current_user_has_permission('general_affairs.maintenance_request.update')
          OR public.current_user_has_permission('general_affairs.work_order.update')
          OR public.current_user_has_permission('general_affairs.work_order.manage')
          OR public.current_user_has_permission('cross_dept.maintenance.update')
          OR mr.reported_by = auth.uid()
          OR (
            (
              public.current_user_has_permission('general_affairs.maintenance_request.create')
              OR public.current_user_has_permission('cross_dept.maintenance.submit')
            )
            AND EXISTS (
              SELECT 1
              FROM public.store_managers sm
              WHERE sm.store_id = mr.store_id
                AND sm.user_id = auth.uid()
            )
          )
        )
    );
  END IF;

  IF p_resource_type = 'MAINTENANCE_UPDATE' THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.maintenance_updates mu
      WHERE mu.id = p_resource_id
        AND (
          public.current_user_has_permission('general_affairs.maintenance_request.update')
          OR public.current_user_has_permission('general_affairs.work_order.update')
          OR public.current_user_has_permission('general_affairs.work_order.manage')
          OR public.current_user_has_permission('cross_dept.maintenance.update')
          OR mu.updated_by = auth.uid()
        )
    );
  END IF;

  IF p_resource_type = 'SERVICE_REQUEST' THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.ga_service_requests sr
      WHERE sr.id = p_resource_id
        AND sr.deleted_at IS NULL
        AND (
          public.current_user_has_permission('general_affairs.request.manage')
          OR sr.created_by = auth.uid()
          OR EXISTS (
            SELECT 1
            FROM public.store_managers sm
            WHERE sm.store_id = sr.store_id
              AND sm.user_id = auth.uid()
          )
        )
    );
  END IF;

  IF p_resource_type = 'SERVICE_REQUEST_COMMENT' THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.ga_service_request_comments comment
      JOIN public.ga_service_requests request ON request.id = comment.request_id
      WHERE comment.id = p_resource_id
        AND comment.deleted_at IS NULL
        AND request.deleted_at IS NULL
        AND (
          public.current_user_has_permission('general_affairs.request.comment_all')
          OR public.current_user_has_permission('general_affairs.request.manage')
          OR (
            comment.visibility = 'PUBLIC'
            AND comment.created_by = auth.uid()
          )
        )
    );
  END IF;

  RETURN false;
END;
$$;
$def$, chr(13), '');
  END IF;
END
$m09$;

REVOKE ALL ON FUNCTION public.ga_resource_attachment_can_manage(TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ga_resource_attachment_can_manage(TEXT, UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
