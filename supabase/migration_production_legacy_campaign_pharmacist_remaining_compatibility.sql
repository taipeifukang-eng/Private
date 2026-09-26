-- P1-H Production legacy campaign / pharmacist / stockout / bonus compatibility schema.
-- DEV schema-only compatibility. Do not copy Production business data.

DO $$
BEGIN
  IF to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'P1-H prerequisite missing: public.profiles';
  END IF;

  IF to_regclass('public.stores') IS NULL THEN
    RAISE EXCEPTION 'P1-H prerequisite missing: public.stores';
  END IF;

  IF to_regclass('public.store_managers') IS NULL THEN
    RAISE EXCEPTION 'P1-H prerequisite missing: public.store_managers';
  END IF;

  IF to_regprocedure('public.current_user_has_permission(character varying)') IS NULL THEN
    RAISE EXCEPTION 'P1-H prerequisite missing: public.current_user_has_permission(varchar)';
  END IF;

  IF to_regprocedure('public.update_updated_at_column()') IS NULL THEN
    RAISE EXCEPTION 'P1-H prerequisite missing: public.update_updated_at_column()';
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  published_to_supervisors boolean DEFAULT false,
  published_to_store_managers boolean DEFAULT false,
  published_at timestamptz,
  published_to_inventory_team boolean DEFAULT false,
  campaign_type text NOT NULL DEFAULT 'promotion' CHECK (campaign_type = ANY (ARRAY['promotion', 'inventory']))
);

CREATE TABLE IF NOT EXISTS public.campaign_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid REFERENCES public.campaigns(id) ON DELETE CASCADE,
  store_id uuid REFERENCES public.stores(id) ON DELETE CASCADE,
  activity_date date NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT campaign_schedules_campaign_id_store_id_key UNIQUE (campaign_id, store_id)
);

CREATE TABLE IF NOT EXISTS public.campaign_store_details (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  outdoor_vendor text,
  red_bean_cake text,
  circulation text,
  quantum text,
  bone_density text,
  supervisor text,
  manager text,
  tasting text,
  activity_team text,
  sales1 text,
  sales2 text,
  sales3 text,
  sales4 text,
  sales5 text,
  sales6 text,
  indoor_pt1 text,
  indoor_pt2 text,
  notes text,
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  has_external_inventory_company text,
  planned_inventory_time text,
  inventory_staff text,
  CONSTRAINT campaign_store_details_campaign_id_store_id_key UNIQUE (campaign_id, store_id)
);

CREATE TABLE IF NOT EXISTS public.campaign_store_headcount (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  extra_support_count integer DEFAULT 0 CHECK (extra_support_count >= 0),
  notes text,
  updated_at timestamptz DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id),
  supervisor_count integer DEFAULT 0 CHECK (supervisor_count >= 0),
  CONSTRAINT campaign_store_headcount_campaign_id_store_id_key UNIQUE (campaign_id, store_id)
);

CREATE TABLE IF NOT EXISTS public.campaign_store_own_staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  employee_code varchar(20) NOT NULL,
  employee_name varchar(100) NOT NULL,
  "position" varchar(50),
  is_manually_added boolean DEFAULT false,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  CONSTRAINT campaign_store_own_staff_campaign_id_store_id_employee_code_key UNIQUE (campaign_id, store_id, employee_code)
);

CREATE TABLE IF NOT EXISTS public.campaign_support_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  requesting_store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  supporting_store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  requested_count integer NOT NULL DEFAULT 1 CHECK (requested_count > 0),
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  CONSTRAINT campaign_support_requests_campaign_id_requesting_store_id_s_key UNIQUE (campaign_id, requesting_store_id, supporting_store_id)
);

CREATE TABLE IF NOT EXISTS public.campaign_support_staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  support_request_id uuid NOT NULL REFERENCES public.campaign_support_requests(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  supporting_store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  requesting_store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  employee_code varchar(20) NOT NULL,
  employee_name varchar(100) NOT NULL,
  "position" varchar(50),
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);

CREATE TABLE IF NOT EXISTS public.campaign_equipment_trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  set_number integer NOT NULL CHECK (set_number >= 1 AND set_number <= 5),
  trip_date date NOT NULL,
  from_location text NOT NULL,
  to_location text NOT NULL,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);

CREATE TABLE IF NOT EXISTS public.campaign_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  item_order integer NOT NULL DEFAULT 0,
  task_name text NOT NULL,
  notes text,
  assigned_person text,
  deadline text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id),
  updated_by uuid REFERENCES public.profiles(id)
);

CREATE TABLE IF NOT EXISTS public.campaign_checklist_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_item_id uuid NOT NULL REFERENCES public.campaign_checklist_items(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  is_completed boolean DEFAULT false,
  completed_by uuid REFERENCES public.profiles(id),
  completed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  manager_note text,
  store_assigned_person text,
  CONSTRAINT campaign_checklist_completions_checklist_item_id_store_id_key UNIQUE (checklist_item_id, store_id)
);

CREATE TABLE IF NOT EXISTS public.campaign_department_publish (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  marketing_content text,
  marketing_rules text,
  marketing_image_name text,
  marketing_image_data text,
  merchandise_gift_rules_name text,
  merchandise_gift_rules_data text,
  merchandise_supply_content text,
  merchandise_allocation_file_name text,
  merchandise_allocation_file_data text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  marketing_image_paths jsonb DEFAULT '[]'::jsonb,
  marketing_image_names jsonb DEFAULT '[]'::jsonb,
  CONSTRAINT campaign_department_publish_campaign_id_key UNIQUE (campaign_id)
);

CREATE TABLE IF NOT EXISTS public.event_dates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_date date NOT NULL UNIQUE,
  description text,
  event_type text CHECK (event_type = ANY (ARRAY['holiday', 'company_event', 'other'])),
  is_blocked boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.store_activity_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid UNIQUE REFERENCES public.stores(id) ON DELETE CASCADE,
  allowed_days integer[],
  forbidden_days integer[],
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pharmacist_profiles (
  employee_code varchar(20) PRIMARY KEY,
  school text,
  is_responsible_pharmacist boolean DEFAULT false,
  license_renewal_date date,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  education_level text
);

CREATE TABLE IF NOT EXISTS public.pharmacist_annual_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year integer NOT NULL,
  employee_code varchar(20) NOT NULL,
  employee_name varchar(100),
  status varchar(20) NOT NULL DEFAULT 'active',
  status_date date,
  join_date date,
  resignation_date date,
  current_store_id uuid REFERENCES public.stores(id),
  current_position varchar(50),
  source varchar(20) DEFAULT 'initial',
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT pharmacist_annual_master_year_employee_unique UNIQUE (year, employee_code)
);

