ALTER TABLE public.store_transfer_requests
  ADD COLUMN IF NOT EXISTS corrected_at timestamptz,
  ADD COLUMN IF NOT EXISTS corrected_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS correction_reason text;

COMMENT ON COLUMN public.store_transfer_requests.corrected_at IS '已確認調店生效日期最後更正時間';
COMMENT ON COLUMN public.store_transfer_requests.corrected_by IS '已確認調店生效日期最後更正者';
COMMENT ON COLUMN public.store_transfer_requests.correction_reason IS '已確認調店生效日期最後更正原因';

NOTIFY pgrst, 'reload schema';
