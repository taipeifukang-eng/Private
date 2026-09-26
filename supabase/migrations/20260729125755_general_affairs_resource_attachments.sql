-- ============================================================
-- General Affairs Resource Attachments Foundation
-- Scope:
--   - Shared attachment table for equipment, facilities and maintenance resources.
--   - Private Supabase Storage bucket for server-side managed files.
--   - RLS helpers and soft-delete RPC.
-- Not in scope:
--   - Existing maintenance_photos / maintenance_update_photos migration rewrite.
--   - Direct client access to storage.objects.
--   - Hard delete policy.
-- ============================================================

DO $$
BEGIN
  IF to_regclass('public.ga_equipment') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite: public.ga_equipment';
  END IF;

  IF to_regclass('public.ga_facilities') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite: public.ga_facilities';
  END IF;

  IF to_regclass('public.maintenance_requests') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite: public.maintenance_requests';
  END IF;

  IF to_regclass('public.maintenance_updates') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite: public.maintenance_updates';
  END IF;

  IF to_regclass('public.store_managers') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite: public.store_managers';
  END IF;

  IF to_regprocedure('public.current_user_has_permission(character varying)') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite: public.current_user_has_permission(varchar)';
  END IF;
END $$;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'general-affairs-attachments',
  'general-affairs-attachments',
  false,
  20971520,
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
    'application/pdf'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE TABLE IF NOT EXISTS public.ga_resource_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_type TEXT NOT NULL,
  resource_id UUID NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'GENERAL',
  storage_bucket TEXT NOT NULL DEFAULT 'general-affairs-attachments',
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  uploaded_by UUID NOT NULL REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID NULL REFERENCES auth.users(id),
  deleted_at TIMESTAMPTZ NULL,
  deleted_by UUID NULL REFERENCES auth.users(id),
  deletion_reason TEXT NULL,
  CONSTRAINT ga_resource_attachments_resource_type_check
    CHECK (resource_type IN ('EQUIPMENT', 'FACILITY', 'MAINTENANCE_REQUEST', 'MAINTENANCE_UPDATE')),
  CONSTRAINT ga_resource_attachments_purpose_check
    CHECK (purpose = btrim(purpose) AND purpose <> '' AND purpose = upper(purpose)),
  CONSTRAINT ga_resource_attachments_bucket_check
    CHECK (storage_bucket = 'general-affairs-attachments'),
  CONSTRAINT ga_resource_attachments_storage_path_safe
    CHECK (
      storage_path = btrim(storage_path)
      AND storage_path <> ''
      AND storage_path !~* '^[a-z][a-z0-9+.-]*:'
      AND storage_path !~ E'\\\\'
      AND storage_path !~ '(^|/)\.\.(/|$)'
      AND storage_path !~ '^/'
    ),
  CONSTRAINT ga_resource_attachments_storage_path_scoped
    CHECK (storage_path LIKE lower(resource_type) || '/%'),
  CONSTRAINT ga_resource_attachments_file_name_check
    CHECK (file_name = btrim(file_name) AND file_name <> ''),
  CONSTRAINT ga_resource_attachments_content_type_check
    CHECK (
      content_type IN (
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/heic',
        'image/heif',
        'application/pdf'
      )
    ),
  CONSTRAINT ga_resource_attachments_size_check
    CHECK (size_bytes > 0 AND size_bytes <= 20971520),
  CONSTRAINT ga_resource_attachments_metadata_object
    CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT ga_resource_attachments_deleted_fields_pair
    CHECK (
      (deleted_at IS NULL AND deleted_by IS NULL AND deletion_reason IS NULL)
      OR (deleted_at IS NOT NULL AND deleted_by IS NOT NULL AND deletion_reason IS NOT NULL AND btrim(deletion_reason) <> '')
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ga_resource_attachments_storage_path_active
ON public.ga_resource_attachments (storage_bucket, storage_path)
WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ga_resource_attachments_primary_active
ON public.ga_resource_attachments (resource_type, resource_id, purpose)
WHERE deleted_at IS NULL AND is_primary;

CREATE INDEX IF NOT EXISTS idx_ga_resource_attachments_resource
ON public.ga_resource_attachments (resource_type, resource_id)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ga_resource_attachments_uploaded_at
ON public.ga_resource_attachments (uploaded_at DESC)
WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.ga_resource_attachment_can_read(
  p_resource_type TEXT,
  p_resource_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_resource_type = 'EQUIPMENT' THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.ga_equipment e
      WHERE e.id = p_resource_id
        AND e.deleted_at IS NULL
        AND (
          public.current_user_has_permission('general_affairs.equipment.view')
          OR public.current_user_has_permission('general_affairs.equipment.manage')
          OR EXISTS (
            SELECT 1 FROM public.store_managers sm
            WHERE sm.store_id = e.store_id
              AND sm.user_id = auth.uid()
          )
        )
    );
  END IF;

  IF p_resource_type = 'FACILITY' THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.ga_facilities f
      WHERE f.id = p_resource_id
        AND f.deleted_at IS NULL
        AND (
          public.current_user_has_permission('general_affairs.facility.view')
          OR public.current_user_has_permission('general_affairs.facility.manage')
          OR EXISTS (
            SELECT 1 FROM public.store_managers sm
            WHERE sm.store_id = f.store_id
              AND sm.user_id = auth.uid()
          )
        )
    );
  END IF;

  IF p_resource_type = 'MAINTENANCE_REQUEST' THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.maintenance_requests mr
      WHERE mr.id = p_resource_id
        AND (
          public.current_user_has_permission('general_affairs.maintenance_request.view_all')
          OR public.current_user_has_permission('general_affairs.maintenance_request.update')
          OR public.current_user_has_permission('general_affairs.work_order.view_all')
          OR public.current_user_has_permission('general_affairs.work_order.update')
          OR public.current_user_has_permission('general_affairs.work_order.manage')
          OR public.current_user_has_permission('cross_dept.maintenance.view_all')
          OR public.current_user_has_permission('cross_dept.maintenance.update')
          OR mr.reported_by = auth.uid()
          OR EXISTS (
            SELECT 1
            FROM public.store_managers sm
            WHERE sm.store_id = mr.store_id
              AND sm.user_id = auth.uid()
              AND (
                public.current_user_has_permission('general_affairs.maintenance_request.create')
                OR public.current_user_has_permission('general_affairs.maintenance_request.view_own_store')
                OR public.current_user_has_permission('general_affairs.work_order.view_own_store')
                OR public.current_user_has_permission('cross_dept.maintenance.submit')
              )
          )
        )
    );
  END IF;

  IF p_resource_type = 'MAINTENANCE_UPDATE' THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.maintenance_updates mu
      WHERE mu.id = p_resource_id
        AND (
          COALESCE(mu.visibility, 'PUBLIC') = 'PUBLIC'
          OR public.current_user_has_permission('general_affairs.maintenance_request.view_all')
          OR public.current_user_has_permission('general_affairs.maintenance_request.update')
          OR public.current_user_has_permission('general_affairs.work_order.view_all')
          OR public.current_user_has_permission('general_affairs.work_order.update')
          OR public.current_user_has_permission('general_affairs.work_order.manage')
          OR public.current_user_has_permission('cross_dept.maintenance.view_all')
          OR public.current_user_has_permission('cross_dept.maintenance.update')
        )
    );
  END IF;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.ga_resource_attachment_can_manage(
  p_resource_type TEXT,
  p_resource_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_resource_type = 'EQUIPMENT' THEN
    RETURN public.current_user_has_permission('general_affairs.equipment.manage')
      AND EXISTS (
        SELECT 1 FROM public.ga_equipment e
        WHERE e.id = p_resource_id
          AND e.deleted_at IS NULL
      );
  END IF;

  IF p_resource_type = 'FACILITY' THEN
    RETURN public.current_user_has_permission('general_affairs.facility.manage')
      AND EXISTS (
        SELECT 1 FROM public.ga_facilities f
        WHERE f.id = p_resource_id
          AND f.deleted_at IS NULL
      );
  END IF;

  IF p_resource_type = 'MAINTENANCE_REQUEST' THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.maintenance_requests mr
      WHERE mr.id = p_resource_id
        AND (
          public.current_user_has_permission('general_affairs.maintenance_request.update')
          OR public.current_user_has_permission('general_affairs.work_order.update')
          OR public.current_user_has_permission('general_affairs.work_order.manage')
          OR public.current_user_has_permission('cross_dept.maintenance.update')
          OR mr.reported_by = auth.uid()
          OR (
            (
              public.current_user_has_permission('general_affairs.maintenance_request.create')
              OR public.current_user_has_permission('cross_dept.maintenance.submit')
            )
            AND EXISTS (
              SELECT 1
              FROM public.store_managers sm
              WHERE sm.store_id = mr.store_id
                AND sm.user_id = auth.uid()
            )
          )
        )
    );
  END IF;

  IF p_resource_type = 'MAINTENANCE_UPDATE' THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.maintenance_updates mu
      WHERE mu.id = p_resource_id
        AND (
          public.current_user_has_permission('general_affairs.maintenance_request.update')
          OR public.current_user_has_permission('general_affairs.work_order.update')
          OR public.current_user_has_permission('general_affairs.work_order.manage')
          OR public.current_user_has_permission('cross_dept.maintenance.update')
          OR mu.updated_by = auth.uid()
        )
    );
  END IF;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.ga_validate_resource_attachment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_soft_delete_allowed BOOLEAN := COALESCE(current_setting('app.ga_resource_attachment_soft_delete', true), '') = 'on';
