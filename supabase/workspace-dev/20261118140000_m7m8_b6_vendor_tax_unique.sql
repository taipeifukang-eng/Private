-- M7/M8 第 6 批 G21 廠商統編唯一索引（DEV）。
-- 使用者決定（2026-11-18）：統編唯一——正規化統編（全形轉半角、去空白）的部分唯一索引，含停用與暫停廠商，空值不算。
-- 前置：廠商 RPC（20261118100000）已套用（ga_vd_norm_tax 為 IMMUTABLE，直接沿用）。建立前先檢查重複，有重複就中止並列出名單。
-- 並行儲存同統編：ga_ws_vendor_save 先以統編 advisory lock 序列化並檢查，索引是最後防線；索引擋下時轉成 409 TAX_ID_DUPLICATE。
-- 可重複套用。撤回：20261118140000_m7m8_b6_vendor_tax_unique.rollback.sql。
BEGIN;

DO $$
DECLARE
  v_list text;
  v_n integer;
BEGIN
  IF to_regclass('public.ga_vendors') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table: ga_vendors';
  END IF;
  IF to_regprocedure('public.ga_vd_norm_tax(text)') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite function: ga_vd_norm_tax(text)（先套用 44）';
  END IF;
  IF (SELECT p.provolatile FROM pg_proc p WHERE p.oid = to_regprocedure('public.ga_vd_norm_tax(text)')) <> 'i' THEN
    RAISE EXCEPTION 'ga_vd_norm_tax 必須是 IMMUTABLE 才能用在索引';
  END IF;
  -- 重複統編檢查（含停用與暫停的廠商；正規化後相同才算，空值不算）：有重複就中止並列出名單。
  SELECT count(*), string_agg(g.tax || '：' || g.names, '；' ORDER BY g.tax)
    INTO v_n, v_list
    FROM (SELECT public.ga_vd_norm_tax(tax_id) AS tax, string_agg(name || '（' || status || '）', '、' ORDER BY name) AS names
            FROM public.ga_vendors WHERE public.ga_vd_norm_tax(tax_id) <> '' GROUP BY 1 HAVING count(*) > 1) g;
  IF v_n > 0 THEN
    RAISE EXCEPTION '有 % 組重複統編，請先整理（41 第 3 區）後再套用：%', v_n, v_list;
  END IF;
END $$;

-- 正規化統編（全形轉半角、去空白）的部分唯一索引；空值與空字串不納入。
CREATE UNIQUE INDEX IF NOT EXISTS ga_vendors_tax_id_norm_uidx ON public.ga_vendors ((public.ga_vd_norm_tax(tax_id))) WHERE public.ga_vd_norm_tax(tax_id) <> '';

-- 索引運算式由「執行寫入的人」身分執行：44 把 ga_vd_norm_tax 的執行權限收回（REVOKE FROM PUBLIC, anon, authenticated），
-- 若不開給 authenticated，舊頁與任何使用者身分對 ga_vendors 的 insert／update 都會報 permission denied。這是純函式（IMMUTABLE、非 SECURITY DEFINER），開放執行不洩漏資料。
GRANT EXECUTE ON FUNCTION public.ga_vd_norm_tax(text) TO authenticated;

COMMIT;
