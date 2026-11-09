-- 巡店定位例外：有「巡店定位例外」權限者（與系統管理員）可在定位失敗或誤差超標時，仍然新增巡店。
-- 規格：docs/inspection-gps-exemption-spec.md
-- 前置：20261105180000_inspection_require_gps.sql（enforce_inspection_gps_on_insert 與 trg_inspection_masters_require_gps）
--
-- 1. inspection_masters.gps_exempt boolean NOT NULL DEFAULT false（既有資料一律 false，舊程式不帶此欄位也能新增）。
-- 2. 權限 inspection.gps_exempt（顯示名稱「巡店定位例外」）。只建立權限，不自動授權給任何角色，由權限管理勾選。
-- 3. public.can_use_inspection_gps_exempt()：目前登入者（auth.uid()）是否可使用例外。
--      = has_permission(auth.uid(), 'inspection.gps_exempt') 或 profiles.role = 'admin'。
--    正式區 has_permission 不檢查 roles.is_active、DB 端沒有 admin bypass，所以這裡自己判斷 profiles.role = 'admin'
--    （與應用層 lib/permissions/check.ts 的 admin fallback 一致）。SECURITY DEFINER，不受 profiles RLS 影響。
-- 4. BEFORE INSERT trigger（沿用同名 trg_inspection_masters_require_gps，只換函式內容）：
--      gps_exempt = false：規則與 20261105180000 完全相同。
--      gps_exempt = true ：無權限 → 擋下；有權限 → 跳過「必填、誤差上限、時間窗」檢查，
--                          但有提供座標時仍檢查座標範圍（緯度 -90~90、經度 -180~180，且緯經度需成對）；
--                          誤差若有提供，仍拒絕 NaN 與負數（資料毀損防護，不是定位門檻）。
--      沒有 auth.uid()（service_role、SQL Editor、後台匯入）：既有定位規則照舊套用；
--      gps_exempt = true 時視為受信任的後端寫入，不做權限判斷（沒有使用者身分可判斷），但仍套用上述例外規則。
-- 5. BEFORE UPDATE trigger trg_inspection_masters_gps_exempt_guard：gps_exempt 值改變（false↔true）需要同樣權限，
--    避免事後竄改；沒有 auth.uid() 的情況同上不檢查。一般編輯（不動 gps_exempt）不會觸發。
-- 冪等：可重複執行。rollback 見 supabase/rollback_inspection_gps_exempt.sql。

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.inspection_masters') IS NULL
     OR to_regclass('public.permissions') IS NULL
     OR to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite tables for inspection gps exempt migration';
  END IF;
  IF to_regprocedure('public.enforce_inspection_gps_on_insert()') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite: apply 20261105180000_inspection_require_gps.sql first';
  END IF;
  IF to_regprocedure('public.has_permission(uuid,character varying)') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite function: public.has_permission(uuid, varchar)';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------
-- 1. 欄位
-- ---------------------------------------------------------------------
ALTER TABLE public.inspection_masters
  ADD COLUMN IF NOT EXISTS gps_exempt boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.inspection_masters.gps_exempt IS
  '是否使用「巡店定位例外」新增（true 時 gps_* 可為空或誤差超過 1000 公尺）';

-- ---------------------------------------------------------------------
-- 2. 權限定義（不授權給任何角色）
-- ---------------------------------------------------------------------
INSERT INTO public.permissions (module, feature, code, action, description, is_active)
VALUES (
  'inspection', 'inspection_gps', 'inspection.gps_exempt', 'gps_exempt',
  '巡店定位例外 - 定位失敗或誤差超過 1000 公尺時，仍可新增巡店（系統管理員一律可用）', true
)
ON CONFLICT (code) DO UPDATE SET
  description = EXCLUDED.description,
  is_active = true;

-- ---------------------------------------------------------------------
-- 3. 權限判斷函式
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_use_inspection_gps_exempt()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid AND role = 'admin') THEN
    RETURN true;
  END IF;

  RETURN COALESCE(public.has_permission(v_uid, 'inspection.gps_exempt'), false);
END;
$$;

REVOKE ALL ON FUNCTION public.can_use_inspection_gps_exempt() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_use_inspection_gps_exempt() TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. BEFORE INSERT：定位檢查（gps_exempt = false 時與 20261105180000 相同）
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_inspection_gps_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := now();
BEGIN
  IF COALESCE(NEW.gps_exempt, false) THEN
    -- 有使用者身分才判斷權限；沒有 auth.uid()（service_role / SQL Editor / 匯入）視為受信任寫入。
    IF auth.uid() IS NOT NULL AND NOT public.can_use_inspection_gps_exempt() THEN
      RAISE EXCEPTION '【巡店定位】你沒有「巡店定位例外」權限'
        USING ERRCODE = '42501';
    END IF;

    -- 例外：不要求定位，但有提供的資料仍要合理。
    IF NEW.gps_latitude IS NOT NULL OR NEW.gps_longitude IS NOT NULL THEN
      IF NEW.gps_latitude IS NULL OR NEW.gps_longitude IS NULL
         OR NEW.gps_latitude < -90 OR NEW.gps_latitude > 90
         OR NEW.gps_longitude < -180 OR NEW.gps_longitude > 180 THEN
        RAISE EXCEPTION '【巡店定位】定位座標超出範圍，請重新定位後再送出'
          USING ERRCODE = '23514';
      END IF;
    END IF;

    IF NEW.gps_accuracy IS NOT NULL
       AND (NEW.gps_accuracy = 'NaN'::numeric OR NEW.gps_accuracy < 0) THEN
      RAISE EXCEPTION '【巡店定位】定位誤差資料不正確，請重新定位後再送出'
        USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
  END IF;

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

-- ---------------------------------------------------------------------
-- 5. BEFORE UPDATE：gps_exempt 值改變需要權限
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_inspection_gps_exempt_on_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.can_use_inspection_gps_exempt() THEN
    RAISE EXCEPTION '【巡店定位】你沒有「巡店定位例外」權限'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inspection_masters_gps_exempt_guard ON public.inspection_masters;
CREATE TRIGGER trg_inspection_masters_gps_exempt_guard
  BEFORE UPDATE ON public.inspection_masters
  FOR EACH ROW
  WHEN (OLD.gps_exempt IS DISTINCT FROM NEW.gps_exempt)
  EXECUTE FUNCTION public.enforce_inspection_gps_exempt_on_update();

NOTIFY pgrst, 'reload schema';

COMMIT;
