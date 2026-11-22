-- 48-b6-vendor-tax-unique.sql
-- 正式區草稿（尚未執行，僅供使用者審閱）。內容與 DEV 已測過的 supabase/workspace-dev/20261118140000_m7m8_b6_vendor_tax_unique.sql 的 BEGIN 與 COMMIT 之間一致。
-- 使用者決定（2026-11-18）：統編唯一（allowlist m7m8-b6-vendor-tax-id-unique-rpc-only）——上線時先清掉正式區重複統編，再加「正規化統編」的部分唯一索引（含停用廠商，空值不算）。
-- 性質：只建 1 個索引 ga_vendors_tax_id_norm_uidx；不改任何資料。
-- 先決條件：(1) 44 已套用（用到 ga_vd_norm_tax，且 44 的 ga_ws_vendor_save 已會把索引擋下的並行寫入轉成 409 TAX_ID_DUPLICATE）；
--   (2) 41 第 3 區的重複統編名單已整理到「0 組」。開頭有重複檢查，有重複就 RAISE EXCEPTION 中止並列出名單，整份不生效。
-- 套用順序：41 → 42 → 44 → 48 → 47 → 45 → 46 → 43。撤回：48-b6-vendor-tax-unique-rollback.sql（只移除索引）。
-- 檔案自己 BEGIN ... COMMIT。套用前先跑 41，備份後經使用者核可才執行。
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