CREATE TABLE IF NOT EXISTS public.pharmacist_annual_fees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_code varchar(20) NOT NULL,
  association_city text NOT NULL,
  fee_year integer NOT NULL,
  fee_period_start date,
  fee_period_end date,
  payment_proof_path text,
  notes text,
  created_by text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pharmacist_annual_master_locks (
  year integer PRIMARY KEY,
  locked_at timestamptz DEFAULT now(),
  locked_by varchar(100)
);

CREATE TABLE IF NOT EXISTS public.pharmacist_annual_master_sync_log (
  year integer PRIMARY KEY,
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pharmacist_monthly_snapshot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year_month text NOT NULL,
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  employee_code text NOT NULL,
  employee_name text NOT NULL DEFAULT '',
  "position" text,
  is_active boolean NOT NULL DEFAULT true,
  source text NOT NULL DEFAULT 'seed' CHECK (source = ANY (ARRAY['seed', 'manual', 'movement'])),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pharmacist_monthly_snapshot_year_month_store_id_employee_co_key UNIQUE (year_month, store_id, employee_code)
);

CREATE TABLE IF NOT EXISTS public.pharmacist_monthly_snapshot_sync_log (
  year_month text PRIMARY KEY,
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pharmacist_snapshot_locks (
  year_month text PRIMARY KEY CHECK (year_month ~ '^\d{4}-\d{2}$'),
  locked_at timestamptz NOT NULL DEFAULT now(),
  locked_by text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS public.stockout_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  product_code text NOT NULL,
  product_name text NOT NULL,
  required_qty integer NOT NULL DEFAULT 1 CHECK (required_qty > 0),
  reported_by uuid NOT NULL REFERENCES auth.users(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status = ANY (ARRAY['pending', 'responded'])),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.stockout_product_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_code text NOT NULL UNIQUE,
  product_name text NOT NULL,
  response_content text NOT NULL,
  responded_by uuid NOT NULL REFERENCES auth.users(id),
  responded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  eta_date date
);

CREATE TABLE IF NOT EXISTS public.stockout_product_response_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id uuid REFERENCES public.stockout_product_responses(id) ON DELETE SET NULL,
  product_code text NOT NULL,
  product_name text NOT NULL,
  response_content text NOT NULL,
  eta_date date,
  responded_by uuid NOT NULL,
  responded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.meal_allowance_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year_month text NOT NULL,
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  record_date text NOT NULL,
  employee_code text,
  employee_name text NOT NULL,
  work_hours text NOT NULL,
  meal_period text NOT NULL,
  employee_type text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.spring_festival_bonus (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year_month text NOT NULL,
  store_id uuid NOT NULL REFERENCES public.stores(id),
  employee_code text NOT NULL,
  employee_name text NOT NULL,
  attendance_date date NOT NULL,
  category text NOT NULL CHECK (category = ANY (ARRAY['藥師', '主管', '專員'])),
  bonus_amount integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  CONSTRAINT spring_festival_bonus_year_month_store_id_employee_code_att_key UNIQUE (year_month, store_id, employee_code, attendance_date)
);

CREATE TABLE IF NOT EXISTS public.support_staff_bonus (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year_month varchar(7) NOT NULL,
  employee_code varchar(20) NOT NULL,
  employee_name text NOT NULL,
  bonus_amount numeric(10,2) DEFAULT 0,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz DEFAULT timezone('utc'::text, now()),
  store_id uuid REFERENCES public.stores(id)
);

CREATE TABLE IF NOT EXISTS public.talent_cultivation_bonus (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year_month varchar(7) NOT NULL,
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  employee_code varchar(20) NOT NULL,
  employee_name varchar(100) NOT NULL,
  cultivation_bonus integer NOT NULL DEFAULT 0,
  cultivation_target varchar(500) NOT NULL DEFAULT '',
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT talent_cultivation_bonus_year_month_store_id_employee_code_key UNIQUE (year_month, store_id, employee_code)
);

CREATE TABLE IF NOT EXISTS public.store_performance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  year integer NOT NULL CHECK (year >= 2020 AND year <= 2099),
  month integer NOT NULL CHECK (month >= 1 AND month <= 12),
  business_days integer NOT NULL DEFAULT 30 CHECK (business_days > 0 AND business_days <= 31),
  monthly_gross_profit_target bigint,
  monthly_revenue_target bigint,
  monthly_customer_count_target integer,
  last_month_rx_target integer,
  monthly_gross_profit_actual bigint,
  monthly_revenue_actual bigint,
  monthly_customer_count_actual integer,
  last_month_rx_actual integer,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  system_monthly_revenue bigint,
  self_pay_monthly_revenue bigint,
  monthly_true_gross_profit bigint,
  system_monthly_gross_profit bigint,
  monthly_long_term_care_gross_profit bigint,
  monthly_rx_addon_makeup_gross_profit bigint,
  monthly_theft_compensation_makeup_gross_profit bigint,
  monthly_kamedis_deduction_gross_profit bigint,
  activity_day_gross_profit bigint,
  CONSTRAINT store_performance_store_id_year_month_key UNIQUE (store_id, year, month)
);

CREATE OR REPLACE FUNCTION public.p1h_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.p1h_sync_stockout_report_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.stockout_reports
  SET status = 'responded', updated_at = now()
  WHERE product_code = NEW.product_code
    AND status = 'pending';
  RETURN NEW;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_campaigns_published ON public.campaigns(published_to_supervisors, published_to_store_managers, published_to_inventory_team);
