-- P1-F Production legacy inventory result / inspection / monthly status compatibility schema.
-- DEV schema-only compatibility. Do not copy Production business data.

DO $$
BEGIN
  IF to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'P1-F prerequisite missing: public.profiles';
  END IF;

  IF to_regclass('public.stores') IS NULL THEN
    RAISE EXCEPTION 'P1-F prerequisite missing: public.stores';
  END IF;

  IF to_regclass('public.store_managers') IS NULL THEN
    RAISE EXCEPTION 'P1-F prerequisite missing: public.store_managers';
  END IF;

  IF to_regclass('public.permissions') IS NULL THEN
    RAISE EXCEPTION 'P1-F prerequisite missing: public.permissions';
  END IF;

  IF to_regprocedure('public.current_user_has_permission(character varying)') IS NULL THEN
    RAISE EXCEPTION 'P1-F prerequisite missing: public.current_user_has_permission(varchar)';
  END IF;

  IF to_regprocedure('public.update_updated_at_column()') IS NULL THEN
    RAISE EXCEPTION 'P1-F prerequisite missing: public.update_updated_at_column()';
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.inventory_result_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id),
  store_code varchar(50) NOT NULL,
  store_name varchar(100),
  inventory_order_no varchar(100) NOT NULL,
  closed_text varchar(50),
  source_file_name text,
  imported_by uuid REFERENCES public.profiles(id),
  imported_at timestamptz DEFAULT now(),
  row_count integer DEFAULT 0,
  total_difference_qty numeric(14,2) DEFAULT 0,
  total_difference_amount_member numeric(14,2) DEFAULT 0,
  shortage_count integer DEFAULT 0,
  surplus_count integer DEFAULT 0,
  zero_difference_count integer DEFAULT 0,
  total_cost numeric(14,2) DEFAULT 0,
  year_month varchar(7) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.inventory_result_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.inventory_result_batches(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.stores(id),
  row_number integer,
  closed_text varchar(50),
  product_code varchar(100),
  product_name text,
  unit varchar(50),
  storage_location_1 text,
  storage_location_2 text,
  difference_qty numeric(14,2) DEFAULT 0,
  difference_amount_member numeric(14,2) DEFAULT 0,
  cost numeric(14,2) DEFAULT 0,
  unit_cost numeric(14,4) DEFAULT 0,
  stock_qty numeric(14,2) DEFAULT 0,
  stock_amount numeric(14,2) DEFAULT 0,
  raw_data jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  category_code varchar(2),
  category_name text,
  difference_reason text,
  difference_reason_updated_by uuid REFERENCES public.profiles(id),
  difference_reason_updated_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.inventory_result_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid REFERENCES public.profiles(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.inspection_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section varchar(50) NOT NULL,
  section_name varchar(100) NOT NULL,
  section_order integer NOT NULL CHECK (section_order >= 1 AND section_order <= 5),
  item_name varchar(200) NOT NULL,
  item_description text,
  item_order integer NOT NULL,
  max_score numeric(5,1) NOT NULL CHECK (max_score > 0),
  scoring_type varchar(20) NOT NULL CHECK (scoring_type IN ('checklist', 'quantity')),
  checklist_items jsonb,
  quantity_deduction numeric(5,1),
  quantity_unit varchar(50),
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT chk_scoring_type_data CHECK (
    (scoring_type = 'checklist' AND checklist_items IS NOT NULL)
    OR (scoring_type = 'quantity' AND quantity_deduction IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS public.inspection_masters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  inspector_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  inspection_date date NOT NULL DEFAULT CURRENT_DATE,
  inspection_time time DEFAULT CURRENT_TIME,
  gps_latitude numeric(10,8),
  gps_longitude numeric(11,8),
  gps_accuracy numeric(10,2),
  gps_timestamp timestamptz,
  total_score numeric(6,1) DEFAULT 0 CHECK (total_score >= 0),
  max_possible_score numeric(6,1) DEFAULT 220,
  grade varchar(2) CHECK (grade IN ('0','1','2','3','4','5','6','7','8','9','10')),
  score_percentage numeric(5,2),
  section_1_score numeric(5,1) DEFAULT 0 CHECK (section_1_score >= 0),
  section_2_score numeric(5,1) DEFAULT 0 CHECK (section_2_score >= 0),
  section_3_score numeric(5,1) DEFAULT 0 CHECK (section_3_score >= 0),
  section_4_score numeric(5,1) DEFAULT 0 CHECK (section_4_score >= 0),
  section_5_score numeric(5,1) DEFAULT 0 CHECK (section_5_score >= 0),
  supervisor_notes text,
  improvement_suggestions text,
  store_manager_response text,
  status varchar(20) DEFAULT 'draft' CHECK (status IN ('draft', 'in_progress', 'completed', 'closed')),
  signature_photo_url text,
  signed_at timestamptz,
  closed_at timestamptz,
  closed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  inspection_type varchar(20) DEFAULT 'supervisor',
  indoor_temperature numeric(4,1),
  supervisor_signature_url text,
  improvement_bonus numeric(5,1) DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.inspection_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id uuid NOT NULL REFERENCES public.inspection_masters(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES public.inspection_templates(id) ON DELETE RESTRICT,
  max_score numeric(5,1) NOT NULL CHECK (max_score > 0),
  given_score numeric(5,1) NOT NULL DEFAULT 0 CHECK (given_score >= 0),
  deduction_amount numeric(5,1) DEFAULT 0 CHECK (deduction_amount >= 0),
  is_improvement boolean DEFAULT false,
  selected_items jsonb,
  quantity_count integer DEFAULT 0 CHECK (quantity_count >= 0),
  notes text,
  photo_urls jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT uq_inspection_template UNIQUE (inspection_id, template_id),
  CONSTRAINT chk_valid_score CHECK (given_score <= max_score),
  CONSTRAINT chk_deduction_calculation CHECK (deduction_amount = (max_score - given_score))
);

CREATE TABLE IF NOT EXISTS public.inspection_improvements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id uuid NOT NULL REFERENCES public.inspection_masters(id) ON DELETE CASCADE,
  inspection_result_id uuid REFERENCES public.inspection_results(id) ON DELETE SET NULL,
  template_id uuid NOT NULL REFERENCES public.inspection_templates(id),
  store_id uuid NOT NULL REFERENCES public.stores(id),
  section_name varchar(100) NOT NULL,
  item_name varchar(200) NOT NULL,
  deduction_amount numeric(5,1) DEFAULT 0,
  issue_description text,
  issue_photo_urls jsonb DEFAULT '[]'::jsonb,
  selected_items jsonb DEFAULT '[]'::jsonb,
  status varchar(20) DEFAULT 'pending' CHECK (status IN ('pending', 'improved', 'overdue')),
  deadline date NOT NULL,
  improvement_description text,
  improvement_photo_urls jsonb DEFAULT '[]'::jsonb,
  improved_by uuid REFERENCES public.profiles(id),
  improved_at timestamptz,
  days_taken integer,
  bonus_score numeric(5,1) DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT inspection_improvements_inspection_id_template_id_key UNIQUE (inspection_id, template_id)
);

CREATE TABLE IF NOT EXISTS public.inspection_on_duty_staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id uuid NOT NULL REFERENCES public.inspection_masters(id) ON DELETE CASCADE,
  employee_code varchar(20),
  employee_name varchar(100) NOT NULL,
  "position" varchar(50),
  is_duty_supervisor boolean DEFAULT false,
  is_manually_added boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.inspection_bonus_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day_from integer NOT NULL,
  day_to integer NOT NULL,
  bonus_score numeric(5,1) NOT NULL,
  description varchar(200),
  sort_order integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id),
  CONSTRAINT valid_day_range CHECK (day_from >= 0 AND day_to >= day_from),
  CONSTRAINT valid_bonus CHECK (bonus_score >= 0)
);

CREATE TABLE IF NOT EXISTS public.inspection_grade_mapping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grade integer NOT NULL UNIQUE CHECK (grade >= 0 AND grade <= 10),
  min_score numeric(6,1) NOT NULL CHECK (min_score >= 0),
  updated_by uuid REFERENCES public.profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.monthly_staff_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year_month varchar(7) NOT NULL,
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  employee_code varchar(20),
  employee_name varchar(100),
  "position" varchar(50),
  employment_type varchar(20) NOT NULL,
  is_pharmacist boolean DEFAULT false,
  monthly_status varchar(30) NOT NULL CHECK (monthly_status IN ('full_month', 'new_hire', 'resigned', 'leave_of_absence', 'transferred_in', 'transferred_out', 'promoted', 'support_rotation', 'dual_store_manager', 'leave_return')),
  work_days numeric(5,1),
  total_days_in_month integer DEFAULT 30,
  work_hours numeric(6,2),
  is_dual_position boolean DEFAULT false,
  has_manager_bonus boolean DEFAULT false,
  is_supervisor_rotation boolean DEFAULT false,
  calculated_block integer,
  status varchar(20) DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'confirmed')),
  submitted_at timestamptz,
  submitted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  confirmed_at timestamptz,
  confirmed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz DEFAULT timezone('utc'::text, now()),
  newbie_level varchar(20),
  partial_month_reason varchar(50),
  partial_month_days numeric(5,1),
  partial_month_notes text,
  supervisor_shift_hours numeric(5,2),
  supervisor_employee_code varchar(20),
  supervisor_name varchar(100),
  supervisor_position varchar(50),
  special_role varchar(100),
  extra_tasks text[],
  is_manually_added boolean DEFAULT false,
  start_date date,
  transaction_count integer DEFAULT 0,
  sales_amount numeric(12,2) DEFAULT 0,
  gross_profit numeric(12,2) DEFAULT 0,
  gross_profit_rate numeric(5,2) DEFAULT 0,
  support_to_other_stores_hours numeric(5,1) DEFAULT NULL,
  support_from_other_stores_hours numeric(5,1) DEFAULT NULL,
  monthly_transport_expense integer,
  transport_expense_notes text,
  extra_task_planned_hours numeric(5,1) DEFAULT NULL,
  extra_task_external_hours numeric(5,1) DEFAULT NULL,
  last_month_single_item_bonus integer,
  talent_cultivation_bonus integer,
  talent_cultivation_target text,
  is_acting_manager boolean DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.monthly_store_summary (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year_month varchar(7) NOT NULL,
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  total_employees integer DEFAULT 0,
  confirmed_count integer DEFAULT 0,
  store_status varchar(20) DEFAULT 'pending' CHECK (store_status IN ('pending', 'in_progress', 'submitted', 'confirmed')),
  submitted_at timestamptz,
  submitted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  confirmed_at timestamptz,
  confirmed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz DEFAULT timezone('utc'::text, now()),
  total_staff_count integer DEFAULT 0,
  admin_staff_count integer DEFAULT 0,
  newbie_count integer DEFAULT 0,
  business_days integer DEFAULT 0,
  total_gross_profit numeric(12,2) DEFAULT 0,
  total_customer_count integer DEFAULT 0,
  prescription_addon_only_count integer DEFAULT 0,
  regular_prescription_count integer DEFAULT 0,
  chronic_prescription_count integer DEFAULT 0,
  store_name varchar(100),
  store_code varchar(20),
  support_to_other_stores_hours numeric(5,1) DEFAULT NULL,
  support_from_other_stores_hours numeric(5,1) DEFAULT NULL,
  CONSTRAINT monthly_store_summary_year_month_store_id_key UNIQUE (year_month, store_id)
);

