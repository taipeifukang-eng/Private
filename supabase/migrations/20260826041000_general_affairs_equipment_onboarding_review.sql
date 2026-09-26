ALTER TABLE public.ga_equipment
  ADD COLUMN IF NOT EXISTS onboarding_review_note TEXT,
  ADD COLUMN IF NOT EXISTS onboarding_reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS onboarding_reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.ga_equipment.onboarding_review_note
IS '設備建檔 / 貼標複核說明。可記錄總務完成確認或退回門市重拍原因。';

COMMENT ON COLUMN public.ga_equipment.onboarding_reviewed_at
IS '設備建檔 / 貼標最近一次總務複核時間。';

COMMENT ON COLUMN public.ga_equipment.onboarding_reviewed_by
IS '設備建檔 / 貼標最近一次總務複核人員。';

NOTIFY pgrst, 'reload schema';
