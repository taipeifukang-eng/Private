INSERT INTO public.permissions (module, feature, code, action, description) VALUES
  ('general_affairs', 'utility_bill', 'general_affairs.utility_bill.view', 'view', '查看總務水費、電話費與網路費紀錄'),
  ('general_affairs', 'utility_bill', 'general_affairs.utility_bill.manage', 'manage', '新增與管理總務水費、電話費與網路費紀錄')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description, is_active = true;

CREATE TABLE IF NOT EXISTS public.ga_utility_bills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID REFERENCES public.stores(id) ON DELETE RESTRICT,
  location_name TEXT NOT NULL,
  expense_type TEXT NOT NULL CHECK (expense_type IN ('WATER', 'ELECTRICITY', 'PHONE', 'INTERNET')),
  billing_month DATE NOT NULL CHECK (billing_month = date_trunc('month', billing_month)::date),
  provider_name TEXT,
  service_label TEXT,
  service_identifier TEXT,
  account_number TEXT,
  equipment_serial TEXT,
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  electricity_kwh NUMERIC(12,2),
  due_date DATE,
  paid_at DATE,
  reference_no TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT ga_utility_bills_electricity_kwh_check CHECK (
    electricity_kwh IS NULL
    OR (expense_type = 'ELECTRICITY' AND electricity_kwh >= 0)
  )
);

CREATE INDEX IF NOT EXISTS idx_ga_utility_bills_month_type
ON public.ga_utility_bills(billing_month DESC, expense_type) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ga_utility_bills_store_month
ON public.ga_utility_bills(store_id, billing_month DESC) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_ga_utility_bills_identity
ON public.ga_utility_bills(
  COALESCE(store_id::text, ''), lower(btrim(location_name)), expense_type, billing_month,
  lower(btrim(COALESCE(provider_name, ''))),
  lower(btrim(COALESCE(service_identifier, equipment_serial, account_number, '')))
) WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.ga_utility_bill_before_write()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED: 請先登入'; END IF;
  IF NOT public.current_user_has_permission('general_affairs.utility_bill.manage') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: 沒有費用紀錄管理權限';
  END IF;
  NEW.location_name := btrim(NEW.location_name);
  IF NEW.location_name = '' THEN RAISE EXCEPTION 'VALIDATION_ERROR: 請輸入據點'; END IF;
  NEW.provider_name := public.ga_normalize_optional_text(NEW.provider_name);
  NEW.service_label := public.ga_normalize_optional_text(NEW.service_label);
  NEW.service_identifier := public.ga_normalize_optional_text(NEW.service_identifier);
  NEW.account_number := public.ga_normalize_optional_text(NEW.account_number);
  NEW.equipment_serial := public.ga_normalize_optional_text(NEW.equipment_serial);
  NEW.reference_no := public.ga_normalize_optional_text(NEW.reference_no);
  NEW.notes := public.ga_normalize_optional_text(NEW.notes);
  NEW.updated_at := NOW();
  NEW.updated_by := auth.uid();
  IF TG_OP = 'INSERT' THEN NEW.created_by := auth.uid(); END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ga_utility_bills_before_write ON public.ga_utility_bills;
CREATE TRIGGER trg_ga_utility_bills_before_write
BEFORE INSERT OR UPDATE ON public.ga_utility_bills
FOR EACH ROW EXECUTE FUNCTION public.ga_utility_bill_before_write();

REVOKE ALL ON TABLE public.ga_utility_bills FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.ga_utility_bills TO authenticated;
GRANT ALL ON TABLE public.ga_utility_bills TO service_role;
ALTER TABLE public.ga_utility_bills ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ga_utility_bills_read ON public.ga_utility_bills;
CREATE POLICY ga_utility_bills_read ON public.ga_utility_bills FOR SELECT TO authenticated
USING (
  deleted_at IS NULL AND (
    public.current_user_has_permission('general_affairs.utility_bill.view')
    OR public.current_user_has_permission('general_affairs.utility_bill.manage')
    OR (store_id IS NOT NULL AND public.current_user_manages_store(store_id))
  )
);
DROP POLICY IF EXISTS ga_utility_bills_insert ON public.ga_utility_bills;
CREATE POLICY ga_utility_bills_insert ON public.ga_utility_bills FOR INSERT TO authenticated
WITH CHECK (public.current_user_has_permission('general_affairs.utility_bill.manage'));
DROP POLICY IF EXISTS ga_utility_bills_update ON public.ga_utility_bills;
CREATE POLICY ga_utility_bills_update ON public.ga_utility_bills FOR UPDATE TO authenticated
USING (public.current_user_has_permission('general_affairs.utility_bill.manage'))
WITH CHECK (public.current_user_has_permission('general_affairs.utility_bill.manage'));

NOTIFY pgrst, 'reload schema';