CREATE INDEX IF NOT EXISTS idx_campaign_schedules_campaign_id ON public.campaign_schedules(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_schedules_date ON public.campaign_schedules(activity_date);
CREATE INDEX IF NOT EXISTS idx_campaign_store_details_campaign_id ON public.campaign_store_details(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_store_details_store_id ON public.campaign_store_details(store_id);
CREATE INDEX IF NOT EXISTS idx_campaign_store_headcount ON public.campaign_store_headcount(campaign_id, store_id);
CREATE INDEX IF NOT EXISTS idx_campaign_store_own_staff_campaign_store ON public.campaign_store_own_staff(campaign_id, store_id);
CREATE INDEX IF NOT EXISTS idx_campaign_support_requests_campaign ON public.campaign_support_requests(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_support_requests_requesting ON public.campaign_support_requests(campaign_id, requesting_store_id);
CREATE INDEX IF NOT EXISTS idx_campaign_support_staff_request ON public.campaign_support_staff(support_request_id);
CREATE INDEX IF NOT EXISTS idx_equipment_trips_campaign ON public.campaign_equipment_trips(campaign_id, trip_date);
CREATE INDEX IF NOT EXISTS idx_checklist_items_campaign_id ON public.campaign_checklist_items(campaign_id);
CREATE INDEX IF NOT EXISTS idx_checklist_items_order ON public.campaign_checklist_items(campaign_id, item_order);
CREATE INDEX IF NOT EXISTS idx_checklist_completions_item_id ON public.campaign_checklist_completions(checklist_item_id);
CREATE INDEX IF NOT EXISTS idx_checklist_completions_lookup ON public.campaign_checklist_completions(checklist_item_id, store_id);
CREATE INDEX IF NOT EXISTS idx_checklist_completions_store_id ON public.campaign_checklist_completions(store_id);
CREATE INDEX IF NOT EXISTS idx_campaign_department_publish_campaign ON public.campaign_department_publish(campaign_id);
CREATE INDEX IF NOT EXISTS idx_event_dates_date ON public.event_dates(event_date);
CREATE INDEX IF NOT EXISTS idx_store_activity_settings_store_id ON public.store_activity_settings(store_id);
CREATE INDEX IF NOT EXISTS idx_pharmacist_annual_fees_code ON public.pharmacist_annual_fees(employee_code);
CREATE INDEX IF NOT EXISTS idx_pharmacist_annual_fees_year ON public.pharmacist_annual_fees(employee_code, fee_year);
CREATE INDEX IF NOT EXISTS idx_pharmacist_annual_master_employee_code ON public.pharmacist_annual_master(employee_code);
CREATE INDEX IF NOT EXISTS idx_pharmacist_annual_master_status ON public.pharmacist_annual_master(status);
CREATE INDEX IF NOT EXISTS idx_pharmacist_annual_master_year ON public.pharmacist_annual_master(year);
CREATE INDEX IF NOT EXISTS idx_pharmacist_annual_master_year_status ON public.pharmacist_annual_master(year, status);
CREATE INDEX IF NOT EXISTS idx_pharmacist_monthly_snapshot_employee ON public.pharmacist_monthly_snapshot(employee_code);
CREATE INDEX IF NOT EXISTS idx_pharmacist_monthly_snapshot_store ON public.pharmacist_monthly_snapshot(store_id);
CREATE INDEX IF NOT EXISTS idx_pharmacist_monthly_snapshot_year_month ON public.pharmacist_monthly_snapshot(year_month);
CREATE INDEX IF NOT EXISTS idx_stockout_product_responses_eta_date ON public.stockout_product_responses(eta_date);
CREATE INDEX IF NOT EXISTS idx_stockout_response_history_product_code_time ON public.stockout_product_response_history(product_code, responded_at DESC);
CREATE INDEX IF NOT EXISTS idx_stockout_response_history_responded_at ON public.stockout_product_response_history(responded_at DESC);
CREATE INDEX IF NOT EXISTS idx_meal_allowance_store_id ON public.meal_allowance_records(store_id);
CREATE INDEX IF NOT EXISTS idx_meal_allowance_year_month ON public.meal_allowance_records(year_month);
CREATE INDEX IF NOT EXISTS idx_meal_allowance_year_month_store ON public.meal_allowance_records(year_month, store_id);
CREATE INDEX IF NOT EXISTS idx_spring_festival_bonus_employee ON public.spring_festival_bonus(employee_code);
CREATE INDEX IF NOT EXISTS idx_spring_festival_bonus_store_id ON public.spring_festival_bonus(store_id);
CREATE INDEX IF NOT EXISTS idx_spring_festival_bonus_year_month ON public.spring_festival_bonus(year_month);
CREATE INDEX IF NOT EXISTS idx_support_bonus_employee_code ON public.support_staff_bonus(employee_code);
CREATE INDEX IF NOT EXISTS idx_support_bonus_store_id ON public.support_staff_bonus(store_id);
CREATE INDEX IF NOT EXISTS idx_support_bonus_store_year_month ON public.support_staff_bonus(store_id, year_month);
CREATE INDEX IF NOT EXISTS idx_support_bonus_year_month ON public.support_staff_bonus(year_month);
CREATE INDEX IF NOT EXISTS idx_support_bonus_year_month_employee ON public.support_staff_bonus(year_month, employee_code);
CREATE INDEX IF NOT EXISTS idx_talent_cultivation_bonus_employee ON public.talent_cultivation_bonus(employee_code);
CREATE INDEX IF NOT EXISTS idx_talent_cultivation_bonus_store ON public.talent_cultivation_bonus(store_id);
CREATE INDEX IF NOT EXISTS idx_talent_cultivation_bonus_year_month ON public.talent_cultivation_bonus(year_month);
CREATE INDEX IF NOT EXISTS idx_store_performance_store ON public.store_performance(store_id);
CREATE INDEX IF NOT EXISTS idx_store_performance_year_month ON public.store_performance(year, month);

DROP TRIGGER IF EXISTS trg_campaigns_updated_at ON public.campaigns;
CREATE TRIGGER trg_campaigns_updated_at BEFORE UPDATE ON public.campaigns FOR EACH ROW EXECUTE FUNCTION public.p1h_set_updated_at();
DROP TRIGGER IF EXISTS trg_campaign_schedules_updated_at ON public.campaign_schedules;
CREATE TRIGGER trg_campaign_schedules_updated_at BEFORE UPDATE ON public.campaign_schedules FOR EACH ROW EXECUTE FUNCTION public.p1h_set_updated_at();
DROP TRIGGER IF EXISTS trg_campaign_store_details_updated_at ON public.campaign_store_details;
CREATE TRIGGER trg_campaign_store_details_updated_at BEFORE UPDATE ON public.campaign_store_details FOR EACH ROW EXECUTE FUNCTION public.p1h_set_updated_at();
DROP TRIGGER IF EXISTS trg_campaign_store_headcount_updated_at ON public.campaign_store_headcount;
CREATE TRIGGER trg_campaign_store_headcount_updated_at BEFORE UPDATE ON public.campaign_store_headcount FOR EACH ROW EXECUTE FUNCTION public.p1h_set_updated_at();
DROP TRIGGER IF EXISTS trg_campaign_store_own_staff_updated_at ON public.campaign_store_own_staff;
CREATE TRIGGER trg_campaign_store_own_staff_updated_at BEFORE UPDATE ON public.campaign_store_own_staff FOR EACH ROW EXECUTE FUNCTION public.p1h_set_updated_at();
DROP TRIGGER IF EXISTS trg_campaign_support_requests_updated_at ON public.campaign_support_requests;
CREATE TRIGGER trg_campaign_support_requests_updated_at BEFORE UPDATE ON public.campaign_support_requests FOR EACH ROW EXECUTE FUNCTION public.p1h_set_updated_at();
DROP TRIGGER IF EXISTS trg_campaign_support_staff_updated_at ON public.campaign_support_staff;
CREATE TRIGGER trg_campaign_support_staff_updated_at BEFORE UPDATE ON public.campaign_support_staff FOR EACH ROW EXECUTE FUNCTION public.p1h_set_updated_at();
DROP TRIGGER IF EXISTS trg_equipment_trips_updated_at ON public.campaign_equipment_trips;
CREATE TRIGGER trg_equipment_trips_updated_at BEFORE UPDATE ON public.campaign_equipment_trips FOR EACH ROW EXECUTE FUNCTION public.p1h_set_updated_at();
DROP TRIGGER IF EXISTS trigger_update_campaign_checklist_items_updated_at ON public.campaign_checklist_items;
CREATE TRIGGER trigger_update_campaign_checklist_items_updated_at BEFORE UPDATE ON public.campaign_checklist_items FOR EACH ROW EXECUTE FUNCTION public.p1h_set_updated_at();
DROP TRIGGER IF EXISTS trigger_update_campaign_checklist_completions_updated_at ON public.campaign_checklist_completions;
CREATE TRIGGER trigger_update_campaign_checklist_completions_updated_at BEFORE UPDATE ON public.campaign_checklist_completions FOR EACH ROW EXECUTE FUNCTION public.p1h_set_updated_at();
DROP TRIGGER IF EXISTS trg_campaign_department_publish_updated_at ON public.campaign_department_publish;
CREATE TRIGGER trg_campaign_department_publish_updated_at BEFORE UPDATE ON public.campaign_department_publish FOR EACH ROW EXECUTE FUNCTION public.p1h_set_updated_at();
DROP TRIGGER IF EXISTS trg_event_dates_updated_at ON public.event_dates;
CREATE TRIGGER trg_event_dates_updated_at BEFORE UPDATE ON public.event_dates FOR EACH ROW EXECUTE FUNCTION public.p1h_set_updated_at();
DROP TRIGGER IF EXISTS trg_store_activity_settings_updated_at ON public.store_activity_settings;
CREATE TRIGGER trg_store_activity_settings_updated_at BEFORE UPDATE ON public.store_activity_settings FOR EACH ROW EXECUTE FUNCTION public.p1h_set_updated_at();
DROP TRIGGER IF EXISTS trg_pharmacist_profiles_updated_at ON public.pharmacist_profiles;
CREATE TRIGGER trg_pharmacist_profiles_updated_at BEFORE UPDATE ON public.pharmacist_profiles FOR EACH ROW EXECUTE FUNCTION public.p1h_set_updated_at();
DROP TRIGGER IF EXISTS trigger_pharmacist_annual_master_updated_at ON public.pharmacist_annual_master;
CREATE TRIGGER trigger_pharmacist_annual_master_updated_at BEFORE UPDATE ON public.pharmacist_annual_master FOR EACH ROW EXECUTE FUNCTION public.p1h_set_updated_at();
DROP TRIGGER IF EXISTS trg_pharmacist_annual_fees_updated_at ON public.pharmacist_annual_fees;
CREATE TRIGGER trg_pharmacist_annual_fees_updated_at BEFORE UPDATE ON public.pharmacist_annual_fees FOR EACH ROW EXECUTE FUNCTION public.p1h_set_updated_at();
DROP TRIGGER IF EXISTS trg_pharmacist_monthly_snapshot_updated_at ON public.pharmacist_monthly_snapshot;
CREATE TRIGGER trg_pharmacist_monthly_snapshot_updated_at BEFORE UPDATE ON public.pharmacist_monthly_snapshot FOR EACH ROW EXECUTE FUNCTION public.p1h_set_updated_at();
DROP TRIGGER IF EXISTS trg_stockout_reports_updated_at ON public.stockout_reports;
CREATE TRIGGER trg_stockout_reports_updated_at BEFORE UPDATE ON public.stockout_reports FOR EACH ROW EXECUTE FUNCTION public.p1h_set_updated_at();
DROP TRIGGER IF EXISTS trg_stockout_product_responses_updated_at ON public.stockout_product_responses;
CREATE TRIGGER trg_stockout_product_responses_updated_at BEFORE UPDATE ON public.stockout_product_responses FOR EACH ROW EXECUTE FUNCTION public.p1h_set_updated_at();
DROP TRIGGER IF EXISTS trg_sync_stockout_status ON public.stockout_product_responses;
CREATE TRIGGER trg_sync_stockout_status AFTER INSERT OR UPDATE ON public.stockout_product_responses FOR EACH ROW EXECUTE FUNCTION public.p1h_sync_stockout_report_status();
DROP TRIGGER IF EXISTS trg_meal_allowance_records_updated_at ON public.meal_allowance_records;
CREATE TRIGGER trg_meal_allowance_records_updated_at BEFORE UPDATE ON public.meal_allowance_records FOR EACH ROW EXECUTE FUNCTION public.p1h_set_updated_at();
DROP TRIGGER IF EXISTS trg_spring_festival_bonus_updated_at ON public.spring_festival_bonus;
CREATE TRIGGER trg_spring_festival_bonus_updated_at BEFORE UPDATE ON public.spring_festival_bonus FOR EACH ROW EXECUTE FUNCTION public.p1h_set_updated_at();
DROP TRIGGER IF EXISTS trigger_update_support_bonus_updated_at ON public.support_staff_bonus;
CREATE TRIGGER trigger_update_support_bonus_updated_at BEFORE UPDATE ON public.support_staff_bonus FOR EACH ROW EXECUTE FUNCTION public.p1h_set_updated_at();
DROP TRIGGER IF EXISTS trg_talent_cultivation_bonus_updated_at ON public.talent_cultivation_bonus;
CREATE TRIGGER trg_talent_cultivation_bonus_updated_at BEFORE UPDATE ON public.talent_cultivation_bonus FOR EACH ROW EXECUTE FUNCTION public.p1h_set_updated_at();
DROP TRIGGER IF EXISTS trg_store_performance_updated_at ON public.store_performance;
CREATE TRIGGER trg_store_performance_updated_at BEFORE UPDATE ON public.store_performance FOR EACH ROW EXECUTE FUNCTION public.p1h_set_updated_at();

ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_store_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_store_headcount ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_store_own_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_support_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_support_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_equipment_trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_checklist_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_department_publish ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_dates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_activity_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pharmacist_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pharmacist_annual_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pharmacist_annual_fees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pharmacist_annual_master_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pharmacist_annual_master_sync_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pharmacist_monthly_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pharmacist_monthly_snapshot_sync_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pharmacist_snapshot_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stockout_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stockout_product_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stockout_product_response_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meal_allowance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spring_festival_bonus ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_staff_bonus ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.talent_cultivation_bonus ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_performance ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.campaigns, public.campaign_schedules, public.campaign_store_details, public.campaign_store_headcount, public.campaign_store_own_staff, public.campaign_support_requests, public.campaign_support_staff, public.campaign_equipment_trips, public.campaign_checklist_items, public.campaign_checklist_completions, public.campaign_department_publish, public.event_dates, public.store_activity_settings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.pharmacist_profiles, public.pharmacist_annual_master, public.pharmacist_annual_fees, public.pharmacist_annual_master_locks, public.pharmacist_annual_master_sync_log, public.pharmacist_monthly_snapshot, public.pharmacist_monthly_snapshot_sync_log, public.pharmacist_snapshot_locks FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.stockout_reports, public.stockout_product_responses, public.stockout_product_response_history FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.meal_allowance_records, public.spring_festival_bonus, public.support_staff_bonus, public.talent_cultivation_bonus, public.store_performance FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.campaigns, public.campaign_schedules, public.campaign_store_details, public.campaign_store_headcount, public.campaign_store_own_staff, public.campaign_support_requests, public.campaign_support_staff, public.campaign_equipment_trips, public.campaign_checklist_items, public.campaign_checklist_completions, public.campaign_department_publish, public.event_dates, public.store_activity_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.pharmacist_profiles, public.pharmacist_annual_master, public.pharmacist_annual_fees, public.pharmacist_annual_master_locks, public.pharmacist_annual_master_sync_log, public.pharmacist_monthly_snapshot, public.pharmacist_monthly_snapshot_sync_log, public.pharmacist_snapshot_locks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.stockout_reports, public.stockout_product_responses, public.stockout_product_response_history TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.meal_allowance_records, public.spring_festival_bonus, public.support_staff_bonus, public.talent_cultivation_bonus, public.store_performance TO authenticated;

DROP POLICY IF EXISTS p1h_campaigns_read ON public.campaigns;
CREATE POLICY p1h_campaigns_read ON public.campaigns FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('activity.management.access')
  OR public.current_user_has_permission('activity.manage')
  OR public.current_user_has_permission('activity.campaign.view')
  OR public.current_user_has_permission('activity.campaign.view_all')
  OR public.current_user_has_permission('activity.campaign.edit')
);

DROP POLICY IF EXISTS p1h_campaigns_write ON public.campaigns;
CREATE POLICY p1h_campaigns_write ON public.campaigns TO authenticated
USING (public.current_user_has_permission('activity.manage') OR public.current_user_has_permission('activity.campaign.edit'))
WITH CHECK (public.current_user_has_permission('activity.manage') OR public.current_user_has_permission('activity.campaign.edit'));

DROP POLICY IF EXISTS p1h_campaign_store_scoped_read ON public.campaign_schedules;
CREATE POLICY p1h_campaign_store_scoped_read ON public.campaign_schedules FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('activity.campaign.view_all')
  OR public.current_user_has_permission('activity.campaign.edit')
  OR EXISTS (SELECT 1 FROM public.store_managers sm WHERE sm.user_id = auth.uid() AND sm.store_id = campaign_schedules.store_id)
);
DROP POLICY IF EXISTS p1h_campaign_schedules_write ON public.campaign_schedules;
CREATE POLICY p1h_campaign_schedules_write ON public.campaign_schedules TO authenticated
USING (public.current_user_has_permission('activity.manage') OR public.current_user_has_permission('activity.campaign.edit'))
WITH CHECK (public.current_user_has_permission('activity.manage') OR public.current_user_has_permission('activity.campaign.edit'));

DROP POLICY IF EXISTS p1h_campaign_store_details_read ON public.campaign_store_details;
CREATE POLICY p1h_campaign_store_details_read ON public.campaign_store_details FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('activity.campaign.view_all')
  OR public.current_user_has_permission('activity.store_detail.edit')
  OR EXISTS (SELECT 1 FROM public.store_managers sm WHERE sm.user_id = auth.uid() AND sm.store_id = campaign_store_details.store_id)
);
DROP POLICY IF EXISTS p1h_campaign_store_details_write ON public.campaign_store_details;
CREATE POLICY p1h_campaign_store_details_write ON public.campaign_store_details TO authenticated
USING (public.current_user_has_permission('activity.manage') OR public.current_user_has_permission('activity.store_detail.edit'))
WITH CHECK (public.current_user_has_permission('activity.manage') OR public.current_user_has_permission('activity.store_detail.edit'));