CREATE TABLE IF NOT EXISTS public.monthly_bonus_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id),
  year_month varchar(7) NOT NULL,
  employee_code varchar(50) NOT NULL,
  employee_name varchar(100),
  group_bonus numeric(12,2) DEFAULT 0,
  hr_subsidy_bonus numeric(12,2) DEFAULT 0,
  single_item_bonus numeric(12,2) DEFAULT 0,
  inventory_diff_penalty numeric(12,2) DEFAULT 0,
  talent_bonus numeric(12,2) DEFAULT 0,
  transport_fee numeric(12,2) DEFAULT 0,
  inventory_bonus numeric(12,2) DEFAULT 0,
  rx_incentive_bonus numeric(12,2) DEFAULT 0,
  quarterly_makeup_bonus numeric(12,2) DEFAULT 0,
  meal_allowance numeric(12,2) DEFAULT 0,
  spring_festival_bonus numeric(12,2) DEFAULT 0,
  pharmacist_guarantee numeric(12,2) DEFAULT 0,
  owner_rx_makeup numeric(12,2) DEFAULT 0,
  sales_competition_bonus numeric(12,2) DEFAULT 0,
  owner_signing_bonus numeric(12,2) DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  long_term_care_bonus numeric(12,2) DEFAULT 0,
  manager_supervisor_quarterly_bonus numeric(12,2) DEFAULT 0,
  opening_abnormal_responsibility_amount numeric(12,2) DEFAULT 0,
  bonus_difference_adjustment numeric(12,2) DEFAULT 0,
  other_bonus numeric(12,2) DEFAULT 0,
  other_bonus_note text,
  CONSTRAINT monthly_bonus_records_store_id_year_month_employee_code_key UNIQUE (store_id, year_month, employee_code)
);

