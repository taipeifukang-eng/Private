-- P1-G Production legacy product / relationship member / clinic self-pay / performance compatibility schema.
-- DEV schema-only compatibility. Do not copy Production business data.

DO $$
BEGIN
  IF to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'P1-G prerequisite missing: public.profiles';
  END IF;

  IF to_regclass('public.stores') IS NULL THEN
    RAISE EXCEPTION 'P1-G prerequisite missing: public.stores';
  END IF;

  IF to_regclass('public.store_managers') IS NULL THEN
    RAISE EXCEPTION 'P1-G prerequisite missing: public.store_managers';
  END IF;

  IF to_regclass('public.monthly_staff_status') IS NULL THEN
    RAISE EXCEPTION 'P1-G prerequisite missing: public.monthly_staff_status';
  END IF;

  IF to_regprocedure('public.current_user_has_permission(character varying)') IS NULL THEN
    RAISE EXCEPTION 'P1-G prerequisite missing: public.current_user_has_permission(varchar)';
  END IF;

  IF to_regprocedure('public.update_updated_at_column()') IS NULL THEN
    RAISE EXCEPTION 'P1-G prerequisite missing: public.update_updated_at_column()';
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.products_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_code text NOT NULL UNIQUE,
  product_name text NOT NULL,
  unit text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.product_barcodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_code text NOT NULL REFERENCES public.products_master(product_code) ON DELETE CASCADE,
  barcode text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_barcodes_barcode_product_code_key UNIQUE (barcode, product_code)
);

CREATE TABLE IF NOT EXISTS public.acquisition_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_date date NOT NULL DEFAULT CURRENT_DATE,
  barcode text NOT NULL,
  product_code text,
  product_name text,
  unit text,
  is_matched boolean NOT NULL DEFAULT false,
  scanned_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);

CREATE TABLE IF NOT EXISTS public.acquisition_unmatched (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_date date NOT NULL DEFAULT CURRENT_DATE,
  barcode text,
  ocr_product_name text,
  ocr_barcode text,
  ocr_supplier text,
  photos jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text,
  is_resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);

CREATE TABLE IF NOT EXISTS public.relationship_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_name varchar(100) NOT NULL,
  phone varchar(30) NOT NULL,
  relationship varchar(100) NOT NULL,
  member_number varchar(50),
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  is_approved boolean NOT NULL DEFAULT false,
  approved_at timestamptz,
  approved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT relationship_members_name_not_blank CHECK (btrim(member_name::text) <> ''),
  CONSTRAINT relationship_members_phone_not_blank CHECK (btrim(phone::text) <> ''),
  CONSTRAINT relationship_members_relationship_not_blank CHECK (btrim(relationship::text) <> '')
);

CREATE TABLE IF NOT EXISTS public.relationship_sales_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name text NOT NULL,
  row_count integer NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  imported_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.relationship_sales_details (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL REFERENCES public.relationship_sales_imports(id) ON DELETE CASCADE,
  member_number varchar(50) NOT NULL,
  product_code varchar(100) NOT NULL,
  product_name varchar(300) NOT NULL,
  quantity numeric(12,2) NOT NULL,
  amount numeric(14,2) NOT NULL,
  imported_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  imported_at timestamptz NOT NULL DEFAULT now(),
  store_code varchar(50),
  sale_datetime timestamptz,
  CONSTRAINT relationship_sales_member_number_not_blank CHECK (btrim(member_number::text) <> ''),
  CONSTRAINT relationship_sales_product_code_not_blank CHECK (btrim(product_code::text) <> ''),
  CONSTRAINT relationship_sales_product_name_not_blank CHECK (btrim(product_name::text) <> '')
);

CREATE TABLE IF NOT EXISTS public.clinic_selfpay_price_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  year_month varchar(7) NOT NULL,
  health_insurance_code varchar(30) NOT NULL,
  product_code varchar(50) NOT NULL,
  product_name text,
  member_price numeric(12,2) NOT NULL DEFAULT 0,
  cost_price numeric(12,2) NOT NULL DEFAULT 0,
  source_file_name text,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  selfpay_drug_name text,
  CONSTRAINT chk_clinic_selfpay_price_entries_year_month CHECK (year_month::text ~ '^\d{4}-\d{2}$')
);