DROP POLICY IF EXISTS p1h_campaign_store_headcount_read ON public.campaign_store_headcount;
CREATE POLICY p1h_campaign_store_headcount_read ON public.campaign_store_headcount FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('activity.staff_overview.view')
  OR public.current_user_has_permission('activity.campaign.view_all')
  OR EXISTS (SELECT 1 FROM public.store_managers sm WHERE sm.user_id = auth.uid() AND sm.store_id = campaign_store_headcount.store_id)
);
DROP POLICY IF EXISTS p1h_campaign_store_headcount_write ON public.campaign_store_headcount;
CREATE POLICY p1h_campaign_store_headcount_write ON public.campaign_store_headcount TO authenticated
USING (public.current_user_has_permission('activity.manage') OR public.current_user_has_permission('activity.store_detail.edit'))
WITH CHECK (public.current_user_has_permission('activity.manage') OR public.current_user_has_permission('activity.store_detail.edit'));

DROP POLICY IF EXISTS p1h_campaign_store_own_staff_read ON public.campaign_store_own_staff;
CREATE POLICY p1h_campaign_store_own_staff_read ON public.campaign_store_own_staff FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('activity.staff_overview.view')
  OR public.current_user_has_permission('activity.campaign.view_all')
  OR EXISTS (SELECT 1 FROM public.store_managers sm WHERE sm.user_id = auth.uid() AND sm.store_id = campaign_store_own_staff.store_id)
);
DROP POLICY IF EXISTS p1h_campaign_store_own_staff_write ON public.campaign_store_own_staff;
CREATE POLICY p1h_campaign_store_own_staff_write ON public.campaign_store_own_staff TO authenticated
USING (public.current_user_has_permission('activity.manage') OR public.current_user_has_permission('activity.support_assign.edit'))
WITH CHECK (public.current_user_has_permission('activity.manage') OR public.current_user_has_permission('activity.support_assign.edit'));