CREATE INDEX IF NOT EXISTS idx_inventory_result_batches_imported_at ON public.inventory_result_batches(imported_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_result_batches_order ON public.inventory_result_batches(inventory_order_no);
CREATE INDEX IF NOT EXISTS idx_inventory_result_batches_store ON public.inventory_result_batches(store_id);
CREATE INDEX IF NOT EXISTS idx_inventory_result_batches_year_month ON public.inventory_result_batches(year_month);
CREATE INDEX IF NOT EXISTS idx_inventory_result_batches_year_month_file ON public.inventory_result_batches(year_month, source_file_name);
CREATE INDEX IF NOT EXISTS idx_inventory_result_items_batch ON public.inventory_result_items(batch_id);
CREATE INDEX IF NOT EXISTS idx_inventory_result_items_product ON public.inventory_result_items(product_code);
CREATE INDEX IF NOT EXISTS idx_inspection_masters_date ON public.inspection_masters(inspection_date DESC);
CREATE INDEX IF NOT EXISTS idx_inspection_masters_grade ON public.inspection_masters(grade);
CREATE INDEX IF NOT EXISTS idx_inspection_masters_inspector ON public.inspection_masters(inspector_id);
CREATE INDEX IF NOT EXISTS idx_inspection_masters_status ON public.inspection_masters(status);
CREATE INDEX IF NOT EXISTS idx_inspection_masters_store ON public.inspection_masters(store_id);
CREATE INDEX IF NOT EXISTS idx_inspection_masters_store_date ON public.inspection_masters(store_id, inspection_date DESC);
CREATE INDEX IF NOT EXISTS idx_inspection_masters_type ON public.inspection_masters(inspection_type);
CREATE INDEX IF NOT EXISTS idx_inspection_results_improvement ON public.inspection_results(is_improvement);
CREATE INDEX IF NOT EXISTS idx_inspection_results_inspection ON public.inspection_results(inspection_id);
CREATE INDEX IF NOT EXISTS idx_inspection_results_template ON public.inspection_results(template_id);
CREATE INDEX IF NOT EXISTS idx_inspection_templates_active ON public.inspection_templates(is_active);
CREATE INDEX IF NOT EXISTS idx_inspection_templates_order ON public.inspection_templates(section_order, item_order);
CREATE INDEX IF NOT EXISTS idx_inspection_templates_section ON public.inspection_templates(section, section_order);
CREATE INDEX IF NOT EXISTS idx_improvements_deadline ON public.inspection_improvements(deadline);
CREATE INDEX IF NOT EXISTS idx_improvements_inspection ON public.inspection_improvements(inspection_id);
CREATE INDEX IF NOT EXISTS idx_improvements_status ON public.inspection_improvements(status);
CREATE INDEX IF NOT EXISTS idx_improvements_store ON public.inspection_improvements(store_id);
CREATE INDEX IF NOT EXISTS idx_inspection_on_duty_staff_inspection_id ON public.inspection_on_duty_staff(inspection_id);
CREATE INDEX IF NOT EXISTS idx_monthly_staff_status_store_id ON public.monthly_staff_status(store_id);
CREATE INDEX IF NOT EXISTS idx_monthly_staff_status_user_id ON public.monthly_staff_status(user_id);
CREATE INDEX IF NOT EXISTS idx_monthly_staff_status_year_month ON public.monthly_staff_status(year_month);
CREATE INDEX IF NOT EXISTS idx_monthly_store_summary_year_month ON public.monthly_store_summary(year_month);
CREATE INDEX IF NOT EXISTS idx_mbr_store_yearmonth ON public.monthly_bonus_records(store_id, year_month);
CREATE INDEX IF NOT EXISTS idx_mbr_yearmonth ON public.monthly_bonus_records(year_month);

DROP TRIGGER IF EXISTS trg_inventory_result_settings_updated_at ON public.inventory_result_settings;
CREATE TRIGGER trg_inventory_result_settings_updated_at
BEFORE UPDATE ON public.inventory_result_settings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_inspection_templates_updated_at ON public.inspection_templates;
CREATE TRIGGER trg_inspection_templates_updated_at
BEFORE UPDATE ON public.inspection_templates
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_inspection_masters_updated_at ON public.inspection_masters;
CREATE TRIGGER trg_inspection_masters_updated_at
BEFORE UPDATE ON public.inspection_masters
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_inspection_results_updated_at ON public.inspection_results;
CREATE TRIGGER trg_inspection_results_updated_at
BEFORE UPDATE ON public.inspection_results
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_inspection_improvements_updated_at ON public.inspection_improvements;
CREATE TRIGGER trg_inspection_improvements_updated_at
BEFORE UPDATE ON public.inspection_improvements
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_inspection_bonus_config_updated_at ON public.inspection_bonus_config;
CREATE TRIGGER trg_inspection_bonus_config_updated_at
BEFORE UPDATE ON public.inspection_bonus_config
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_inspection_grade_mapping_updated_at ON public.inspection_grade_mapping;
CREATE TRIGGER trg_inspection_grade_mapping_updated_at
BEFORE UPDATE ON public.inspection_grade_mapping
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_monthly_staff_status_updated_at ON public.monthly_staff_status;
CREATE TRIGGER trg_monthly_staff_status_updated_at
BEFORE UPDATE ON public.monthly_staff_status
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_monthly_store_summary_updated_at ON public.monthly_store_summary;
CREATE TRIGGER trg_monthly_store_summary_updated_at
BEFORE UPDATE ON public.monthly_store_summary
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_monthly_bonus_records_updated_at ON public.monthly_bonus_records;
CREATE TRIGGER trg_monthly_bonus_records_updated_at
BEFORE UPDATE ON public.monthly_bonus_records
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.inventory_result_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_result_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_result_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inspection_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inspection_masters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inspection_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inspection_improvements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inspection_on_duty_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inspection_bonus_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inspection_grade_mapping ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monthly_staff_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monthly_store_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monthly_bonus_records ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.inventory_result_batches, public.inventory_result_items, public.inventory_result_settings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.inspection_templates, public.inspection_masters, public.inspection_results, public.inspection_improvements, public.inspection_on_duty_staff, public.inspection_bonus_config, public.inspection_grade_mapping FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.monthly_staff_status, public.monthly_store_summary, public.monthly_bonus_records FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.inventory_result_batches, public.inventory_result_items, public.inventory_result_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.inspection_templates, public.inspection_masters, public.inspection_results, public.inspection_improvements, public.inspection_on_duty_staff, public.inspection_bonus_config, public.inspection_grade_mapping TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.monthly_staff_status, public.monthly_store_summary, public.monthly_bonus_records TO authenticated;

DROP POLICY IF EXISTS p1f_inventory_result_batches_read ON public.inventory_result_batches;
CREATE POLICY p1f_inventory_result_batches_read ON public.inventory_result_batches
FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('inventory.result_analysis.import')
  OR public.current_user_has_permission('inventory.result_analysis.delete')
  OR (
    public.current_user_has_permission('inventory.result_analysis.view_own')
    AND EXISTS (
      SELECT 1 FROM public.store_managers sm
      WHERE sm.user_id = auth.uid()
        AND sm.store_id = inventory_result_batches.store_id
    )
  )
);

