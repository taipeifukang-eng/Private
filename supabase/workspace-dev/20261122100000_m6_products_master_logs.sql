-- M6 第 2 批 W27/W28（2026-11-22）：商品主檔操作紀錄（匯入、停用、重新啟用、新增、編輯）。
-- products_master / product_barcodes 在 DEV 已存在（RLS：只有 store.products_master.manage 可讀寫），本檔不動它們，也不碰 acquisition_*。
-- 紀錄只由 workspace API 以 service_role 寫入；管理權限者可讀。可重複執行。還原見 .rollback.sql。
DO $$
BEGIN
  IF to_regclass('public.products_master') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite: products_master 資料表不存在';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.products_master_operation_logs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action       text NOT NULL CHECK (action IN ('import','deactivate','reactivate','create','update')),
  actor_id     uuid,
  product_code text,
  row_count    integer NOT NULL DEFAULT 1,
  detail       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_products_master_op_logs_created ON public.products_master_operation_logs (created_at DESC);

ALTER TABLE public.products_master_operation_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS m6_products_master_logs_read ON public.products_master_operation_logs;
CREATE POLICY m6_products_master_logs_read ON public.products_master_operation_logs
  FOR SELECT TO authenticated
  USING (current_user_has_permission('store.products_master.manage'::character varying));
