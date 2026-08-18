-- Relationship members: support rejection with required reason.
-- Forward migration only. Do not edit previously applied migrations.

ALTER TABLE public.relationship_members
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

ALTER TABLE public.relationship_members
  DROP CONSTRAINT IF EXISTS relationship_members_rejection_reason_not_blank;

ALTER TABLE public.relationship_members
  ADD CONSTRAINT relationship_members_rejection_reason_not_blank
  CHECK (
    rejected_at IS NULL
    OR btrim(coalesce(rejection_reason, '')) <> ''
  );

CREATE INDEX IF NOT EXISTS idx_relationship_members_rejected_at
  ON public.relationship_members(rejected_at);