CREATE TABLE IF NOT EXISTS public.clinic_selfpay_price_month_closures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  year_month varchar(7) NOT NULL,
  closed_at timestamptz NOT NULL DEFAULT now(),
  closed_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_clinic_selfpay_price_month_closures_year_month CHECK (year_month::text ~ '^\d{4}-\d{2}$')
);

CREATE TABLE IF NOT EXISTS public.clinic_selfpay_claim_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  year_month varchar(7) NOT NULL,
  clinic_code varchar(50),
  clinic_name text,
  period_start date,
  period_end date,
  screenshot_path text,
  source_file_name text,
  source_b2_text text,
  source_b4_text text,
  status varchar(20) NOT NULL DEFAULT 'imported',
  imported_by uuid REFERENCES public.profiles(id),
  imported_at timestamptz NOT NULL DEFAULT now(),
  item_count integer NOT NULL DEFAULT 0,
  total_qty numeric(14,2) NOT NULL DEFAULT 0,
  total_billing_amount numeric(14,2) NOT NULL DEFAULT 0,
  total_gross_profit_amount numeric(14,2) NOT NULL DEFAULT 0,
  CONSTRAINT chk_clinic_selfpay_claim_batches_year_month CHECK (year_month::text ~ '^\d{4}-\d{2}$')
);

CREATE TABLE IF NOT EXISTS public.clinic_selfpay_claim_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.clinic_selfpay_claim_batches(id) ON DELETE CASCADE,
  line_no integer,
  health_insurance_code varchar(30) NOT NULL,
  drug_name text,
  qty numeric(14,2) NOT NULL DEFAULT 0,
  matched_price_entry_id uuid REFERENCES public.clinic_selfpay_price_entries(id),
  matched_product_code varchar(50),
  matched_member_price numeric(12,2),
  matched_cost_price numeric(12,2),
  billing_amount numeric(14,2) NOT NULL DEFAULT 0,
  gross_profit_amount numeric(14,2) NOT NULL DEFAULT 0,
  match_status varchar(20) NOT NULL DEFAULT 'unmatched',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.store_performance_thresholds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  period_type varchar(10) NOT NULL CHECK (period_type IN ('monthly', 'quarterly')),
  threshold_level integer NOT NULL CHECK (threshold_level >= 1 AND threshold_level <= 5),
  multiplier numeric(4,2) NOT NULL,
  base_amount integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT store_performance_thresholds_store_id_period_type_threshold_key UNIQUE (store_id, period_type, threshold_level)
);

