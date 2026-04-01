-- assignment 資料層清理（v2）
-- 目標：清理「同模板 + 同部門 + 同建立者 + 同協作者/section 組合」的重複未封存 assignment。
-- 策略：保留最新一筆，其餘做封存（archived=true），不做硬刪除。
-- 注意：建議以 service_role 在 Supabase SQL Editor 執行。

-- =====================================================
-- Step 1) 先盤點重複群組（不修改資料）
-- =====================================================
WITH collaborator_signature AS (
  SELECT
    a.id AS assignment_id,
    COALESCE(
      string_agg(
        ac.user_id::text || ':' || COALESCE(ac.section_id, ''),
        '|' ORDER BY ac.user_id::text, COALESCE(ac.section_id, '')
      ),
      '__NO_COLLABORATOR__'
    ) AS collaborator_signature
  FROM assignments a
  LEFT JOIN assignment_collaborators ac ON ac.assignment_id = a.id
  GROUP BY a.id
), dedupe_scope AS (
  SELECT
    a.id,
    a.template_id,
    COALESCE(a.department, '') AS department_key,
    COALESCE(a.created_by::text, '') AS created_by_key,
    cs.collaborator_signature,
    a.created_at,
    ROW_NUMBER() OVER (
      PARTITION BY
        a.template_id,
        COALESCE(a.department, ''),
        COALESCE(a.created_by::text, ''),
        cs.collaborator_signature
      ORDER BY a.created_at DESC, a.id DESC
    ) AS rn
  FROM assignments a
  JOIN collaborator_signature cs ON cs.assignment_id = a.id
  WHERE a.archived = false
)
SELECT
  ds.template_id,
  ds.department_key,
  ds.created_by_key,
  ds.collaborator_signature,
  COUNT(*) AS active_count,
  MIN(ds.created_at) AS oldest_created_at,
  MAX(ds.created_at) AS newest_created_at
FROM dedupe_scope ds
GROUP BY ds.template_id, ds.department_key, ds.created_by_key, ds.collaborator_signature
HAVING COUNT(*) > 1
ORDER BY active_count DESC, newest_created_at DESC;

-- =====================================================
-- Step 2) 建立備份表（只建一次）
-- =====================================================
CREATE TABLE IF NOT EXISTS assignment_cleanup_backup_20260401 (
  assignment_id UUID PRIMARY KEY,
  dedupe_key TEXT NOT NULL,
  keeper_assignment_id UUID NOT NULL,
  archived_assignment_created_at TIMESTAMPTZ,
  backup_created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assignment_snapshot JSONB NOT NULL,
  collaborators_snapshot JSONB NOT NULL
);

-- =====================================================
-- Step 3) 備份將被封存的重複 assignment 快照
-- =====================================================
WITH collaborator_signature AS (
  SELECT
    a.id AS assignment_id,
    COALESCE(
      string_agg(
        ac.user_id::text || ':' || COALESCE(ac.section_id, ''),
        '|' ORDER BY ac.user_id::text, COALESCE(ac.section_id, '')
      ),
      '__NO_COLLABORATOR__'
    ) AS collaborator_signature
  FROM assignments a
  LEFT JOIN assignment_collaborators ac ON ac.assignment_id = a.id
  GROUP BY a.id
), ranked AS (
  SELECT
    a.id AS assignment_id,
    a.created_at,
    CONCAT_WS(
      '::',
      COALESCE(a.template_id::text, ''),
      COALESCE(a.department, ''),
      COALESCE(a.created_by::text, ''),
      cs.collaborator_signature
    ) AS dedupe_key,
    FIRST_VALUE(a.id) OVER (
      PARTITION BY
        a.template_id,
        COALESCE(a.department, ''),
        COALESCE(a.created_by::text, ''),
        cs.collaborator_signature
      ORDER BY a.created_at DESC, a.id DESC
    ) AS keeper_assignment_id,
    ROW_NUMBER() OVER (
      PARTITION BY
        a.template_id,
        COALESCE(a.department, ''),
        COALESCE(a.created_by::text, ''),
        cs.collaborator_signature
      ORDER BY a.created_at DESC, a.id DESC
    ) AS rn
  FROM assignments a
  JOIN collaborator_signature cs ON cs.assignment_id = a.id
  WHERE a.archived = false
), candidates AS (
  SELECT *
  FROM ranked
  WHERE rn > 1
)
INSERT INTO assignment_cleanup_backup_20260401 (
  assignment_id,
  dedupe_key,
  keeper_assignment_id,
  archived_assignment_created_at,
  assignment_snapshot,
  collaborators_snapshot
)
SELECT
  c.assignment_id,
  c.dedupe_key,
  c.keeper_assignment_id,
  c.created_at,
  to_jsonb(a) AS assignment_snapshot,
  COALESCE((
    SELECT jsonb_agg(to_jsonb(ac) ORDER BY ac.created_at, ac.id)
    FROM assignment_collaborators ac
    WHERE ac.assignment_id = a.id
  ), '[]'::jsonb) AS collaborators_snapshot
