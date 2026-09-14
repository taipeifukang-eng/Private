-- Employee purchase management: POS monthly import and position-based analysis.

DO $$
BEGIN
  IF to_regclass('public.permissions') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table: public.permissions';
  END IF;

  IF to_regclass('public.roles') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table: public.roles';
  END IF;

  IF to_regclass('public.role_permissions') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table: public.role_permissions';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.employee_purchase_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year_month varchar(7) NOT NULL,
  file_name text NOT NULL,
  imported_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  row_count integer NOT NULL DEFAULT 0,
  matched_count integer NOT NULL DEFAULT 0,
  unmatched_count integer NOT NULL DEFAULT 0,
  total_amount numeric(14,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'failed')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.employee_purchase_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid REFERENCES public.employee_purchase_import_batches(id) ON DELETE SET NULL,
  year_month varchar(7) NOT NULL,
  store_id uuid REFERENCES public.stores(id) ON DELETE SET NULL,
  store_code text,
  sale_date date,
  sale_sequence text,
  invoice_number text,
  invoice_status text,
  member_code text,
  member_name text,
  member_mobile text,
  member_phone text,
  product_code text,
  product_name text,
  unit text,
  quantity numeric(14,3) NOT NULL DEFAULT 0,
  gross_profit numeric(14,2) NOT NULL DEFAULT 0,
  unit_price numeric(14,2) NOT NULL DEFAULT 0,
  unit_cost numeric(14,2) NOT NULL DEFAULT 0,
  cash_discount numeric(14,2) NOT NULL DEFAULT 0,
  total_amount numeric(14,2) NOT NULL DEFAULT 0,
  document_note text,
  shift_name text,
  machine text,
  cashier text,
  total_cost numeric(14,2) NOT NULL DEFAULT 0,
  price_discount_amount numeric(14,2) NOT NULL DEFAULT 0,
  employee_code text,
  employee_name text,
  employee_position text,
  matched_staff_status_id uuid REFERENCES public.monthly_staff_status(id) ON DELETE SET NULL,
  match_status text NOT NULL DEFAULT 'unmatched' CHECK (match_status IN ('employee_code', 'employee_name', 'ambiguous', 'unmatched')),
  raw_row jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_employee_purchase_batches_year_month
  ON public.employee_purchase_import_batches(year_month, imported_at DESC);

CREATE INDEX IF NOT EXISTS idx_employee_purchase_sales_year_month
  ON public.employee_purchase_sales(year_month);

CREATE INDEX IF NOT EXISTS idx_employee_purchase_sales_position
  ON public.employee_purchase_sales(year_month, employee_position);

CREATE INDEX IF NOT EXISTS idx_employee_purchase_sales_employee
  ON public.employee_purchase_sales(year_month, employee_code, employee_name);

CREATE INDEX IF NOT EXISTS idx_employee_purchase_sales_store
  ON public.employee_purchase_sales(year_month, store_id);

ALTER TABLE public.employee_purchase_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_purchase_sales ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS employee_purchase_batches_select ON public.employee_purchase_import_batches;
CREATE POLICY employee_purchase_batches_select
  ON public.employee_purchase_import_batches
  FOR SELECT TO authenticated
  USING (
    public.has_permission(auth.uid(), 'employee_purchase.view')
    OR public.has_permission(auth.uid(), 'employee_purchase.import')
  );

DROP POLICY IF EXISTS employee_purchase_sales_select ON public.employee_purchase_sales;
CREATE POLICY employee_purchase_sales_select
  ON public.employee_purchase_sales
  FOR SELECT TO authenticated
  USING (
    public.has_permission(auth.uid(), 'employee_purchase.view')
    OR public.has_permission(auth.uid(), 'employee_purchase.import')
  );

INSERT INTO public.permissions (module, feature, code, action, description, is_active)
VALUES
  ('organization', 'employee_purchase', 'employee_purchase.view', 'view', '查看員工購物管理', true),
  ('organization', 'employee_purchase', 'employee_purchase.import', 'import', '匯入員工購物 POS 銷售資料', true)
ON CONFLICT (code) DO UPDATE
SET
  module = EXCLUDED.module,
  feature = EXCLUDED.feature,
  action = EXCLUDED.action,
  description = EXCLUDED.description,
  is_active = true;

INSERT INTO public.role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM public.roles r
JOIN public.permissions p ON p.code IN (
  'employee_purchase.view',
  'employee_purchase.import'
)
WHERE r.code IN (
  'admin',
  'system_admin',
  'admin_role',
  'full_admin',
  'full_admin_role',
  'dev_full_admin',
  'owner',
  'owner_role'
)
AND r.is_active = true
ON CONFLICT (role_id, permission_id) DO UPDATE
SET is_allowed = true;

GRANT SELECT ON public.employee_purchase_import_batches TO authenticated;
GRANT SELECT ON public.employee_purchase_sales TO authenticated;

NOTIFY pgrst, 'reload schema';