DROP POLICY IF EXISTS p1h_campaign_support_requests_read ON public.campaign_support_requests;
CREATE POLICY p1h_campaign_support_requests_read ON public.campaign_support_requests FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('activity.support_request.edit')
  OR public.current_user_has_permission('activity.support_assign.edit')
  OR EXISTS (
    SELECT 1 FROM public.store_managers sm
    WHERE sm.user_id = auth.uid()
      AND sm.store_id IN (campaign_support_requests.requesting_store_id, campaign_support_requests.supporting_store_id)
  )
);
DROP POLICY IF EXISTS p1h_campaign_support_requests_write ON public.campaign_support_requests;
CREATE POLICY p1h_campaign_support_requests_write ON public.campaign_support_requests TO authenticated
USING (public.current_user_has_permission('activity.manage') OR public.current_user_has_permission('activity.support_request.edit'))
WITH CHECK (public.current_user_has_permission('activity.manage') OR public.current_user_has_permission('activity.support_request.edit'));

DROP POLICY IF EXISTS p1h_campaign_support_staff_read ON public.campaign_support_staff;
CREATE POLICY p1h_campaign_support_staff_read ON public.campaign_support_staff FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('activity.support_assign.edit')
  OR EXISTS (
    SELECT 1 FROM public.store_managers sm
    WHERE sm.user_id = auth.uid()
      AND sm.store_id IN (campaign_support_staff.requesting_store_id, campaign_support_staff.supporting_store_id)
  )
);
DROP POLICY IF EXISTS p1h_campaign_support_staff_write ON public.campaign_support_staff;
CREATE POLICY p1h_campaign_support_staff_write ON public.campaign_support_staff TO authenticated
USING (public.current_user_has_permission('activity.manage') OR public.current_user_has_permission('activity.support_assign.edit'))
WITH CHECK (public.current_user_has_permission('activity.manage') OR public.current_user_has_permission('activity.support_assign.edit'));

