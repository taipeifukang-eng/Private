BEGIN;

ALTER TABLE public.inspection_masters
  ADD COLUMN IF NOT EXISTS inspection_no TEXT,
  ADD COLUMN IF NOT EXISTS client_request_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS ux_inspection_masters_client_request_id
  ON public.inspection_masters(client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_inspection_masters_inspection_no
  ON public.inspection_masters(inspection_no)
  WHERE inspection_no IS NOT NULL;

COMMENT ON COLUMN public.inspection_masters.inspection_no IS '巡店流水單號，用於列表與人工查詢識別';
COMMENT ON COLUMN public.inspection_masters.client_request_id IS '巡店表單提交唯一識別，用於避免同一張表單重複新增';

NOTIFY pgrst, 'reload schema';

COMMIT;
