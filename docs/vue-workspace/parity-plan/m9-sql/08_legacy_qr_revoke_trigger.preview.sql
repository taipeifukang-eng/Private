-- 套用前預覽 08_legacy_qr_revoke_trigger.sql（唯讀，只有 SELECT）。
-- 只回一個結果表（2 列）。看哪些「已報廢／已退役／已刪除，但 QR 還沒作廢」的設備與設施，用來決定要不要另外回填（回填 SQL 在最後，以註解提供，不會被執行）。
-- 若 ga_equipment／ga_facilities 缺 status、deleted_at、qr_token_revoked_at 任一欄，這份會報欄位不存在，表示 08 的前置不滿足，先停下來。
SELECT 'ga_equipment' AS tbl,
  count(*) AS total_rows,
  count(*) FILTER (WHERE qr_token_revoked_at IS NULL AND (status::text = 'SCRAPPED' OR deleted_at IS NOT NULL)) AS pending_backfill,
  count(*) FILTER (WHERE qr_token_revoked_at IS NULL AND status::text = 'SCRAPPED') AS pending_scrapped,
  count(*) FILTER (WHERE qr_token_revoked_at IS NULL AND deleted_at IS NOT NULL) AS pending_deleted
FROM public.ga_equipment
UNION ALL
SELECT 'ga_facilities',
  count(*),
  count(*) FILTER (WHERE qr_token_revoked_at IS NULL AND (status::text = 'RETIRED' OR deleted_at IS NOT NULL)),
  count(*) FILTER (WHERE qr_token_revoked_at IS NULL AND status::text = 'RETIRED'),
  count(*) FILTER (WHERE qr_token_revoked_at IS NULL AND deleted_at IS NOT NULL)
FROM public.ga_facilities;

-- ===== 選用：回填（舊版 migration 原本會做；本草稿不做，老闆看過上面筆數決定。要做請在 08 套用「之後」另外單獨執行）=====
-- BEGIN;
-- UPDATE public.ga_equipment SET qr_token_revoked_at = NOW()
--  WHERE qr_token_revoked_at IS NULL AND (status::text = 'SCRAPPED' OR deleted_at IS NOT NULL);
-- UPDATE public.ga_facilities SET qr_token_revoked_at = NOW()
--  WHERE qr_token_revoked_at IS NULL AND (status::text = 'RETIRED' OR deleted_at IS NOT NULL);
-- -- 看過更新筆數合理再貼 COMMIT; 單獨執行
