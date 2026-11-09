-- ============================================================================
-- 【巡店定位例外】正式區復原用 SQL（只有在要「取消這個功能」時才執行）
-- ============================================================================
--
-- 這份 SQL 在做什麼（白話說明）
--   把 docs/inspection-gps-exemption-prod.sql 加上的東西全部拿掉，規則回到 11/05 的版本：
--     - 定位誤差超過 1000 公尺一律不能新增巡店，沒有任何例外。
--     - 移除「巡店定位例外」權限，以及所有角色對它的勾選。
--     - 移除巡店主表的 gps_exempt 欄位。
--
-- 注意
--   - 已經用例外建立的巡店紀錄「不會被刪除」，內容都保留，只是「定位例外」標籤會消失（因為欄位被移除）。
--   - 復原之前，請先把新版程式（有「使用定位例外送出」按鈕、巡店清單會讀 gps_exempt 的那版）退回，
--     否則巡店清單會因為找不到 gps_exempt 欄位而出錯。
--   - 可重複執行；包在 BEGIN ... COMMIT 裡，中途出錯會整份還原。
--   - 最後一段會顯示一列驗證結果，每個欄位都應該是 true。
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_inspection_gps_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := now();
BEGIN
  IF NEW.gps_latitude IS NULL
     OR NEW.gps_longitude IS NULL
     OR NEW.gps_accuracy IS NULL
     OR NEW.gps_timestamp IS NULL THEN
    RAISE EXCEPTION '【巡店定位】新增巡店必須先完成定位（缺少定位座標、誤差或時間），請重新定位後再送出'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.gps_latitude < -90 OR NEW.gps_latitude > 90
     OR NEW.gps_longitude < -180 OR NEW.gps_longitude > 180 THEN
    RAISE EXCEPTION '【巡店定位】定位座標超出範圍，請重新定位後再送出'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.gps_accuracy = 'NaN'::numeric OR NEW.gps_accuracy < 0 THEN
    RAISE EXCEPTION '【巡店定位】定位誤差資料不正確，請重新定位後再送出'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.gps_accuracy > 1000 THEN
    RAISE EXCEPTION '【巡店定位】定位誤差過大（±% 公尺），上限為 1000 公尺，請重新定位後再送出', ceil(NEW.gps_accuracy)
      USING ERRCODE = '23514';
  END IF;

  IF NEW.gps_timestamp < v_now - interval '2 hours' THEN
    RAISE EXCEPTION '【巡店定位】定位時間距現在超過 2 小時，請重新定位後再送出'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.gps_timestamp > v_now + interval '5 minutes' THEN
    RAISE EXCEPTION '【巡店定位】定位時間晚於伺服器時間，請確認裝置日期時間後重新定位'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inspection_masters_require_gps ON public.inspection_masters;
CREATE TRIGGER trg_inspection_masters_require_gps
  BEFORE INSERT ON public.inspection_masters
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_inspection_gps_on_insert();

DROP TRIGGER IF EXISTS trg_inspection_masters_gps_exempt_guard ON public.inspection_masters;
DROP FUNCTION IF EXISTS public.enforce_inspection_gps_exempt_on_update();
DROP FUNCTION IF EXISTS public.can_use_inspection_gps_exempt();

DELETE FROM public.role_permissions
WHERE permission_id IN (SELECT id FROM public.permissions WHERE code = 'inspection.gps_exempt');
DELETE FROM public.permissions WHERE code = 'inspection.gps_exempt';

ALTER TABLE public.inspection_masters DROP COLUMN IF EXISTS gps_exempt;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ----------------------------------------------------------------------------
-- 驗證結果：下面這一列的每個欄位都應該是 true
-- ----------------------------------------------------------------------------
SELECT
  NOT EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'inspection_masters'
                AND column_name = 'gps_exempt') AS "欄位 gps_exempt 已移除",
  NOT EXISTS (SELECT 1 FROM public.permissions WHERE code = 'inspection.gps_exempt') AS "權限 巡店定位例外 已移除",
  NOT EXISTS (SELECT 1 FROM pg_trigger
              WHERE tgrelid = 'public.inspection_masters'::regclass
                AND tgname = 'trg_inspection_masters_gps_exempt_guard') AS "防竄改規則 已移除",
  EXISTS (SELECT 1 FROM pg_trigger
          WHERE tgrelid = 'public.inspection_masters'::regclass AND tgname = 'trg_inspection_masters_require_gps'
            AND NOT tgisinternal) AS "11/05 定位檢查規則 仍啟用",
  to_regprocedure('public.can_use_inspection_gps_exempt()') IS NULL AS "權限判斷函式 已移除";
