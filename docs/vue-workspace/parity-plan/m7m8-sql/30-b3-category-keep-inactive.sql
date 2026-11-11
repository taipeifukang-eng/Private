-- 30-b3-category-keep-inactive.sql
-- 30 只能跑一次：套用後函式 md5 已變，再跑會被 md5 防護中止；要重來請先跑 rollback。
-- 正式區草稿（尚未執行，僅供使用者審閱）。內容與 DEV 已測過的 supabase/workspace-dev/20261111130000_m7m8_b3_category_keep_inactive.sql 相同。
-- C13（2026-11-11 第 3 批問卷）：設備分類或設施分類被停用後，設備與設施只要「不換分類」就允許儲存其他欄位；新增或換分類仍只能選啟用中、未刪除且祖先路徑有效的分類。
-- 性質：會寫入——重新定義 2 個既有的驗證觸發器函式 ga_validate_equipment()、ga_validate_facility()（觸發器本身不動），不改資料表或資料。
--       這是資料庫層規則，新版與舊版畫面都會生效。
-- 保護：先確認正式區現有函式與 DEV 驗證時的原始內容完全相同（md5），不同就中止（避免蓋掉正式區比 DEV 新的修改）；並把原函式備份在 ga_m7m8_function_backups，撤回時依備份還原。
-- 檔案自己 BEGIN ... COMMIT，一次 Run 即可。撤回：30-b3-category-keep-inactive-rollback.sql。
BEGIN;

DO $$
DECLARE
  v_eq text;
  v_fa text;