DROP POLICY IF EXISTS p1h_campaign_equipment_trips_read ON public.campaign_equipment_trips;
CREATE POLICY p1h_campaign_equipment_trips_read ON public.campaign_equipment_trips FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('activity.campaign.view_all')
  OR public.current_user_has_permission('activity.equipment_trip.edit')
);
DROP POLICY IF EXISTS p1h_campaign_equipment_trips_write ON public.campaign_equipment_trips;
CREATE POLICY p1h_campaign_equipment_trips_write ON public.campaign_equipment_trips TO authenticated
USING (public.current_user_has_permission('activity.manage') OR public.current_user_has_permission('activity.equipment_trip.edit'))
WITH CHECK (public.current_user_has_permission('activity.manage') OR public.current_user_has_permission('activity.equipment_trip.edit'));

DROP POLICY IF EXISTS p1h_campaign_checklist_items_read ON public.campaign_checklist_items;
CREATE POLICY p1h_campaign_checklist_items_read ON public.campaign_checklist_items FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('activity.campaign.view')
  OR public.current_user_has_permission('activity.campaign.view_all')
  OR public.current_user_has_permission('activity.checklist.edit')
);
DROP POLICY IF EXISTS p1h_campaign_checklist_items_write ON public.campaign_checklist_items;
CREATE POLICY p1h_campaign_checklist_items_write ON public.campaign_checklist_items TO authenticated
USING (public.current_user_has_permission('activity.manage') OR public.current_user_has_permission('activity.checklist.edit'))
WITH CHECK (public.current_user_has_permission('activity.manage') OR public.current_user_has_permission('activity.checklist.edit'));

DROP POLICY IF EXISTS p1h_campaign_checklist_completions_read ON public.campaign_checklist_completions;
CREATE POLICY p1h_campaign_checklist_completions_read ON public.campaign_checklist_completions FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('activity.checklist.edit')
  OR EXISTS (SELECT 1 FROM public.store_managers sm WHERE sm.user_id = auth.uid() AND sm.store_id = campaign_checklist_completions.store_id)
);
DROP POLICY IF EXISTS p1h_campaign_checklist_completions_write ON public.campaign_checklist_completions;
CREATE POLICY p1h_campaign_checklist_completions_write ON public.campaign_checklist_completions TO authenticated
USING (
  public.current_user_has_permission('activity.manage')
  OR public.current_user_has_permission('activity.checklist.edit')
  OR EXISTS (SELECT 1 FROM public.store_managers sm WHERE sm.user_id = auth.uid() AND sm.store_id = campaign_checklist_completions.store_id)
)
WITH CHECK (
  public.current_user_has_permission('activity.manage')
  OR public.current_user_has_permission('activity.checklist.edit')
  OR EXISTS (SELECT 1 FROM public.store_managers sm WHERE sm.user_id = auth.uid() AND sm.store_id = campaign_checklist_completions.store_id)
);

DROP POLICY IF EXISTS p1h_campaign_department_publish_read ON public.campaign_department_publish;
CREATE POLICY p1h_campaign_department_publish_read ON public.campaign_department_publish FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('activity.marketing.publish')
  OR public.current_user_has_permission('activity.merchandise.publish')
  OR public.current_user_has_permission('activity.campaign.view_all')
);
DROP POLICY IF EXISTS p1h_campaign_department_publish_write ON public.campaign_department_publish;
CREATE POLICY p1h_campaign_department_publish_write ON public.campaign_department_publish TO authenticated
USING (public.current_user_has_permission('activity.marketing.publish') OR public.current_user_has_permission('activity.merchandise.publish'))
WITH CHECK (public.current_user_has_permission('activity.marketing.publish') OR public.current_user_has_permission('activity.merchandise.publish'));

DROP POLICY IF EXISTS p1h_event_dates_read ON public.event_dates;
CREATE POLICY p1h_event_dates_read ON public.event_dates FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('activity.management.access')
  OR public.current_user_has_permission('activity.campaign.view')
  OR public.current_user_has_permission('activity.campaign.view_all')
);
DROP POLICY IF EXISTS p1h_event_dates_write ON public.event_dates;
CREATE POLICY p1h_event_dates_write ON public.event_dates TO authenticated
USING (public.current_user_has_permission('activity.manage'))
WITH CHECK (public.current_user_has_permission('activity.manage'));

DROP POLICY IF EXISTS p1h_store_activity_settings_read ON public.store_activity_settings;
CREATE POLICY p1h_store_activity_settings_read ON public.store_activity_settings FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('activity.management.access')
  OR public.current_user_has_permission('activity.campaign.view_all')
  OR EXISTS (SELECT 1 FROM public.store_managers sm WHERE sm.user_id = auth.uid() AND sm.store_id = store_activity_settings.store_id)
);
DROP POLICY IF EXISTS p1h_store_activity_settings_write ON public.store_activity_settings;
CREATE POLICY p1h_store_activity_settings_write ON public.store_activity_settings TO authenticated
USING (public.current_user_has_permission('activity.manage'))
WITH CHECK (public.current_user_has_permission('activity.manage'));