CREATE TABLE IF NOT EXISTS public.monthly_performance_details (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_status_id uuid REFERENCES public.monthly_staff_status(id) ON DELETE CASCADE,
  store_code varchar(50) NOT NULL,
  store_name varchar(255),
  transaction_count integer DEFAULT 0,
  sales_amount numeric(12,2) DEFAULT 0,
  gross_profit numeric(12,2) DEFAULT 0,
  gross_profit_rate numeric(5,2) DEFAULT 0,
  created_at timestamptz DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz DEFAULT timezone('utc'::text, now()),
  is_from_file2 boolean DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_products_master_code ON public.products_master(product_code);
CREATE INDEX IF NOT EXISTS idx_products_master_name ON public.products_master(product_name);
CREATE INDEX IF NOT EXISTS idx_product_barcodes_barcode ON public.product_barcodes(barcode);
CREATE INDEX IF NOT EXISTS idx_product_barcodes_product_code ON public.product_barcodes(product_code);
CREATE INDEX IF NOT EXISTS idx_acquisition_scans_barcode ON public.acquisition_scans(barcode);
CREATE INDEX IF NOT EXISTS idx_acquisition_scans_date ON public.acquisition_scans(scan_date);
CREATE INDEX IF NOT EXISTS idx_acquisition_unmatched_date ON public.acquisition_unmatched(scan_date);
CREATE INDEX IF NOT EXISTS idx_acquisition_unmatched_resolved ON public.acquisition_unmatched(is_resolved);
CREATE INDEX IF NOT EXISTS idx_relationship_members_created_at ON public.relationship_members(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_relationship_members_is_approved ON public.relationship_members(is_approved);
CREATE INDEX IF NOT EXISTS idx_relationship_members_name ON public.relationship_members(member_name);
CREATE UNIQUE INDEX IF NOT EXISTS uq_relationship_members_member_number ON public.relationship_members(member_number) WHERE member_number IS NOT NULL AND btrim(member_number::text) <> '';
CREATE INDEX IF NOT EXISTS idx_relationship_sales_import_id ON public.relationship_sales_details(import_id);
CREATE INDEX IF NOT EXISTS idx_relationship_sales_imported_at ON public.relationship_sales_details(imported_at DESC);
CREATE INDEX IF NOT EXISTS idx_relationship_sales_member_number ON public.relationship_sales_details(member_number);
CREATE INDEX IF NOT EXISTS idx_relationship_sales_sale_datetime ON public.relationship_sales_details(sale_datetime DESC);
CREATE INDEX IF NOT EXISTS idx_clinic_selfpay_price_entries_code ON public.clinic_selfpay_price_entries(health_insurance_code);
CREATE INDEX IF NOT EXISTS idx_clinic_selfpay_price_entries_store_month ON public.clinic_selfpay_price_entries(store_id, year_month);
CREATE UNIQUE INDEX IF NOT EXISTS uq_clinic_selfpay_price_entries ON public.clinic_selfpay_price_entries(store_id, year_month, health_insurance_code);
CREATE UNIQUE INDEX IF NOT EXISTS uq_clinic_selfpay_price_month_closures ON public.clinic_selfpay_price_month_closures(store_id, year_month);
CREATE INDEX IF NOT EXISTS idx_clinic_selfpay_claim_batches_store_month ON public.clinic_selfpay_claim_batches(store_id, year_month, imported_at DESC);
CREATE INDEX IF NOT EXISTS idx_clinic_selfpay_claim_items_batch ON public.clinic_selfpay_claim_items(batch_id);
CREATE INDEX IF NOT EXISTS idx_clinic_selfpay_claim_items_match_status ON public.clinic_selfpay_claim_items(batch_id, match_status);
CREATE INDEX IF NOT EXISTS idx_store_perf_thresholds_store ON public.store_performance_thresholds(store_id);
CREATE INDEX IF NOT EXISTS idx_performance_details_staff_status ON public.monthly_performance_details(staff_status_id);

DROP TRIGGER IF EXISTS trg_products_master_updated_at ON public.products_master;
CREATE TRIGGER trg_products_master_updated_at
BEFORE UPDATE ON public.products_master
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_acquisition_unmatched_updated_at ON public.acquisition_unmatched;
CREATE TRIGGER trg_acquisition_unmatched_updated_at
BEFORE UPDATE ON public.acquisition_unmatched
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_clinic_selfpay_price_entries_updated_at ON public.clinic_selfpay_price_entries;
CREATE TRIGGER trg_clinic_selfpay_price_entries_updated_at
BEFORE UPDATE ON public.clinic_selfpay_price_entries
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_store_performance_thresholds_updated_at ON public.store_performance_thresholds;
CREATE TRIGGER trg_store_performance_thresholds_updated_at
BEFORE UPDATE ON public.store_performance_thresholds
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_monthly_performance_details_updated_at ON public.monthly_performance_details;
CREATE TRIGGER trg_monthly_performance_details_updated_at
BEFORE UPDATE ON public.monthly_performance_details
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.products_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_barcodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.acquisition_scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.acquisition_unmatched ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.relationship_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.relationship_sales_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.relationship_sales_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinic_selfpay_price_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinic_selfpay_price_month_closures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinic_selfpay_claim_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinic_selfpay_claim_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_performance_thresholds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monthly_performance_details ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.products_master, public.product_barcodes, public.acquisition_scans, public.acquisition_unmatched FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.relationship_members, public.relationship_sales_imports, public.relationship_sales_details FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.clinic_selfpay_price_entries, public.clinic_selfpay_price_month_closures, public.clinic_selfpay_claim_batches, public.clinic_selfpay_claim_items FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.store_performance_thresholds, public.monthly_performance_details FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.products_master, public.product_barcodes, public.acquisition_scans, public.acquisition_unmatched TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.relationship_members, public.relationship_sales_imports, public.relationship_sales_details TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.clinic_selfpay_price_entries, public.clinic_selfpay_price_month_closures, public.clinic_selfpay_claim_batches, public.clinic_selfpay_claim_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.store_performance_thresholds, public.monthly_performance_details TO authenticated;

DROP POLICY IF EXISTS p1g_products_master_read ON public.products_master;
CREATE POLICY p1g_products_master_read ON public.products_master
FOR SELECT TO authenticated
USING (public.current_user_has_permission('store.products_master.manage'));

DROP POLICY IF EXISTS p1g_products_master_write ON public.products_master;
CREATE POLICY p1g_products_master_write ON public.products_master
TO authenticated
USING (public.current_user_has_permission('store.products_master.manage'))
WITH CHECK (public.current_user_has_permission('store.products_master.manage'));

DROP POLICY IF EXISTS p1g_product_barcodes_read ON public.product_barcodes;
CREATE POLICY p1g_product_barcodes_read ON public.product_barcodes
FOR SELECT TO authenticated
USING (public.current_user_has_permission('store.products_master.manage'));

DROP POLICY IF EXISTS p1g_product_barcodes_write ON public.product_barcodes;
CREATE POLICY p1g_product_barcodes_write ON public.product_barcodes
TO authenticated
USING (public.current_user_has_permission('store.products_master.manage'))
WITH CHECK (public.current_user_has_permission('store.products_master.manage'));

DROP POLICY IF EXISTS p1g_acquisition_scans_read ON public.acquisition_scans;
CREATE POLICY p1g_acquisition_scans_read ON public.acquisition_scans
FOR SELECT TO authenticated
USING (public.current_user_has_permission('store.products_master.manage'));

DROP POLICY IF EXISTS p1g_acquisition_scans_write ON public.acquisition_scans;
CREATE POLICY p1g_acquisition_scans_write ON public.acquisition_scans
TO authenticated
USING (public.current_user_has_permission('store.products_master.manage'))
WITH CHECK (public.current_user_has_permission('store.products_master.manage'));

DROP POLICY IF EXISTS p1g_acquisition_unmatched_read ON public.acquisition_unmatched;
CREATE POLICY p1g_acquisition_unmatched_read ON public.acquisition_unmatched
FOR SELECT TO authenticated
USING (public.current_user_has_permission('store.products_master.manage'));

DROP POLICY IF EXISTS p1g_acquisition_unmatched_write ON public.acquisition_unmatched;
CREATE POLICY p1g_acquisition_unmatched_write ON public.acquisition_unmatched
TO authenticated
USING (public.current_user_has_permission('store.products_master.manage'))
WITH CHECK (public.current_user_has_permission('store.products_master.manage'));

DROP POLICY IF EXISTS p1g_relationship_members_read ON public.relationship_members;
CREATE POLICY p1g_relationship_members_read ON public.relationship_members
FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('relationship_member.view')
  OR public.current_user_has_permission('relationship_member.edit')
  OR public.current_user_has_permission('relationship_member.delete')
  OR public.current_user_has_permission('relationship_member.approve')
);

DROP POLICY IF EXISTS p1g_relationship_members_insert ON public.relationship_members;
CREATE POLICY p1g_relationship_members_insert ON public.relationship_members
FOR INSERT TO authenticated
WITH CHECK (
  public.current_user_has_permission('relationship_member.edit')
  OR public.current_user_has_permission('relationship_member.approve')
);

DROP POLICY IF EXISTS p1g_relationship_members_update ON public.relationship_members;
CREATE POLICY p1g_relationship_members_update ON public.relationship_members
FOR UPDATE TO authenticated
USING (
  public.current_user_has_permission('relationship_member.edit')
  OR public.current_user_has_permission('relationship_member.approve')
)
WITH CHECK (
  public.current_user_has_permission('relationship_member.edit')
  OR public.current_user_has_permission('relationship_member.approve')
);

DROP POLICY IF EXISTS p1g_relationship_members_delete ON public.relationship_members;
CREATE POLICY p1g_relationship_members_delete ON public.relationship_members
FOR DELETE TO authenticated
USING (public.current_user_has_permission('relationship_member.delete'));

DROP POLICY IF EXISTS p1g_relationship_sales_imports_read ON public.relationship_sales_imports;
CREATE POLICY p1g_relationship_sales_imports_read ON public.relationship_sales_imports
FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('relationship_member.view')
  OR public.current_user_has_permission('relationship_member.edit')
);