BEGIN
  SELECT md5(pg_get_functiondef(p.oid)) INTO v_eq FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'ga_validate_equipment' AND pg_get_function_identity_arguments(p.oid) = '';
  SELECT md5(pg_get_functiondef(p.oid)) INTO v_fa FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'ga_validate_facility' AND pg_get_function_identity_arguments(p.oid) = '';
  IF v_eq IS DISTINCT FROM '6e28a9343e7bf878f1359d5b61676113' THEN
    RAISE EXCEPTION 'ga_validate_equipment 與 DEV 驗證時的原始內容不同（目前 md5=%），不要套用，請先回報', v_eq;
  END IF;
  IF v_fa IS DISTINCT FROM '4531585395b254147c7f094235a0a559' THEN
    RAISE EXCEPTION 'ga_validate_facility 與 DEV 驗證時的原始內容不同（目前 md5=%），不要套用，請先回報', v_fa;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.ga_m7m8_function_backups (
  name text PRIMARY KEY,
  definition text NOT NULL,
  backed_up_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ga_m7m8_function_backups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ga_m7m8_function_backups FROM PUBLIC, anon, authenticated;
INSERT INTO public.ga_m7m8_function_backups (name, definition)
SELECT 'ga_validate_equipment()', pg_get_functiondef(p.oid)
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'ga_validate_equipment' AND pg_get_function_identity_arguments(p.oid) = ''
ON CONFLICT (name) DO NOTHING;
INSERT INTO public.ga_m7m8_function_backups (name, definition)
SELECT 'ga_validate_facility()', pg_get_functiondef(p.oid)
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'ga_validate_facility' AND pg_get_function_identity_arguments(p.oid) = ''
ON CONFLICT (name) DO NOTHING;

CREATE OR REPLACE FUNCTION public.ga_validate_equipment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_category ga_equipment_categories%ROWTYPE;
  v_template RECORD;
  v_template_changed BOOLEAN := false;
BEGIN
  NEW.name := btrim(NEW.name);
  NEW.asset_code := ga_normalize_optional_text(NEW.asset_code);
  NEW.barcode := ga_normalize_optional_text(NEW.barcode);
  NEW.brand := ga_normalize_optional_text(NEW.brand);
  NEW.model := ga_normalize_optional_text(NEW.model);
  NEW.serial_number := ga_normalize_optional_text(NEW.serial_number);
  NEW.area := ga_normalize_optional_text(NEW.area);
  NEW.location_detail := ga_normalize_optional_text(NEW.location_detail);
  NEW.purpose := ga_normalize_optional_text(NEW.purpose);
  NEW.notes := ga_normalize_optional_text(NEW.notes);
  NEW.image_path := ga_normalize_optional_text(NEW.image_path);
  NEW.deletion_reason := ga_normalize_optional_text(NEW.deletion_reason);

  IF NEW.name IS NULL OR NEW.name = '' THEN
    RAISE EXCEPTION '請輸入設備名稱';
  END IF;

  IF NOT ga_is_store_active(NEW.store_id) THEN
    RAISE EXCEPTION '設備所屬門市必須存在且啟用';
  END IF;

  -- C13：新增或換分類時，分類必須啟用、未刪除且祖先路徑有效；分類沒換（例如分類被停用後）只要分類資料還在就允許修改其他欄位。
  IF TG_OP = 'INSERT' OR NEW.category_id IS DISTINCT FROM OLD.category_id THEN
    SELECT *
    INTO v_category
    FROM ga_equipment_categories
    WHERE id = NEW.category_id
      AND deleted_at IS NULL
      AND is_active = true;

    IF NOT FOUND OR NOT ga_category_has_active_path('equipment', NEW.category_id) THEN
      RAISE EXCEPTION '設備分類必須啟用、未刪除且祖先路徑有效';
    END IF;
  ELSE
    SELECT *
    INTO v_category
    FROM ga_equipment_categories
    WHERE id = NEW.category_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION '設備分類必須啟用、未刪除且祖先路徑有效';
    END IF;
  END IF;

  IF NEW.template_id IS NOT NULL THEN
    SELECT id, category_id, is_active, deleted_at
    INTO v_template
    FROM ga_equipment_templates
    WHERE id = NEW.template_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION '設備範本不存在';
    END IF;

    IF v_template.category_id IS DISTINCT FROM NEW.category_id THEN
      RAISE EXCEPTION '設備範本分類必須與設備分類一致';
    END IF;

    v_template_changed := TG_OP = 'INSERT' OR NEW.template_id IS DISTINCT FROM OLD.template_id;
    IF v_template_changed AND (v_template.deleted_at IS NOT NULL OR v_template.is_active = false) THEN
      RAISE EXCEPTION '新增或更換設備範本時，範本必須啟用且未刪除';
    END IF;
  END IF;

  IF v_category.requires_brand AND NEW.brand IS NULL THEN
    RAISE EXCEPTION '此設備分類要求填寫品牌';
  END IF;

  IF v_category.requires_model AND NEW.model IS NULL THEN
    RAISE EXCEPTION '此設備分類要求填寫型號';
  END IF;

  IF v_category.requires_serial_number AND NEW.serial_number IS NULL THEN
    RAISE EXCEPTION '此設備分類要求填寫序號';
  END IF;

  IF NEW.purchase_amount IS NOT NULL AND NEW.purchase_amount < 0 THEN
    RAISE EXCEPTION '購買金額不可為負數';
  END IF;

  IF jsonb_typeof(NEW.specs) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION '設備 specs 必須是 JSON object';
  END IF;

  IF NEW.has_warranty = false AND NEW.warranty_end_date IS NOT NULL THEN
    RAISE EXCEPTION '無保固時 warranty_end_date 必須為 NULL';
  END IF;

  IF NEW.image_path IS NOT NULL AND (
    NEW.image_path ~* '^[a-z][a-z0-9+.-]*:'
    OR NEW.image_path ~ E'\\\\'
    OR NEW.image_path ~ '(^|/)\.\.(/|$)'
    OR NEW.image_path ~ '^/'
  ) THEN
    RAISE EXCEPTION '設備 image_path 僅可保存安全的相對 Storage Path';
  END IF;

  IF TG_OP = 'INSERT' AND NEW.asset_code IS NULL AND NEW.purchased_at IS NOT NULL THEN
    NEW.asset_code := ga_next_equipment_asset_code(NEW.category_id, NEW.purchased_at);
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
    NEW.updated_by := auth.uid();
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.created_at := OLD.created_at;
    NEW.created_by := OLD.created_by;
    NEW.updated_at := NOW();
    NEW.updated_by := auth.uid();
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ga_validate_facility()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_is_soft_delete BOOLEAN := COALESCE(current_setting('app.ga_soft_delete_facility', true), '') = 'true';
BEGIN
  NEW.name := btrim(NEW.name);
  NEW.facility_code := upper(ga_normalize_optional_text(NEW.facility_code));
  NEW.area := ga_normalize_optional_text(NEW.area);
  NEW.location_detail := ga_normalize_optional_text(NEW.location_detail);
  NEW.unit := ga_normalize_optional_text(NEW.unit);
  NEW.description := ga_normalize_optional_text(NEW.description);
  NEW.image_path := ga_normalize_optional_text(NEW.image_path);
  NEW.notes := ga_normalize_optional_text(NEW.notes);

  IF NEW.name IS NULL OR NEW.name = '' THEN
    RAISE EXCEPTION '請輸入設施名稱';
  END IF;

  IF NOT ga_is_store_active(NEW.store_id) THEN
    RAISE EXCEPTION '設施所屬門市必須存在且啟用';
  END IF;

  -- C13：新增或換分類時，分類必須啟用、未刪除且祖先路徑有效；分類沒換（例如分類被停用後）允許修改其他欄位。
  IF (TG_OP = 'INSERT' OR NEW.category_id IS DISTINCT FROM OLD.category_id)
     AND NOT ga_is_active_facility_category(NEW.category_id) THEN
    RAISE EXCEPTION '設施分類必須啟用、未刪除且祖先路徑有效';
  END IF;

  IF jsonb_typeof(NEW.specs) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION '設施 specs 必須是 JSON object';
  END IF;

  IF (NEW.quantity IS NULL AND NEW.unit IS NOT NULL)
    OR (NEW.quantity IS NOT NULL AND (NEW.quantity <= 0 OR NEW.unit IS NULL)) THEN
    RAISE EXCEPTION 'quantity 與 unit 必須一起填寫，且 quantity 必須大於 0';
  END IF;

  IF NEW.image_path IS NOT NULL AND (
    NEW.image_path ~* '^[a-z][a-z0-9+.-]*:'
    OR NEW.image_path ~ E'\\\\'
    OR NEW.image_path ~ '(^|/)\.\.(/|$)'
    OR NEW.image_path ~ '^/'
  ) THEN
    RAISE EXCEPTION '設施 image_path 僅可保存安全的相對 Storage Path';
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.created_at := NOW();
    NEW.created_by := auth.uid();
    NEW.updated_at := NOW();
    NEW.updated_by := auth.uid();
    NEW.deleted_at := NULL;
    NEW.deleted_by := NULL;
    NEW.deletion_reason := NULL;
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.created_at := OLD.created_at;
    NEW.created_by := OLD.created_by;
    NEW.updated_at := NOW();
    NEW.updated_by := auth.uid();

    IF v_is_soft_delete THEN
      IF OLD.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION '此設施已被刪除';
      END IF;
      IF NEW.deleted_at IS NULL OR NEW.deleted_by IS NULL OR NEW.deletion_reason IS NULL THEN
        RAISE EXCEPTION 'soft delete 必須設定 deleted_at、deleted_by 與 deletion_reason';
      END IF;
    ELSIF OLD.deleted_at IS NULL THEN
      NEW.deleted_at := NULL;
      NEW.deleted_by := NULL;
      NEW.deletion_reason := NULL;
    ELSE
      NEW.deleted_at := OLD.deleted_at;
      NEW.deleted_by := OLD.deleted_by;
      NEW.deletion_reason := OLD.deletion_reason;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- 核對：備份應有 2 筆；兩個函式內容應含「C13」註解
SELECT name, length(definition) AS backup_length FROM public.ga_m7m8_function_backups WHERE name IN ('ga_validate_equipment()', 'ga_validate_facility()') ORDER BY 1;
SELECT p.proname, position('C13' IN pg_get_functiondef(p.oid)) > 0 AS has_c13
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname IN ('ga_validate_equipment', 'ga_validate_facility') ORDER BY 1;