DROP POLICY IF EXISTS p1f_inventory_result_batches_write ON public.inventory_result_batches;
CREATE POLICY p1f_inventory_result_batches_write ON public.inventory_result_batches
TO authenticated
USING (
  public.current_user_has_permission('inventory.result_analysis.import')
  OR public.current_user_has_permission('inventory.result_analysis.delete')
)
WITH CHECK (
  public.current_user_has_permission('inventory.result_analysis.import')
  OR public.current_user_has_permission('inventory.result_analysis.delete')
);

DROP POLICY IF EXISTS p1f_inventory_result_items_read ON public.inventory_result_items;
CREATE POLICY p1f_inventory_result_items_read ON public.inventory_result_items
FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('inventory.result_analysis.import')
  OR public.current_user_has_permission('inventory.result_analysis.delete')
  OR (
    public.current_user_has_permission('inventory.result_analysis.view_own')
    AND EXISTS (
      SELECT 1 FROM public.store_managers sm
      WHERE sm.user_id = auth.uid()
        AND sm.store_id = inventory_result_items.store_id
    )
  )
);

DROP POLICY IF EXISTS p1f_inventory_result_items_update ON public.inventory_result_items;
CREATE POLICY p1f_inventory_result_items_update ON public.inventory_result_items
FOR UPDATE TO authenticated
USING (
  public.current_user_has_permission('inventory.result_analysis.import')
  OR public.current_user_has_permission('inventory.result_analysis.delete')
)
WITH CHECK (
  public.current_user_has_permission('inventory.result_analysis.import')
  OR public.current_user_has_permission('inventory.result_analysis.delete')
);

