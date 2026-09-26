DO $$
BEGIN
  IF to_regclass('public.ga_service_requests') IS NULL
    OR to_regclass('public.ga_purchase_reviews') IS NULL
    OR to_regclass('public.permissions') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisites for general affairs part fulfillments';
  END IF;
END $$;

INSERT INTO public.permissions (module, feature, code, action, description, is_active)
VALUES
  ('general_affairs', 'part_fulfillment', 'general_affairs.part_fulfillment.view', 'view', '查看料件處理中心', true),
  ('general_affairs', 'part_fulfillment', 'general_affairs.part_fulfillment.manage', 'manage', '建立與處理料件處理單', true)
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description, is_active = true;

CREATE SEQUENCE IF NOT EXISTS public.ga_part_fulfillment_no_seq;
CREATE SEQUENCE IF NOT EXISTS public.ga_purchase_order_no_seq;

CREATE OR REPLACE FUNCTION public.ga_next_part_fulfillment_no() RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  RETURN 'PT-' || to_char(current_date, 'YYYYMMDD') || '-' || lpad(nextval('public.ga_part_fulfillment_no_seq')::text, 4, '0');
END; $$;

CREATE OR REPLACE FUNCTION public.ga_next_purchase_order_no() RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  RETURN 'PO-' || to_char(current_date, 'YYYYMMDD') || '-' || lpad(nextval('public.ga_purchase_order_no_seq')::text, 4, '0');
END; $$;

ALTER TABLE public.ga_purchase_reviews ADD COLUMN IF NOT EXISTS purchase_no text;
UPDATE public.ga_purchase_reviews SET purchase_no = public.ga_next_purchase_order_no()
WHERE decision = 'PURCHASE' AND purchase_no IS NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_ga_purchase_reviews_purchase_no ON public.ga_purchase_reviews(purchase_no) WHERE purchase_no IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.ga_part_fulfillments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fulfillment_no text NOT NULL DEFAULT public.ga_next_part_fulfillment_no() UNIQUE,
  request_id uuid NOT NULL UNIQUE REFERENCES public.ga_service_requests(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'PENDING_DECISION' CHECK (status IN ('PENDING_DECISION','STOCK_ISSUE','TRANSFER','PURCHASING','WAITING_ARRIVAL','WAITING_STORE_CONFIRMATION','EXCEPTION','COMPLETED','CANCELED')),
  requested_quantity numeric(12,4) CHECK (requested_quantity IS NULL OR requested_quantity > 0),
  fulfilled_quantity numeric(12,4) NOT NULL DEFAULT 0 CHECK (fulfilled_quantity >= 0),
  unit text,
  current_step text,
  notes text,
  created_by uuid NOT NULL,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_ga_part_fulfillments_status_updated ON public.ga_part_fulfillments(status, updated_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.ga_part_fulfillment_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fulfillment_id uuid NOT NULL REFERENCES public.ga_part_fulfillments(id) ON DELETE CASCADE,
  document_type text NOT NULL CHECK (document_type IN ('STOCK_ISSUE','TRANSFER','PURCHASE')),
  document_id uuid NOT NULL,
  document_no text NOT NULL,
  quantity numeric(12,4),
  status text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fulfillment_id, document_type, document_id)
);
CREATE INDEX IF NOT EXISTS idx_ga_part_fulfillment_documents_fulfillment ON public.ga_part_fulfillment_documents(fulfillment_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.ga_touch_part_fulfillment_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS trg_ga_part_fulfillments_updated_at ON public.ga_part_fulfillments;
CREATE TRIGGER trg_ga_part_fulfillments_updated_at BEFORE UPDATE ON public.ga_part_fulfillments FOR EACH ROW EXECUTE FUNCTION public.ga_touch_part_fulfillment_updated_at();

ALTER TABLE public.ga_part_fulfillments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ga_part_fulfillment_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ga_part_fulfillments_read ON public.ga_part_fulfillments;
CREATE POLICY ga_part_fulfillments_read ON public.ga_part_fulfillments FOR SELECT TO authenticated USING (
  public.current_user_has_permission('general_affairs.part_fulfillment.view') OR public.current_user_has_permission('general_affairs.part_fulfillment.manage') OR public.current_user_has_permission('general_affairs.request.view_all') OR public.current_user_has_permission('general_affairs.request.manage'));
DROP POLICY IF EXISTS ga_part_fulfillments_manage ON public.ga_part_fulfillments;
CREATE POLICY ga_part_fulfillments_manage ON public.ga_part_fulfillments FOR ALL TO authenticated USING (
  public.current_user_has_permission('general_affairs.part_fulfillment.manage') OR public.current_user_has_permission('general_affairs.request.manage')) WITH CHECK (
  public.current_user_has_permission('general_affairs.part_fulfillment.manage') OR public.current_user_has_permission('general_affairs.request.manage'));
DROP POLICY IF EXISTS ga_part_fulfillment_documents_read ON public.ga_part_fulfillment_documents;
CREATE POLICY ga_part_fulfillment_documents_read ON public.ga_part_fulfillment_documents FOR SELECT TO authenticated USING (
  public.current_user_has_permission('general_affairs.part_fulfillment.view') OR public.current_user_has_permission('general_affairs.part_fulfillment.manage') OR public.current_user_has_permission('general_affairs.request.view_all') OR public.current_user_has_permission('general_affairs.request.manage'));
DROP POLICY IF EXISTS ga_part_fulfillment_documents_manage ON public.ga_part_fulfillment_documents;
CREATE POLICY ga_part_fulfillment_documents_manage ON public.ga_part_fulfillment_documents FOR ALL TO authenticated USING (
  public.current_user_has_permission('general_affairs.part_fulfillment.manage') OR public.current_user_has_permission('general_affairs.request.manage')) WITH CHECK (
  public.current_user_has_permission('general_affairs.part_fulfillment.manage') OR public.current_user_has_permission('general_affairs.request.manage'));

GRANT SELECT, INSERT, UPDATE ON public.ga_part_fulfillments, public.ga_part_fulfillment_documents TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.ga_part_fulfillment_no_seq, public.ga_purchase_order_no_seq TO authenticated;
NOTIFY pgrst, 'reload schema';
