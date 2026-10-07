-- Restore promotion stages from monthly snapshots and replay official position
-- history into monthly staff rows. Acting-manager assignment is independent
-- from the official position and must not be inferred from the latest promotion.

WITH missing_levels AS (
  SELECT
    movement.id,
    snapshot.newbie_level
  FROM public.employee_movement_history AS movement
  JOIN LATERAL (
    SELECT monthly.newbie_level
    FROM public.monthly_staff_status AS monthly
    WHERE monthly.employee_code = movement.employee_code
      AND monthly.position = '新人'
      AND monthly.newbie_level IN ('未過階新人', '一階新人', '二階新人')
      AND monthly.year_month >= to_char(movement.movement_date, 'YYYY-MM')
      AND monthly.year_month < COALESCE((
        SELECT min(to_char(next_movement.movement_date, 'YYYY-MM'))
        FROM public.employee_movement_history AS next_movement
        WHERE next_movement.employee_code = movement.employee_code
          AND next_movement.movement_type = 'promotion'
          AND next_movement.movement_date > movement.movement_date
          AND next_movement.new_value <> '代理店長'
      ), '9999-12')
    ORDER BY
      CASE WHEN monthly.store_id = movement.store_id THEN 0 ELSE 1 END,
      monthly.year_month,
      monthly.updated_at DESC
    LIMIT 1
  ) AS snapshot ON true
  WHERE movement.movement_type = 'promotion'
    AND movement.new_value = '新人'
    AND COALESCE(movement.notes, '') !~ '新人等級[:：]'
)
UPDATE public.employee_movement_history AS movement
SET notes = concat_ws('；', NULLIF(btrim(movement.notes), ''), '新人等級:' || missing_levels.newbie_level),
    updated_at = now()
FROM missing_levels
WHERE movement.id = missing_levels.id;

WITH monthly_targets AS (
  SELECT
    monthly.id,
    monthly.employee_code,
    monthly.year_month,
    monthly.position AS existing_position,
    monthly.newbie_level AS existing_newbie_level,
    (to_date(monthly.year_month || '-01', 'YYYY-MM-DD') + interval '1 month')::date AS month_end
  FROM public.monthly_staff_status AS monthly
  WHERE EXISTS (
    SELECT 1
    FROM public.employee_movement_history AS movement
    WHERE movement.employee_code = monthly.employee_code
      AND movement.movement_type = 'promotion'
      AND movement.movement_date < (to_date(monthly.year_month || '-01', 'YYYY-MM-DD') + interval '1 month')::date
  )
), resolved_positions AS (
  SELECT
    target.id,
    target.existing_position,
    target.existing_newbie_level,
    COALESCE(regular_position.new_value, latest_movement.old_value, target.existing_position) AS resolved_position,
    (regexp_match(regular_position.notes, '(新人等級|行政階級)[:：]([^；\n]+)'))[2] AS history_level
  FROM monthly_targets AS target
  LEFT JOIN LATERAL (
    SELECT movement.new_value, movement.notes
    FROM public.employee_movement_history AS movement
    WHERE movement.employee_code = target.employee_code
      AND movement.movement_type = 'promotion'
      AND movement.new_value <> '代理店長'
      AND movement.movement_date < target.month_end
    ORDER BY movement.movement_date DESC, movement.created_at DESC, movement.id DESC
    LIMIT 1
  ) AS regular_position ON true
  LEFT JOIN LATERAL (
    SELECT movement.new_value, movement.old_value
    FROM public.employee_movement_history AS movement
    WHERE movement.employee_code = target.employee_code
      AND movement.movement_type = 'promotion'
      AND movement.movement_date < target.month_end
    ORDER BY movement.movement_date DESC, movement.created_at DESC, movement.id DESC
    LIMIT 1
  ) AS latest_movement ON true
)
UPDATE public.monthly_staff_status AS monthly
SET position = resolved.resolved_position,
    newbie_level = CASE
      WHEN resolved.resolved_position IN ('新人', '行政') THEN COALESCE(
        resolved.history_level,
        CASE
          WHEN monthly.position = resolved.resolved_position THEN monthly.newbie_level
          ELSE NULL
        END
      )
      ELSE NULL
    END,
    updated_at = now()
FROM resolved_positions AS resolved
WHERE monthly.id = resolved.id
  AND (
    monthly.position IS DISTINCT FROM resolved.resolved_position
    OR monthly.newbie_level IS DISTINCT FROM CASE
      WHEN resolved.resolved_position IN ('新人', '行政') THEN COALESCE(
        resolved.history_level,
        CASE
          WHEN monthly.position = resolved.resolved_position THEN monthly.newbie_level
          ELSE NULL
        END
      )
      ELSE NULL
    END
  );