DROP POLICY IF EXISTS p1g_relationship_sales_imports_write ON public.relationship_sales_imports;
CREATE POLICY p1g_relationship_sales_imports_write ON public.relationship_sales_imports
TO authenticated
USING (public.current_user_has_permission('relationship_member.edit'))
WITH CHECK (public.current_user_has_permission('relationship_member.edit'));

DROP POLICY IF EXISTS p1g_relationship_sales_details_read ON public.relationship_sales_details;
CREATE POLICY p1g_relationship_sales_details_read ON public.relationship_sales_details
FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('relationship_member.view')
  OR public.current_user_has_permission('relationship_member.edit')
);

DROP POLICY IF EXISTS p1g_relationship_sales_details_write ON public.relationship_sales_details;
CREATE POLICY p1g_relationship_sales_details_write ON public.relationship_sales_details
TO authenticated
USING (public.current_user_has_permission('relationship_member.edit'))
WITH CHECK (public.current_user_has_permission('relationship_member.edit'));

DROP POLICY IF EXISTS p1g_clinic_selfpay_price_entries_read ON public.clinic_selfpay_price_entries;
CREATE POLICY p1g_clinic_selfpay_price_entries_read ON public.clinic_selfpay_price_entries
FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('store.clinic_selfpay.margin')
  OR public.current_user_has_permission('store.clinic_selfpay.calculator.use')
  OR public.current_user_has_permission('store.clinic_selfpay.mapping.manage')
  OR public.current_user_has_permission('store.clinic_selfpay.batch.delete')
  OR EXISTS (
    SELECT 1 FROM public.store_managers sm
    WHERE sm.user_id = auth.uid()
      AND sm.store_id = clinic_selfpay_price_entries.store_id
  )
);

