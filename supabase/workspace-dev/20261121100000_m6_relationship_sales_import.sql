-- M6 第 1 批 P07 A7（2026-11-21 M6 規格問卷）：關係會員銷售明細「內容完全相同的明細自動略過」（DEV）。
-- 舊 /api/relationship-sales/import 每次匯入都新建批次並直接 insert、資料表沒有唯一索引，所以舊版不去重；舊 route 不動。
-- 這個函式只給 workspace 匯入 handler 使用（service_role 呼叫）：
--   * 去重鍵：門市代號、銷售時間、會員編號、品號、數量、金額（完全相同才算重複；數量固定 2 位小數、金額 2 位小數，與欄位型別相同）。
--   * 只略過「資料庫已存在」的相同明細；同一檔內本身相同的列不會因此被略過。
--     資料庫已有 c 筆、檔案有 k 筆相同明細時，略過前 min(k, c) 筆，其餘照常新增。
--   * 全部重複時不建立匯入批次（imported = 0）。
--   * 整個動作在同一個交易，先取 advisory lock 序列化，所以兩個人同時匯入同一份檔案，第二個會看到第一個已寫入的資料而全數略過。
--     （同檔內允許相同列，無法用唯一索引保證，所以用交易加鎖。）
-- 還原：20261121100000_m6_relationship_sales_import.rollback.sql。可重複執行。
DO $$
BEGIN
  IF to_regclass('public.relationship_sales_details') IS NULL OR to_regclass('public.relationship_sales_imports') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite: relationship_sales_* 資料表不存在';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.workspace_import_relationship_sales(p_file_name text, p_user uuid, p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $f$
DECLARE
  v_total integer;
  v_fresh integer;
  v_import uuid;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_rows 必須是 JSON 陣列';
  END IF;
  v_total := jsonb_array_length(p_rows);
  IF v_total = 0 THEN
    RETURN jsonb_build_object('imported', 0, 'skipped', 0, 'import_id', NULL);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('workspace_import_relationship_sales', 0));

  CREATE TEMP TABLE m6_sales_fresh ON COMMIT DROP AS
  WITH incoming AS (
    SELECT e.ord::integer AS ord,
           NULLIF(e.elem->>'store_code', '')::varchar AS store_code,
           (e.elem->>'sale_datetime')::timestamptz AS sale_datetime,
           (e.elem->>'member_number')::varchar AS member_number,
           (e.elem->>'product_code')::varchar AS product_code,
           (e.elem->>'product_name')::varchar AS product_name,
           (e.elem->>'quantity')::numeric(12,2) AS quantity,
           (e.elem->>'amount')::numeric(14,2) AS amount
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS e(elem, ord)
  ), ranked AS (
    SELECT i.*, row_number() OVER (
      PARTITION BY i.store_code, i.sale_datetime, i.member_number, i.product_code, i.quantity, i.amount
      ORDER BY i.ord
    ) AS rn
    FROM incoming i
  ), existing AS (
    SELECT d.store_code, d.sale_datetime, d.member_number, d.product_code, d.quantity, d.amount, count(*) AS c
    FROM public.relationship_sales_details d
    WHERE d.member_number IN (SELECT DISTINCT member_number FROM incoming)
    GROUP BY d.store_code, d.sale_datetime, d.member_number, d.product_code, d.quantity, d.amount
  )
  SELECT r.ord, r.store_code, r.sale_datetime, r.member_number, r.product_code, r.product_name, r.quantity, r.amount
  FROM ranked r
  LEFT JOIN existing x
    ON r.store_code IS NOT DISTINCT FROM x.store_code
   AND r.sale_datetime IS NOT DISTINCT FROM x.sale_datetime
   AND r.member_number = x.member_number
   AND r.product_code = x.product_code
   AND r.quantity = x.quantity
   AND r.amount = x.amount
  WHERE r.rn > COALESCE(x.c, 0);

  SELECT count(*) INTO v_fresh FROM m6_sales_fresh;
  IF v_fresh > 0 THEN
    INSERT INTO public.relationship_sales_imports (file_name, row_count, imported_by)
    VALUES (p_file_name, v_fresh, p_user)
    RETURNING id INTO v_import;
    INSERT INTO public.relationship_sales_details
      (import_id, store_code, sale_datetime, member_number, product_code, product_name, quantity, amount, imported_by)
    SELECT v_import, f.store_code, f.sale_datetime, f.member_number, f.product_code, f.product_name, f.quantity, f.amount, p_user
    FROM m6_sales_fresh f
    ORDER BY f.ord;
  END IF;
  RETURN jsonb_build_object('imported', v_fresh, 'skipped', v_total - v_fresh, 'import_id', v_import);
END;
$f$;

REVOKE ALL ON FUNCTION public.workspace_import_relationship_sales(text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_import_relationship_sales(text, uuid, jsonb) TO service_role;