DROP POLICY IF EXISTS p1f_inventory_result_settings_read ON public.inventory_result_settings;
CREATE POLICY p1f_inventory_result_settings_read ON public.inventory_result_settings
FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('inventory.result_analysis.view_own')
  OR public.current_user_has_permission('inventory.result_analysis.import')
  OR public.current_user_has_permission('inventory.result_analysis.delete')
);

DROP POLICY IF EXISTS p1f_inventory_result_settings_write ON public.inventory_result_settings;
CREATE POLICY p1f_inventory_result_settings_write ON public.inventory_result_settings
TO authenticated
USING (public.current_user_has_permission('inventory.result_analysis.import'))
WITH CHECK (public.current_user_has_permission('inventory.result_analysis.import'));

DROP POLICY IF EXISTS p1f_inspection_templates_read ON public.inspection_templates;
CREATE POLICY p1f_inspection_templates_read ON public.inspection_templates
FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('inspection.view_own')
  OR public.current_user_has_permission('inspection.view_store')
  OR public.current_user_has_permission('inspection.view_all')
  OR public.current_user_has_permission('inspection.template.manage')
);

DROP POLICY IF EXISTS p1f_inspection_templates_write ON public.inspection_templates;
CREATE POLICY p1f_inspection_templates_write ON public.inspection_templates
TO authenticated
USING (public.current_user_has_permission('inspection.template.manage'))
WITH CHECK (public.current_user_has_permission('inspection.template.manage'));