FROM candidates c
JOIN assignments a ON a.id = c.assignment_id
ON CONFLICT (assignment_id) DO NOTHING;

-- =====================================================
-- Step 4) 執行清理：封存重複 assignment（保留最新一筆）
-- =====================================================
WITH collaborator_signature AS (
  SELECT
    a.id AS assignment_id,
    COALESCE(
      string_agg(
        ac.user_id::text || ':' || COALESCE(ac.section_id, ''),
        '|' ORDER BY ac.user_id::text, COALESCE(ac.section_id, '')
      ),
      '__NO_COLLABORATOR__'
    ) AS collaborator_signature
  FROM assignments a
  LEFT JOIN assignment_collaborators ac ON ac.assignment_id = a.id
  GROUP BY a.id
), ranked AS (
  SELECT
    a.id AS assignment_id,
    ROW_NUMBER() OVER (
      PARTITION BY
        a.template_id,
        COALESCE(a.department, ''),
        COALESCE(a.created_by::text, ''),
        cs.collaborator_signature
      ORDER BY a.created_at DESC, a.id DESC
    ) AS rn
  FROM assignments a
  JOIN collaborator_signature cs ON cs.assignment_id = a.id
  WHERE a.archived = false
)
UPDATE assignments a
SET
  archived = true,
  archived_at = COALESCE(a.archived_at, NOW())
FROM ranked r
WHERE a.id = r.assignment_id
  AND r.rn > 1
  AND a.archived = false;

-- =====================================================
-- Step 5) 驗證：確認每組活躍 assignment 僅剩一筆
-- =====================================================
WITH collaborator_signature AS (
  SELECT
    a.id AS assignment_id,
    COALESCE(
      string_agg(
        ac.user_id::text || ':' || COALESCE(ac.section_id, ''),
        '|' ORDER BY ac.user_id::text, COALESCE(ac.section_id, '')
      ),
      '__NO_COLLABORATOR__'
    ) AS collaborator_signature
  FROM assignments a
  LEFT JOIN assignment_collaborators ac ON ac.assignment_id = a.id
  GROUP BY a.id
), verify_scope AS (
  SELECT
    a.template_id,
    COALESCE(a.department, '') AS department_key,
    COALESCE(a.created_by::text, '') AS created_by_key,
    cs.collaborator_signature,
    COUNT(*) AS active_count
  FROM assignments a
  JOIN collaborator_signature cs ON cs.assignment_id = a.id
  WHERE a.archived = false
  GROUP BY
    a.template_id,
    COALESCE(a.department, ''),
    COALESCE(a.created_by::text, ''),
    cs.collaborator_signature
)
SELECT *
FROM verify_scope
WHERE active_count > 1
ORDER BY active_count DESC;

-- =====================================================
-- Step 6) 清理後檢視（管理端摘要）
-- =====================================================
SELECT
  t.title AS template_name,
  COUNT(a.id) FILTER (WHERE a.archived = false) AS active_assignments,
  COUNT(a.id) FILTER (WHERE a.archived = true) AS archived_assignments,
  COUNT(a.id) AS total_assignments
FROM templates t
LEFT JOIN assignments a ON a.template_id = t.id
GROUP BY t.id, t.title
ORDER BY t.title;