DROP POLICY IF EXISTS p1h_pharmacist_profiles_read ON public.pharmacist_profiles;
CREATE POLICY p1h_pharmacist_profiles_read ON public.pharmacist_profiles FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('pharmacist.management.view')
  OR public.current_user_has_permission('pharmacist.management.edit')
  OR public.current_user_has_permission('pharmacist.management.master.view')
  OR public.current_user_has_permission('pharmacist.management.master.edit')
);
DROP POLICY IF EXISTS p1h_pharmacist_profiles_write ON public.pharmacist_profiles;
CREATE POLICY p1h_pharmacist_profiles_write ON public.pharmacist_profiles TO authenticated
USING (public.current_user_has_permission('pharmacist.management.edit') OR public.current_user_has_permission('pharmacist.management.master.edit'))
WITH CHECK (public.current_user_has_permission('pharmacist.management.edit') OR public.current_user_has_permission('pharmacist.management.master.edit'));

DROP POLICY IF EXISTS p1h_pharmacist_annual_master_read ON public.pharmacist_annual_master;
CREATE POLICY p1h_pharmacist_annual_master_read ON public.pharmacist_annual_master FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('pharmacist.management.master.view')
  OR public.current_user_has_permission('pharmacist.management.master.edit')
  OR public.current_user_has_permission('pharmacist.management.view')
  OR public.current_user_has_permission('pharmacist.management.edit')
);
DROP POLICY IF EXISTS p1h_pharmacist_annual_master_write ON public.pharmacist_annual_master;
CREATE POLICY p1h_pharmacist_annual_master_write ON public.pharmacist_annual_master TO authenticated
USING (public.current_user_has_permission('pharmacist.management.master.edit'))
WITH CHECK (public.current_user_has_permission('pharmacist.management.master.edit'));

DROP POLICY IF EXISTS p1h_pharmacist_annual_fees_read ON public.pharmacist_annual_fees;
CREATE POLICY p1h_pharmacist_annual_fees_read ON public.pharmacist_annual_fees FOR SELECT TO authenticated
USING (public.current_user_has_permission('pharmacist.management.view') OR public.current_user_has_permission('pharmacist.management.edit'));
DROP POLICY IF EXISTS p1h_pharmacist_annual_fees_write ON public.pharmacist_annual_fees;
CREATE POLICY p1h_pharmacist_annual_fees_write ON public.pharmacist_annual_fees TO authenticated
USING (public.current_user_has_permission('pharmacist.management.edit'))
WITH CHECK (public.current_user_has_permission('pharmacist.management.edit'));

DROP POLICY IF EXISTS p1h_pharmacist_lock_read ON public.pharmacist_annual_master_locks;
CREATE POLICY p1h_pharmacist_lock_read ON public.pharmacist_annual_master_locks FOR SELECT TO authenticated
USING (public.current_user_has_permission('pharmacist.management.master.view') OR public.current_user_has_permission('pharmacist.management.master.edit'));
DROP POLICY IF EXISTS p1h_pharmacist_lock_write ON public.pharmacist_annual_master_locks;
CREATE POLICY p1h_pharmacist_lock_write ON public.pharmacist_annual_master_locks TO authenticated
USING (public.current_user_has_permission('pharmacist.management.master.edit'))
WITH CHECK (public.current_user_has_permission('pharmacist.management.master.edit'));

DROP POLICY IF EXISTS p1h_pharmacist_sync_log_read ON public.pharmacist_annual_master_sync_log;
CREATE POLICY p1h_pharmacist_sync_log_read ON public.pharmacist_annual_master_sync_log FOR SELECT TO authenticated
USING (public.current_user_has_permission('pharmacist.management.master.view') OR public.current_user_has_permission('pharmacist.management.master.edit'));
DROP POLICY IF EXISTS p1h_pharmacist_sync_log_write ON public.pharmacist_annual_master_sync_log;
CREATE POLICY p1h_pharmacist_sync_log_write ON public.pharmacist_annual_master_sync_log TO authenticated
USING (public.current_user_has_permission('pharmacist.management.master.edit'))
WITH CHECK (public.current_user_has_permission('pharmacist.management.master.edit'));

DROP POLICY IF EXISTS p1h_pharmacist_monthly_snapshot_read ON public.pharmacist_monthly_snapshot;
CREATE POLICY p1h_pharmacist_monthly_snapshot_read ON public.pharmacist_monthly_snapshot FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('pharmacist.management.view')
  OR public.current_user_has_permission('pharmacist.management.edit')
  OR EXISTS (SELECT 1 FROM public.store_managers sm WHERE sm.user_id = auth.uid() AND sm.store_id = pharmacist_monthly_snapshot.store_id)
);
DROP POLICY IF EXISTS p1h_pharmacist_monthly_snapshot_write ON public.pharmacist_monthly_snapshot;
CREATE POLICY p1h_pharmacist_monthly_snapshot_write ON public.pharmacist_monthly_snapshot TO authenticated
USING (public.current_user_has_permission('pharmacist.management.edit'))
WITH CHECK (public.current_user_has_permission('pharmacist.management.edit'));

DROP POLICY IF EXISTS p1h_pharmacist_monthly_sync_log_read ON public.pharmacist_monthly_snapshot_sync_log;
CREATE POLICY p1h_pharmacist_monthly_sync_log_read ON public.pharmacist_monthly_snapshot_sync_log FOR SELECT TO authenticated
USING (public.current_user_has_permission('pharmacist.management.view') OR public.current_user_has_permission('pharmacist.management.edit'));
DROP POLICY IF EXISTS p1h_pharmacist_monthly_sync_log_write ON public.pharmacist_monthly_snapshot_sync_log;
CREATE POLICY p1h_pharmacist_monthly_sync_log_write ON public.pharmacist_monthly_snapshot_sync_log TO authenticated
USING (public.current_user_has_permission('pharmacist.management.edit'))
WITH CHECK (public.current_user_has_permission('pharmacist.management.edit'));

DROP POLICY IF EXISTS p1h_pharmacist_snapshot_locks_read ON public.pharmacist_snapshot_locks;
CREATE POLICY p1h_pharmacist_snapshot_locks_read ON public.pharmacist_snapshot_locks FOR SELECT TO authenticated
USING (public.current_user_has_permission('pharmacist.management.view') OR public.current_user_has_permission('pharmacist.management.edit'));
DROP POLICY IF EXISTS p1h_pharmacist_snapshot_locks_write ON public.pharmacist_snapshot_locks;
CREATE POLICY p1h_pharmacist_snapshot_locks_write ON public.pharmacist_snapshot_locks TO authenticated
USING (public.current_user_has_permission('pharmacist.management.edit'))
WITH CHECK (public.current_user_has_permission('pharmacist.management.edit'));