DROP POLICY IF EXISTS p1f_inspection_masters_read ON public.inspection_masters;
CREATE POLICY p1f_inspection_masters_read ON public.inspection_masters
FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('inspection.view_all')
  OR inspector_id = auth.uid()
  OR (
    (public.current_user_has_permission('inspection.view_store') OR public.current_user_has_permission('inspection.view_own'))
    AND EXISTS (
      SELECT 1 FROM public.store_managers sm
      WHERE sm.user_id = auth.uid()
        AND sm.store_id = inspection_masters.store_id
    )
  )
);

DROP POLICY IF EXISTS p1f_inspection_masters_write ON public.inspection_masters;
CREATE POLICY p1f_inspection_masters_write ON public.inspection_masters
TO authenticated
USING (
  public.current_user_has_permission('inspection.create')
  OR public.current_user_has_permission('inspection.delete')
)
WITH CHECK (
  public.current_user_has_permission('inspection.create')
  OR public.current_user_has_permission('inspection.delete')
);

DROP POLICY IF EXISTS p1f_inspection_results_read ON public.inspection_results;
CREATE POLICY p1f_inspection_results_read ON public.inspection_results
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.inspection_masters im
    WHERE im.id = inspection_results.inspection_id
      AND (
        public.current_user_has_permission('inspection.view_all')
        OR im.inspector_id = auth.uid()
        OR (
          (public.current_user_has_permission('inspection.view_store') OR public.current_user_has_permission('inspection.view_own'))
          AND EXISTS (
            SELECT 1 FROM public.store_managers sm
            WHERE sm.user_id = auth.uid()
              AND sm.store_id = im.store_id
          )
        )
      )
  )
);

