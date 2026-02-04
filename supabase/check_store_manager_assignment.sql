-- 檢查特定用戶的店長指派
SELECT 
  sm.id,
  sm.user_id,
  p.full_name,
  p.job_title,
  sm.store_id,
  sm.role_type,
  sm.created_at
FROM store_managers sm
LEFT JOIN profiles p ON sm.user_id = p.id
WHERE sm.user_id = 'cdc187e8-0f82-46b7-8247-5782d1dcc259';

-- 檢查明湖店的所有店長
SELECT 
  sm.id,
  sm.user_id,
  p.full_name,
  p.job_title,
  p.role,
  sm.store_id,
  sm.role_type,
  sm.created_at
FROM store_managers sm
LEFT JOIN profiles p ON sm.user_id = p.id
WHERE sm.store_id = '663cedb1-971e-4a62-a2f3-452a59a0d498';

-- 檢查是否有這個特定的組合
SELECT 
  sm.*,
  p.full_name,
  p.job_title,
  p.role
FROM store_managers sm
LEFT JOIN profiles p ON sm.user_id = p.id
WHERE sm.user_id = 'cdc187e8-0f82-46b7-8247-5782d1dcc259'
  AND sm.store_id = '663cedb1-971e-4a62-a2f3-452a59a0d498';
