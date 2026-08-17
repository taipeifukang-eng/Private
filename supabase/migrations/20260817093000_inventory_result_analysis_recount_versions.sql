-- Inventory result analysis recount versions.
-- Adds report-version metadata so dispute recount imports can be kept beside
-- the initial inventory result without overwriting first-round reasons.

ALTER TABLE public.inventory_result_batches
  ADD COLUMN IF NOT EXISTS parent_batch_id uuid REFERENCES public.inventory_result_batches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS report_round integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS report_kind text NOT NULL DEFAULT 'INITIAL',
  ADD COLUMN IF NOT EXISTS report_label text;

ALTER TABLE public.inventory_result_batches
  DROP CONSTRAINT IF EXISTS inventory_result_batches_report_round_check,
  ADD CONSTRAINT inventory_result_batches_report_round_check CHECK (report_round >= 1);

ALTER TABLE public.inventory_result_batches
  DROP CONSTRAINT IF EXISTS inventory_result_batches_report_kind_check,
  ADD CONSTRAINT inventory_result_batches_report_kind_check CHECK (report_kind IN ('INITIAL', 'RECOUNT'));

CREATE INDEX IF NOT EXISTS idx_inventory_result_batches_parent
  ON public.inventory_result_batches(parent_batch_id);

CREATE INDEX IF NOT EXISTS idx_inventory_result_batches_report_family
  ON public.inventory_result_batches(COALESCE(parent_batch_id, id), report_round);

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_result_batches_report_family_round
  ON public.inventory_result_batches(COALESCE(parent_batch_id, id), report_round);

COMMENT ON COLUMN public.inventory_result_batches.parent_batch_id IS '再次盤點報表所屬的第一次盤點批次；第一次盤點為 NULL。';
COMMENT ON COLUMN public.inventory_result_batches.report_round IS '同一盤點報表版本序號；1 為第一次盤點，2 起為爭議再次盤點。';
COMMENT ON COLUMN public.inventory_result_batches.report_kind IS 'INITIAL=第一次盤點，RECOUNT=爭議再次盤點。';
COMMENT ON COLUMN public.inventory_result_batches.report_label IS '前端顯示用報表版本名稱。';
