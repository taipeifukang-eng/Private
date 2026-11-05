-- 巡店強制定位：新增巡店（INSERT）時，資料庫端檢查定位資料。
-- 規則（與 lib/inspection/gps-policy.ts 一致）：
--   1. gps_latitude / gps_longitude / gps_accuracy / gps_timestamp 四欄皆必填
--   2. 座標必須在範圍內（緯度 -90~90、經度 -180~180）
--   3. gps_accuracy 必須 >= 0 且 <= 1000（公尺）
--   4. gps_timestamp 與伺服器時間相差不得超過 2 小時，且不得晚於伺服器時間 5 分鐘以上
-- 只檢查 INSERT，不檢查 UPDATE，以免影響編輯與既有資料。
-- 冪等：可重複執行。rollback 見 supabase/rollback_inspection_require_gps.sql。

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

  IF NEW.gps_accuracy < 0 THEN
    RAISE EXCEPTION '【巡店定位】定位誤差資料不正確，請重新定位後再送出'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.gps_accuracy > 1000 THEN
    RAISE EXCEPTION '【巡店定位】定位誤差過大（±% 公尺），上限為 1000 公尺，請重新定位後再送出', round(NEW.gps_accuracy)
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