DROP POLICY IF EXISTS p1f_inspection_results_write ON public.inspection_results;
CREATE POLICY p1f_inspection_results_write ON public.inspection_results
TO authenticated
USING (public.current_user_has_permission('inspection.create'))
WITH CHECK (public.current_user_has_permission('inspection.create'));

DROP POLICY IF EXISTS p1f_inspection_improvements_read ON public.inspection_improvements;
CREATE POLICY p1f_inspection_improvements_read ON public.inspection_improvements
FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('inspection.improvement.view')
  OR public.current_user_has_permission('inspection.improvement.manage')
  OR public.current_user_has_permission('inspection.view_all')
  OR EXISTS (
    SELECT 1 FROM public.store_managers sm
    WHERE sm.user_id = auth.uid()
      AND sm.store_id = inspection_improvements.store_id
  )
);

DROP POLICY IF EXISTS p1f_inspection_improvements_write ON public.inspection_improvements;
CREATE POLICY p1f_inspection_improvements_write ON public.inspection_improvements
TO authenticated
USING (
  public.current_user_has_permission('inspection.improvement.submit')
  OR public.current_user_has_permission('inspection.improvement.manage')
)
WITH CHECK (
  public.current_user_has_permission('inspection.improvement.submit')
  OR public.current_user_has_permission('inspection.improvement.manage')
);

DROP POLICY IF EXISTS p1f_inspection_on_duty_staff_read ON public.inspection_on_duty_staff;
CREATE POLICY p1f_inspection_on_duty_staff_read ON public.inspection_on_duty_staff
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.inspection_masters im
    WHERE im.id = inspection_on_duty_staff.inspection_id
      AND (
        public.current_user_has_permission('inspection.view_all')
        OR im.inspector_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.store_managers sm
          WHERE sm.user_id = auth.uid()
            AND sm.store_id = im.store_id
        )
      )
  )
);

DROP POLICY IF EXISTS p1f_inspection_on_duty_staff_write ON public.inspection_on_duty_staff;
CREATE POLICY p1f_inspection_on_duty_staff_write ON public.inspection_on_duty_staff
TO authenticated
USING (public.current_user_has_permission('inspection.create'))
WITH CHECK (public.current_user_has_permission('inspection.create'));

DROP POLICY IF EXISTS p1f_inspection_bonus_config_read ON public.inspection_bonus_config;
CREATE POLICY p1f_inspection_bonus_config_read ON public.inspection_bonus_config
FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('inspection.view_all')
  OR public.current_user_has_permission('inspection.improvement.view')
  OR public.current_user_has_permission('inspection.improvement.manage')
);