BEGIN
  NEW.resource_type := upper(btrim(NEW.resource_type));
  NEW.purpose := upper(btrim(NEW.purpose));
  NEW.storage_bucket := btrim(NEW.storage_bucket);
  NEW.storage_path := btrim(NEW.storage_path);
  NEW.file_name := btrim(NEW.file_name);
  NEW.content_type := lower(btrim(NEW.content_type));
  NEW.metadata := COALESCE(NEW.metadata, '{}'::jsonb);

  IF TG_OP = 'INSERT' THEN
    NEW.uploaded_at := now();
    NEW.uploaded_by := auth.uid();
    NEW.updated_at := now();
    NEW.updated_by := auth.uid();
    NEW.deleted_at := NULL;
    NEW.deleted_by := NULL;
    NEW.deletion_reason := NULL;
  ELSE
    IF NOT v_soft_delete_allowed AND (
      NEW.uploaded_at IS DISTINCT FROM OLD.uploaded_at
      OR NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by
      OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
      OR NEW.deleted_by IS DISTINCT FROM OLD.deleted_by
      OR NEW.deletion_reason IS DISTINCT FROM OLD.deletion_reason
    ) THEN
      RAISE EXCEPTION 'RESOURCE_ATTACHMENT_SYSTEM_FIELDS_IMMUTABLE: 附件系統欄位不可由 Client 修改';
    END IF;

    NEW.resource_type := OLD.resource_type;
    NEW.resource_id := OLD.resource_id;
    NEW.storage_bucket := OLD.storage_bucket;
    NEW.storage_path := OLD.storage_path;
    NEW.uploaded_at := OLD.uploaded_at;
    NEW.uploaded_by := OLD.uploaded_by;
    NEW.updated_at := now();
    NEW.updated_by := auth.uid();
  END IF;

  IF NOT public.ga_resource_attachment_can_manage(NEW.resource_type, NEW.resource_id) THEN
    RAISE EXCEPTION 'RESOURCE_ATTACHMENT_PERMISSION_DENIED: 沒有附件管理權限';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ga_resource_attachments_validate ON public.ga_resource_attachments;
