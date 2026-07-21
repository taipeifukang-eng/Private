-- ============================================================
-- DEV Baseline 005 - store_managers
-- Use only on a brand-new DEV Supabase project.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.store_managers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role_type VARCHAR(20) NOT NULL CHECK (role_type IN ('store_manager', 'supervisor', 'area_manager')),
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(store_id, user_id, role_type)
);

CREATE INDEX IF NOT EXISTS idx_store_managers_user_id ON public.store_managers(user_id);
CREATE INDEX IF NOT EXISTS idx_store_managers_store_id ON public.store_managers(store_id);
CREATE INDEX IF NOT EXISTS idx_store_managers_role_type ON public.store_managers(role_type);

ALTER TABLE public.store_managers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dev_store_managers_select_self" ON public.store_managers;
CREATE POLICY "dev_store_managers_select_self" ON public.store_managers
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "dev_stores_select_managed" ON public.stores;
CREATE POLICY "dev_stores_select_managed" ON public.stores
  FOR SELECT TO authenticated
  USING (
    is_active = true
    AND EXISTS (
      SELECT 1
      FROM public.store_managers sm
      WHERE sm.store_id = stores.id
        AND sm.user_id = auth.uid()
    )
  );

-- No direct authenticated INSERT/UPDATE/DELETE policies in DEV baseline.