DROP POLICY IF EXISTS p1f_inspection_bonus_config_write ON public.inspection_bonus_config;
CREATE POLICY p1f_inspection_bonus_config_write ON public.inspection_bonus_config
TO authenticated
USING (public.current_user_has_permission('inspection.improvement.manage'))
WITH CHECK (public.current_user_has_permission('inspection.improvement.manage'));

DROP POLICY IF EXISTS p1f_inspection_grade_mapping_read ON public.inspection_grade_mapping;
CREATE POLICY p1f_inspection_grade_mapping_read ON public.inspection_grade_mapping
FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('inspection.view_own')
  OR public.current_user_has_permission('inspection.view_store')
  OR public.current_user_has_permission('inspection.view_all')
);

DROP POLICY IF EXISTS p1f_inspection_grade_mapping_write ON public.inspection_grade_mapping;
CREATE POLICY p1f_inspection_grade_mapping_write ON public.inspection_grade_mapping
TO authenticated
USING (public.current_user_has_permission('inspection.improvement.manage'))
WITH CHECK (public.current_user_has_permission('inspection.improvement.manage'));

DROP POLICY IF EXISTS p1f_monthly_staff_status_read ON public.monthly_staff_status;
CREATE POLICY p1f_monthly_staff_status_read ON public.monthly_staff_status
FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('monthly.status.view_all')
  OR user_id = auth.uid()
  OR (
    public.current_user_has_permission('monthly.status.view_own')
    AND EXISTS (
      SELECT 1 FROM public.store_managers sm
      WHERE sm.user_id = auth.uid()
        AND sm.store_id = monthly_staff_status.store_id
    )
  )
);

DROP POLICY IF EXISTS p1f_monthly_staff_status_write ON public.monthly_staff_status;
CREATE POLICY p1f_monthly_staff_status_write ON public.monthly_staff_status
TO authenticated
USING (
  public.current_user_has_permission('monthly.status.confirm')
  OR public.current_user_has_permission('monthly.status.view_all')
)
WITH CHECK (
  public.current_user_has_permission('monthly.status.confirm')
  OR public.current_user_has_permission('monthly.status.view_all')
);

DROP POLICY IF EXISTS p1f_monthly_store_summary_read ON public.monthly_store_summary;
CREATE POLICY p1f_monthly_store_summary_read ON public.monthly_store_summary
FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('monthly.status.view_all')
  OR (
    public.current_user_has_permission('monthly.status.view_own')
    AND EXISTS (
      SELECT 1 FROM public.store_managers sm
      WHERE sm.user_id = auth.uid()
        AND sm.store_id = monthly_store_summary.store_id
    )
  )
);

DROP POLICY IF EXISTS p1f_monthly_store_summary_write ON public.monthly_store_summary;
CREATE POLICY p1f_monthly_store_summary_write ON public.monthly_store_summary
TO authenticated
USING (
  public.current_user_has_permission('monthly.status.confirm')
  OR public.current_user_has_permission('monthly.status.view_all')
)
WITH CHECK (
  public.current_user_has_permission('monthly.status.confirm')
  OR public.current_user_has_permission('monthly.status.view_all')
);

DROP POLICY IF EXISTS p1f_monthly_bonus_records_read ON public.monthly_bonus_records;
CREATE POLICY p1f_monthly_bonus_records_read ON public.monthly_bonus_records
FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('monthly.status.view_all')
  OR (
    public.current_user_has_permission('monthly.status.view_own')
    AND EXISTS (
      SELECT 1 FROM public.store_managers sm
      WHERE sm.user_id = auth.uid()
        AND sm.store_id = monthly_bonus_records.store_id
    )
  )
);

DROP POLICY IF EXISTS p1f_monthly_bonus_records_write ON public.monthly_bonus_records;
CREATE POLICY p1f_monthly_bonus_records_write ON public.monthly_bonus_records
TO authenticated
USING (
  public.current_user_has_permission('monthly.status.confirm')
  OR public.current_user_has_permission('monthly.status.view_all')
)
WITH CHECK (
  public.current_user_has_permission('monthly.status.confirm')
  OR public.current_user_has_permission('monthly.status.view_all')
);
