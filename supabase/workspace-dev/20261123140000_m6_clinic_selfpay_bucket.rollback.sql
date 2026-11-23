-- 還原 20261123140000_m6_clinic_selfpay_bucket.sql：只在桶內沒有任何檔案時移除（有檔案要先用 Storage API 清掉，直接刪 storage.objects 不被允許）。
DELETE FROM storage.buckets
WHERE id = 'clinic-selfpay-screenshots'
  AND NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'clinic-selfpay-screenshots');
