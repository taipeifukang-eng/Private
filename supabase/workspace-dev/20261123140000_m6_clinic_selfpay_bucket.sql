-- M6 第 3 批 3a W30/W31（2026-11-23）：診所自費藥截圖儲存桶 clinic-selfpay-screenshots。
-- 四張 clinic_selfpay_* 資料表在 DEV 已存在（本檔不動）；DEV 缺這個私有儲存桶，截圖上傳會失敗，所以補建。
-- 設定與舊版 supabase/migration_clinic_selfpay_margin.sql 相同（私有、10MB、png/jpeg/webp）。可重複執行。還原見 .rollback.sql。
DO $$
BEGIN
  IF to_regclass('public.clinic_selfpay_claim_batches') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite: clinic_selfpay_claim_batches 資料表不存在';
  END IF;
END $$;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('clinic-selfpay-screenshots', 'clinic-selfpay-screenshots', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = 10485760,
      allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];
-- 桶若已存在但設定不同（例如 public=true、沒有 MIME 或大小限制），上面會明確改回私有並套用限制；簽名網址與格式限制的假設才成立。

DO $$
DECLARE b record;
BEGIN
  SELECT public, allowed_mime_types, file_size_limit INTO b FROM storage.buckets WHERE id = 'clinic-selfpay-screenshots';
  IF b.public IS TRUE OR b.allowed_mime_types IS NULL OR NOT (b.allowed_mime_types <@ ARRAY['image/jpeg', 'image/png', 'image/webp']) OR b.file_size_limit IS NULL THEN
    RAISE EXCEPTION 'clinic-selfpay-screenshots 儲存桶設定未回到私有與圖片限制';
  END IF;
END $$;
