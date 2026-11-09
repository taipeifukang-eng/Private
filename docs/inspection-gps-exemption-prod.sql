-- ============================================================================
-- 【巡店定位例外】正式區執行用 SQL
-- ============================================================================
--
-- 這份 SQL 在做什麼（白話說明）
--   2026-11-05 上線的「新增巡店強制定位」規定：定位誤差超過 1000 公尺就不能新增巡店。
--   但只接網路線的桌機，定位誤差常有 25 公里左右，主管在辦公室補登巡店會被擋住。
--   這份 SQL 加上一個「巡店定位例外」功能：
--     1. 被你勾選「巡店定位例外」的角色（以及系統管理員），在定位失敗或誤差太大時，
--        新增巡店畫面會多出「使用定位例外送出」按鈕，可以照樣送出。
--     2. 沒有這個權限的人完全看不到按鈕，規定跟現在一樣（誤差超過 1000 公尺照樣被擋）。
--     3. 用例外送出的巡店，在「巡店清單」與「巡店內容頁」會顯示「定位例外」標籤，
--        清單也可以只看定位例外的紀錄。
--
-- 這份 SQL 會改動什麼
--   - 巡店主表（inspection_masters）新增一個欄位 gps_exempt（預設「否」，舊資料全部是「否」，不會改到任何舊資料）。
--   - 權限清單新增一項「巡店定位例外」（inspection.gps_exempt）。只是新增選項，
--     不會自動給任何人，所以跑完之後還沒有人能用。
--   - 資料庫的定位檢查規則（trigger）更新，認得這個例外。
--   - 不會刪除、不會修改任何既有的巡店紀錄、角色或使用者權限。
--
-- 執行方式（Supabase 正式區，SQL Editor）
--   1. 先確認「程式」已經部署（Vercel 上是這次新版本），或同時部署都可以。
--      順序建議：先執行這份 SQL，再部署新版程式（新程式的巡店清單會讀 gps_exempt 欄位，欄位要先存在）。
--   2. 整份複製貼到 SQL Editor，按 Run。
--   3. 最後一段會顯示一列「驗證結果」，每個欄位都應該如該欄位說明（true 或 0），才算成功。
--   4. 這份 SQL 可以重複執行，不會重複新增或出錯。
--   5. 若中途出現紅字錯誤：整份會自動還原（因為包在 BEGIN ... COMMIT 裡），不會留下半套設定。請把錯誤訊息給我。
--
-- 執行完之後「一定要做」的事
--   到系統的「權限管理」，為你指定的角色勾選「巡店定位例外」（在「督導巡店」類別的「巡店定位」底下），
--   並儲存。沒有勾選之前，除了系統管理員以外，沒有任何人能使用定位例外。
--   （這是進階權限，勾選時系統會再跳出確認視窗，請確認後儲存。）
--
-- 想要復原的話
--   執行 docs/inspection-gps-exemption-prod-rollback.sql。復原後「定位例外」功能消失、規則回到 11/05 版本；
--   已經用例外建立的巡店紀錄會保留，只是不再有「定位例外」標籤。
--
-- 規格：docs/inspection-gps-exemption-spec.md
-- ============================================================================

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

-- ----------------------------------------------------------------------------
-- 驗證結果：下面這一列的每個欄位都應該是 true（既有巡店中「定位例外」筆數應為 0）
-- ----------------------------------------------------------------------------
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'inspection_masters'
            AND column_name = 'gps_exempt' AND is_nullable = 'NO') AS "欄位 gps_exempt 已建立",
  EXISTS (SELECT 1 FROM public.permissions
          WHERE code = 'inspection.gps_exempt' AND is_active = true) AS "權限 巡店定位例外 已建立",
  (SELECT count(*) FROM public.role_permissions rp
     JOIN public.permissions p ON p.id = rp.permission_id
    WHERE p.code = 'inspection.gps_exempt') AS "已授權的角色數（執行後到權限管理勾選前應為 0）",
  EXISTS (SELECT 1 FROM pg_trigger
          WHERE tgrelid = 'public.inspection_masters'::regclass AND tgname = 'trg_inspection_masters_require_gps'
            AND NOT tgisinternal) AS "新增檢查規則 已啟用",
  EXISTS (SELECT 1 FROM pg_trigger
          WHERE tgrelid = 'public.inspection_masters'::regclass AND tgname = 'trg_inspection_masters_gps_exempt_guard'
            AND NOT tgisinternal) AS "防竄改規則 已啟用",
  (SELECT count(*) FROM public.inspection_masters WHERE gps_exempt) AS "既有巡店中定位例外筆數（應為 0）";
