-- =====================================================
-- 藥師常年會費申請記錄
-- =====================================================

-- Storage bucket for payment proof photos
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'pharmacist-fee-proofs',
  'pharmacist-fee-proofs',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: service_role 才可上傳 / 刪除
DROP POLICY IF EXISTS "service_role_fee_proofs_all" ON storage.objects;
CREATE POLICY "service_role_fee_proofs_all"
  ON storage.objects FOR ALL
  TO service_role
  USING (bucket_id = 'pharmacist-fee-proofs')
  WITH CHECK (bucket_id = 'pharmacist-fee-proofs');