DROP POLICY IF EXISTS p1g_clinic_selfpay_price_entries_write ON public.clinic_selfpay_price_entries;
CREATE POLICY p1g_clinic_selfpay_price_entries_write ON public.clinic_selfpay_price_entries
TO authenticated
USING (public.current_user_has_permission('store.clinic_selfpay.mapping.manage'))
WITH CHECK (public.current_user_has_permission('store.clinic_selfpay.mapping.manage'));

DROP POLICY IF EXISTS p1g_clinic_selfpay_price_month_closures_read ON public.clinic_selfpay_price_month_closures;
CREATE POLICY p1g_clinic_selfpay_price_month_closures_read ON public.clinic_selfpay_price_month_closures
FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('store.clinic_selfpay.mapping.manage')
  OR EXISTS (
    SELECT 1 FROM public.store_managers sm
    WHERE sm.user_id = auth.uid()
      AND sm.store_id = clinic_selfpay_price_month_closures.store_id
  )
);

DROP POLICY IF EXISTS p1g_clinic_selfpay_price_month_closures_write ON public.clinic_selfpay_price_month_closures;
CREATE POLICY p1g_clinic_selfpay_price_month_closures_write ON public.clinic_selfpay_price_month_closures
TO authenticated
USING (public.current_user_has_permission('store.clinic_selfpay.mapping.manage'))
WITH CHECK (public.current_user_has_permission('store.clinic_selfpay.mapping.manage'));

