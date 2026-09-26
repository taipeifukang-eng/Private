DO $$
DECLARE
  missing_objects text[];
BEGIN
  SELECT array_remove(ARRAY[
    CASE WHEN to_regclass('public.permissions') IS NULL THEN 'table public.permissions' END,
    CASE WHEN to_regclass('public.ga_service_requests') IS NULL THEN 'table public.ga_service_requests' END,
    CASE WHEN to_regclass('public.ga_service_request_events') IS NULL THEN 'table public.ga_service_request_events' END,
    CASE WHEN to_regclass('public.ga_vendors') IS NULL THEN 'table public.ga_vendors' END,
    CASE WHEN to_regclass('public.ga_inventory_locations') IS NULL THEN 'table public.ga_inventory_locations' END,
    CASE WHEN to_regprocedure('public.current_user_has_permission(character varying)') IS NULL THEN 'function public.current_user_has_permission(varchar)' END
  ], NULL)
  INTO missing_objects;

  IF array_length(missing_objects, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'Missing prerequisites for general affairs purchase reviews: %', array_to_string(missing_objects, ', ');
  END IF;
END $$;

INSERT INTO public.permissions (module, feature, code, action, description, is_active)
VALUES
  ('general_affairs', 'purchase_review', 'general_affairs.purchase_review.view', 'view', '查看總務添購 / 採購評估紀錄', true),
  ('general_affairs', 'purchase_review', 'general_affairs.purchase_review.manage', 'manage', '建立與更新總務添購 / 採購評估紀錄', true)
ON CONFLICT (code) DO UPDATE SET
  module = EXCLUDED.module,
  feature = EXCLUDED.feature,
  action = EXCLUDED.action,
  description = EXCLUDED.description,
  is_active = EXCLUDED.is_active;

CREATE TABLE IF NOT EXISTS public.ga_purchase_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.ga_service_requests(id) ON DELETE CASCADE,
  decision text NOT NULL,
  vendor_id uuid REFERENCES public.ga_vendors(id) ON DELETE SET NULL,
  vendor_name text,
  approved_quantity numeric(12, 2),
  approved_unit text,
  estimated_amount numeric(12, 2),
  quoted_amount numeric(12, 2),
  negotiated_amount numeric(12, 2),
  final_amount numeric(12, 2),
  expected_delivery_date date,
  delivery_method text,
  receiving_location_id uuid REFERENCES public.ga_inventory_locations(id) ON DELETE SET NULL,
  substitute_description text,
  decision_note text,
  public_note text,
  created_by uuid NOT NULL,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT ga_purchase_reviews_decision_check
    CHECK (decision IN ('REJECT', 'STOCK_ISSUE', 'TRANSFER', 'PURCHASE', 'SUBSTITUTE')),
  CONSTRAINT ga_purchase_reviews_quantity_check
    CHECK (approved_quantity IS NULL OR approved_quantity > 0),
  CONSTRAINT ga_purchase_reviews_amounts_check
    CHECK (
      (estimated_amount IS NULL OR estimated_amount >= 0)
      AND (quoted_amount IS NULL OR quoted_amount >= 0)
      AND (negotiated_amount IS NULL OR negotiated_amount >= 0)
      AND (final_amount IS NULL OR final_amount >= 0)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ga_purchase_reviews_request_active
ON public.ga_purchase_reviews (request_id)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ga_purchase_reviews_decision
ON public.ga_purchase_reviews (decision, created_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ga_purchase_reviews_vendor
ON public.ga_purchase_reviews (vendor_id, created_at DESC)
WHERE deleted_at IS NULL AND vendor_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.ga_purchase_review_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_review_id uuid NOT NULL REFERENCES public.ga_purchase_reviews(id) ON DELETE CASCADE,
  vendor_id uuid REFERENCES public.ga_vendors(id) ON DELETE SET NULL,
  vendor_name text,
  quote_amount numeric(12, 2),
  negotiated_amount numeric(12, 2),
  lead_time_days integer,
  is_selected boolean NOT NULL DEFAULT false,
  notes text,
  created_by uuid NOT NULL,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT ga_purchase_review_quotes_amounts_check
    CHECK (
      (quote_amount IS NULL OR quote_amount >= 0)
      AND (negotiated_amount IS NULL OR negotiated_amount >= 0)
    ),
  CONSTRAINT ga_purchase_review_quotes_lead_time_check
    CHECK (lead_time_days IS NULL OR lead_time_days >= 0)
);

CREATE INDEX IF NOT EXISTS idx_ga_purchase_review_quotes_review
ON public.ga_purchase_review_quotes (purchase_review_id, created_at DESC)
WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.ga_touch_purchase_review_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ga_purchase_reviews_updated_at ON public.ga_purchase_reviews;
CREATE TRIGGER trg_ga_purchase_reviews_updated_at
BEFORE UPDATE ON public.ga_purchase_reviews
FOR EACH ROW
EXECUTE FUNCTION public.ga_touch_purchase_review_updated_at();

DROP TRIGGER IF EXISTS trg_ga_purchase_review_quotes_updated_at ON public.ga_purchase_review_quotes;
CREATE TRIGGER trg_ga_purchase_review_quotes_updated_at
BEFORE UPDATE ON public.ga_purchase_review_quotes
FOR EACH ROW
EXECUTE FUNCTION public.ga_touch_purchase_review_updated_at();

ALTER TABLE public.ga_purchase_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ga_purchase_review_quotes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ga_purchase_reviews_select ON public.ga_purchase_reviews;
CREATE POLICY ga_purchase_reviews_select ON public.ga_purchase_reviews
FOR SELECT TO authenticated
USING (
  deleted_at IS NULL
  AND (
    public.current_user_has_permission('general_affairs.purchase_review.view')
    OR public.current_user_has_permission('general_affairs.purchase_review.manage')
    OR public.current_user_has_permission('general_affairs.request.view_all')
    OR public.current_user_has_permission('general_affairs.request.manage')
  )
);

DROP POLICY IF EXISTS ga_purchase_reviews_write ON public.ga_purchase_reviews;
CREATE POLICY ga_purchase_reviews_write ON public.ga_purchase_reviews
TO authenticated
USING (
  public.current_user_has_permission('general_affairs.purchase_review.manage')
  OR public.current_user_has_permission('general_affairs.request.manage')
)
WITH CHECK (
  public.current_user_has_permission('general_affairs.purchase_review.manage')
  OR public.current_user_has_permission('general_affairs.request.manage')
);

DROP POLICY IF EXISTS ga_purchase_review_quotes_select ON public.ga_purchase_review_quotes;
CREATE POLICY ga_purchase_review_quotes_select ON public.ga_purchase_review_quotes
FOR SELECT TO authenticated
USING (
  deleted_at IS NULL
  AND (
    public.current_user_has_permission('general_affairs.purchase_review.view')
    OR public.current_user_has_permission('general_affairs.purchase_review.manage')
    OR public.current_user_has_permission('general_affairs.request.view_all')
    OR public.current_user_has_permission('general_affairs.request.manage')
  )
);

DROP POLICY IF EXISTS ga_purchase_review_quotes_write ON public.ga_purchase_review_quotes;
CREATE POLICY ga_purchase_review_quotes_write ON public.ga_purchase_review_quotes
TO authenticated
USING (
  public.current_user_has_permission('general_affairs.purchase_review.manage')
  OR public.current_user_has_permission('general_affairs.request.manage')
)
WITH CHECK (
  public.current_user_has_permission('general_affairs.purchase_review.manage')
  OR public.current_user_has_permission('general_affairs.request.manage')
);

WITH dev_assignments(role_code, permission_code) AS (
  VALUES
    ('dev_ga_category_manage', 'general_affairs.purchase_review.view'),
    ('dev_ga_category_manage', 'general_affairs.purchase_review.manage')
)
INSERT INTO public.role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM dev_assignments a
JOIN public.roles r ON r.code = a.role_code
JOIN public.permissions p ON p.code = a.permission_code
ON CONFLICT (role_id, permission_id)
DO UPDATE SET is_allowed = true;

NOTIFY pgrst, 'reload schema';