DROP POLICY IF EXISTS p1h_stockout_reports_read ON public.stockout_reports;
CREATE POLICY p1h_stockout_reports_read ON public.stockout_reports FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('cross_dept.stockout.view_all')
  OR public.current_user_has_permission('cross_dept.stockout.respond')
  OR EXISTS (SELECT 1 FROM public.store_managers sm WHERE sm.user_id = auth.uid() AND sm.store_id = stockout_reports.store_id)
);
DROP POLICY IF EXISTS p1h_stockout_reports_write ON public.stockout_reports;
CREATE POLICY p1h_stockout_reports_write ON public.stockout_reports TO authenticated
USING (
  public.current_user_has_permission('cross_dept.stockout.submit')
  OR public.current_user_has_permission('cross_dept.stockout.respond')
)
WITH CHECK (
  public.current_user_has_permission('cross_dept.stockout.submit')
  OR public.current_user_has_permission('cross_dept.stockout.respond')
);

DROP POLICY IF EXISTS p1h_stockout_product_responses_read ON public.stockout_product_responses;
CREATE POLICY p1h_stockout_product_responses_read ON public.stockout_product_responses FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('cross_dept.stockout.view_all')
  OR public.current_user_has_permission('cross_dept.stockout.submit')
  OR public.current_user_has_permission('cross_dept.stockout.respond')
);
DROP POLICY IF EXISTS p1h_stockout_product_responses_write ON public.stockout_product_responses;
CREATE POLICY p1h_stockout_product_responses_write ON public.stockout_product_responses TO authenticated
USING (public.current_user_has_permission('cross_dept.stockout.respond'))
WITH CHECK (public.current_user_has_permission('cross_dept.stockout.respond'));

DROP POLICY IF EXISTS p1h_stockout_response_history_read ON public.stockout_product_response_history;
CREATE POLICY p1h_stockout_response_history_read ON public.stockout_product_response_history FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('cross_dept.stockout.view_all')
  OR public.current_user_has_permission('cross_dept.stockout.respond')
);
DROP POLICY IF EXISTS p1h_stockout_response_history_write ON public.stockout_product_response_history;
CREATE POLICY p1h_stockout_response_history_write ON public.stockout_product_response_history TO authenticated
USING (public.current_user_has_permission('cross_dept.stockout.respond'))
WITH CHECK (public.current_user_has_permission('cross_dept.stockout.respond'));

DROP POLICY IF EXISTS p1h_meal_allowance_read ON public.meal_allowance_records;
CREATE POLICY p1h_meal_allowance_read ON public.meal_allowance_records FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('monthly.allowance.view_support_hours')
  OR public.current_user_has_permission('monthly.allowance.edit_support_hours')
  OR EXISTS (SELECT 1 FROM public.store_managers sm WHERE sm.user_id = auth.uid() AND sm.store_id = meal_allowance_records.store_id)
);
DROP POLICY IF EXISTS p1h_meal_allowance_write ON public.meal_allowance_records;
CREATE POLICY p1h_meal_allowance_write ON public.meal_allowance_records TO authenticated
USING (public.current_user_has_permission('monthly.allowance.edit_support_hours'))
WITH CHECK (public.current_user_has_permission('monthly.allowance.edit_support_hours'));

DROP POLICY IF EXISTS p1h_spring_festival_bonus_read ON public.spring_festival_bonus;
CREATE POLICY p1h_spring_festival_bonus_read ON public.spring_festival_bonus FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('performance.bonus.view')
  OR public.current_user_has_permission('performance.bonus.import')
  OR EXISTS (SELECT 1 FROM public.store_managers sm WHERE sm.user_id = auth.uid() AND sm.store_id = spring_festival_bonus.store_id)
);
DROP POLICY IF EXISTS p1h_spring_festival_bonus_write ON public.spring_festival_bonus;
CREATE POLICY p1h_spring_festival_bonus_write ON public.spring_festival_bonus TO authenticated
USING (public.current_user_has_permission('performance.bonus.import'))
WITH CHECK (public.current_user_has_permission('performance.bonus.import'));

DROP POLICY IF EXISTS p1h_support_staff_bonus_read ON public.support_staff_bonus;
CREATE POLICY p1h_support_staff_bonus_read ON public.support_staff_bonus FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('performance.bonus.view')
  OR public.current_user_has_permission('performance.bonus.import')
  OR EXISTS (SELECT 1 FROM public.store_managers sm WHERE sm.user_id = auth.uid() AND sm.store_id = support_staff_bonus.store_id)
);
DROP POLICY IF EXISTS p1h_support_staff_bonus_write ON public.support_staff_bonus;
CREATE POLICY p1h_support_staff_bonus_write ON public.support_staff_bonus TO authenticated
USING (public.current_user_has_permission('performance.bonus.import'))
WITH CHECK (public.current_user_has_permission('performance.bonus.import'));

DROP POLICY IF EXISTS p1h_talent_cultivation_bonus_read ON public.talent_cultivation_bonus;
CREATE POLICY p1h_talent_cultivation_bonus_read ON public.talent_cultivation_bonus FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('performance.bonus.view')
  OR public.current_user_has_permission('performance.bonus.import')
  OR EXISTS (SELECT 1 FROM public.store_managers sm WHERE sm.user_id = auth.uid() AND sm.store_id = talent_cultivation_bonus.store_id)
);
DROP POLICY IF EXISTS p1h_talent_cultivation_bonus_write ON public.talent_cultivation_bonus;
CREATE POLICY p1h_talent_cultivation_bonus_write ON public.talent_cultivation_bonus TO authenticated
USING (public.current_user_has_permission('performance.bonus.import'))
WITH CHECK (public.current_user_has_permission('performance.bonus.import'));

DROP POLICY IF EXISTS p1h_store_performance_read ON public.store_performance;
CREATE POLICY p1h_store_performance_read ON public.store_performance FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('performance.view')
  OR public.current_user_has_permission('performance.edit')
  OR EXISTS (SELECT 1 FROM public.store_managers sm WHERE sm.user_id = auth.uid() AND sm.store_id = store_performance.store_id)
);
DROP POLICY IF EXISTS p1h_store_performance_write ON public.store_performance;
CREATE POLICY p1h_store_performance_write ON public.store_performance TO authenticated
USING (public.current_user_has_permission('performance.edit'))
WITH CHECK (public.current_user_has_permission('performance.edit'));