DROP POLICY IF EXISTS p1g_clinic_selfpay_claim_batches_read ON public.clinic_selfpay_claim_batches;
CREATE POLICY p1g_clinic_selfpay_claim_batches_read ON public.clinic_selfpay_claim_batches
FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('store.clinic_selfpay.margin')
  OR public.current_user_has_permission('store.clinic_selfpay.mapping.manage')
  OR public.current_user_has_permission('store.clinic_selfpay.batch.delete')
  OR EXISTS (
    SELECT 1 FROM public.store_managers sm
    WHERE sm.user_id = auth.uid()
      AND sm.store_id = clinic_selfpay_claim_batches.store_id
  )
);

DROP POLICY IF EXISTS p1g_clinic_selfpay_claim_batches_write ON public.clinic_selfpay_claim_batches;
CREATE POLICY p1g_clinic_selfpay_claim_batches_write ON public.clinic_selfpay_claim_batches
TO authenticated
USING (
  public.current_user_has_permission('store.clinic_selfpay.mapping.manage')
  OR public.current_user_has_permission('store.clinic_selfpay.batch.delete')
)
WITH CHECK (
  public.current_user_has_permission('store.clinic_selfpay.mapping.manage')
  OR public.current_user_has_permission('store.clinic_selfpay.batch.delete')
);

DROP POLICY IF EXISTS p1g_clinic_selfpay_claim_items_read ON public.clinic_selfpay_claim_items;
CREATE POLICY p1g_clinic_selfpay_claim_items_read ON public.clinic_selfpay_claim_items
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.clinic_selfpay_claim_batches b
    WHERE b.id = clinic_selfpay_claim_items.batch_id
      AND (
        public.current_user_has_permission('store.clinic_selfpay.margin')
        OR public.current_user_has_permission('store.clinic_selfpay.mapping.manage')
        OR public.current_user_has_permission('store.clinic_selfpay.batch.delete')
        OR EXISTS (
          SELECT 1 FROM public.store_managers sm
          WHERE sm.user_id = auth.uid()
            AND sm.store_id = b.store_id
        )
      )
  )
);

DROP POLICY IF EXISTS p1g_clinic_selfpay_claim_items_write ON public.clinic_selfpay_claim_items;
CREATE POLICY p1g_clinic_selfpay_claim_items_write ON public.clinic_selfpay_claim_items
TO authenticated
USING (public.current_user_has_permission('store.clinic_selfpay.mapping.manage'))
WITH CHECK (public.current_user_has_permission('store.clinic_selfpay.mapping.manage'));

DROP POLICY IF EXISTS p1g_store_performance_thresholds_read ON public.store_performance_thresholds;
CREATE POLICY p1g_store_performance_thresholds_read ON public.store_performance_thresholds
FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('performance.view')
  OR public.current_user_has_permission('performance.edit')
  OR EXISTS (
    SELECT 1 FROM public.store_managers sm
    WHERE sm.user_id = auth.uid()
      AND sm.store_id = store_performance_thresholds.store_id
  )
);

DROP POLICY IF EXISTS p1g_store_performance_thresholds_write ON public.store_performance_thresholds;
CREATE POLICY p1g_store_performance_thresholds_write ON public.store_performance_thresholds
TO authenticated
USING (public.current_user_has_permission('performance.edit'))
WITH CHECK (public.current_user_has_permission('performance.edit'));

DROP POLICY IF EXISTS p1g_monthly_performance_details_read ON public.monthly_performance_details;
CREATE POLICY p1g_monthly_performance_details_read ON public.monthly_performance_details
FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('performance.view')
  OR public.current_user_has_permission('monthly.status.view_performance')
  OR EXISTS (
    SELECT 1
    FROM public.monthly_staff_status mss
    JOIN public.store_managers sm ON sm.store_id = mss.store_id
    WHERE mss.id = monthly_performance_details.staff_status_id
      AND sm.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS p1g_monthly_performance_details_write ON public.monthly_performance_details;
CREATE POLICY p1g_monthly_performance_details_write ON public.monthly_performance_details
TO authenticated
USING (
  public.current_user_has_permission('performance.edit')
  OR public.current_user_has_permission('performance.bonus.import')
)
WITH CHECK (
  public.current_user_has_permission('performance.edit')
  OR public.current_user_has_permission('performance.bonus.import')
);
