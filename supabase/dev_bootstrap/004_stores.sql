-- ============================================================
-- DEV Baseline 004 - stores
-- Use only on a brand-new DEV Supabase project.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_code VARCHAR(20) UNIQUE NOT NULL,
  store_name VARCHAR(100) NOT NULL,
  address TEXT,
  phone VARCHAR(20),
  is_active BOOLEAN NOT NULL DEFAULT true,
  short_name TEXT,
  hr_store_code TEXT,
  manager_name TEXT,
  is_franchise BOOLEAN NOT NULL DEFAULT false,
  source_store_id UUID REFERENCES public.stores(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stores_active_code ON public.stores(is_active, store_code);
CREATE INDEX IF NOT EXISTS idx_stores_hr_store_code
  ON public.stores(hr_store_code) WHERE hr_store_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stores_manager_name ON public.stores(manager_name);
CREATE INDEX IF NOT EXISTS idx_stores_is_franchise ON public.stores(is_franchise);
CREATE INDEX IF NOT EXISTS idx_stores_source_store_id ON public.stores(source_store_id);

DROP TRIGGER IF EXISTS trg_stores_updated_at ON public.stores;
CREATE TRIGGER trg_stores_updated_at
  BEFORE UPDATE ON public.stores
  FOR EACH ROW EXECUTE FUNCTION public.dev_bootstrap_touch_updated_at();

ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dev_stores_select_ga_access" ON public.stores;
CREATE POLICY "dev_stores_select_ga_access" ON public.stores
  FOR SELECT TO authenticated
  USING (
    is_active = true
    AND public.has_permission(auth.uid(), 'general_affairs.service_center.access')
  );

-- No direct authenticated INSERT/UPDATE/DELETE policies in DEV baseline.