CREATE TRIGGER trg_ga_resource_attachments_validate
BEFORE INSERT OR UPDATE ON public.ga_resource_attachments
FOR EACH ROW EXECUTE FUNCTION public.ga_validate_resource_attachment();

CREATE OR REPLACE FUNCTION public.ga_soft_delete_resource_attachment(
  p_attachment_id UUID,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.ga_resource_attachments%ROWTYPE;
  v_reason TEXT := btrim(COALESCE(p_reason, ''));
BEGIN
  IF v_reason = '' THEN
    RAISE EXCEPTION 'RESOURCE_ATTACHMENT_DELETE_REASON_REQUIRED: 請輸入刪除原因';
  END IF;

  SELECT *
  INTO v_row
  FROM public.ga_resource_attachments
  WHERE id = p_attachment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RESOURCE_ATTACHMENT_NOT_FOUND: 附件不存在';
  END IF;

  IF v_row.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'RESOURCE_ATTACHMENT_ALREADY_DELETED: 此附件已被刪除';
  END IF;

  IF NOT public.ga_resource_attachment_can_manage(v_row.resource_type, v_row.resource_id) THEN
    RAISE EXCEPTION 'RESOURCE_ATTACHMENT_PERMISSION_DENIED: 沒有附件管理權限';
  END IF;

  PERFORM set_config('app.ga_resource_attachment_soft_delete', 'on', true);

  UPDATE public.ga_resource_attachments
  SET
    deleted_at = now(),
    deleted_by = auth.uid(),
    deletion_reason = v_reason,
    updated_at = now(),
    updated_by = auth.uid()
  WHERE id = p_attachment_id;

  RETURN jsonb_build_object(
    'ok', true,
    'id', p_attachment_id,
    'storage_bucket', v_row.storage_bucket,
    'storage_path', v_row.storage_path
  );
END;
$$;

ALTER TABLE public.ga_resource_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ga_resource_attachments_read ON public.ga_resource_attachments;
CREATE POLICY ga_resource_attachments_read ON public.ga_resource_attachments
FOR SELECT TO authenticated
USING (
  deleted_at IS NULL
  AND public.ga_resource_attachment_can_read(resource_type, resource_id)
);

DROP POLICY IF EXISTS ga_resource_attachments_insert ON public.ga_resource_attachments;
CREATE POLICY ga_resource_attachments_insert ON public.ga_resource_attachments
FOR INSERT TO authenticated
WITH CHECK (
  deleted_at IS NULL
  AND uploaded_by = auth.uid()
  AND public.ga_resource_attachment_can_manage(resource_type, resource_id)
);

REVOKE ALL ON TABLE public.ga_resource_attachments FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.ga_resource_attachments TO authenticated;
GRANT ALL ON TABLE public.ga_resource_attachments TO service_role;

REVOKE ALL ON FUNCTION public.ga_resource_attachment_can_read(TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_resource_attachment_can_manage(TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_validate_resource_attachment() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_soft_delete_resource_attachment(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ga_soft_delete_resource_attachment(UUID, TEXT) TO authenticated;

DROP POLICY IF EXISTS ga_resource_attachments_storage_service_role_all ON storage.objects;
CREATE POLICY ga_resource_attachments_storage_service_role_all
ON storage.objects
FOR ALL TO service_role
USING (bucket_id = 'general-affairs-attachments')
WITH CHECK (bucket_id = 'general-affairs-attachments');
