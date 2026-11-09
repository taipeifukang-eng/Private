-- 回復「巡店定位例外」：還原 20261105180000 的 trigger 函式內容，移除例外 trigger／函式／權限／欄位。可重複執行。
-- 注意：會移除 inspection_masters.gps_exempt 欄位，已用例外建立的巡店會失去「定位例外」標記
--       （其 gps_* 內容保留；UPDATE 不檢查定位，所以不影響既有資料）。
-- 注意：同時刪除 inspection.gps_exempt 權限與所有角色對它的授權。

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
