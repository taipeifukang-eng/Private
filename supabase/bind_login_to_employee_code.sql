-- 綁定「登入帳號」與「員工編號」
-- 目的：讓系統正確辨識 taipeifukang@gmail.com = FK0171
-- 若你要換人，改這兩個值即可

BEGIN;

-- 0) 參數
WITH params AS (
  SELECT
    lower('taipeifukang@gmail.com')::text AS target_email,
    upper('FK0171')::text AS target_employee_code
), user_row AS (
  SELECT u.id, lower(u.email) AS email
  FROM auth.users u
  JOIN params p ON lower(u.email) = p.target_email
  LIMIT 1
)
-- 1) profiles：確保有此帳號，且 employee_code 正確
UPDATE profiles pr
SET employee_code = p.target_employee_code,
    role = 'admin',
    updated_at = NOW()
FROM params p, user_row u
WHERE pr.id = u.id;

-- 若 profiles 沒有這個 user，補一筆
WITH params AS (
  SELECT
    lower('taipeifukang@gmail.com')::text AS target_email,
    upper('FK0171')::text AS target_employee_code
), user_row AS (
  SELECT u.id, u.email
  FROM auth.users u
  JOIN params p ON lower(u.email) = p.target_email
  LIMIT 1
)
INSERT INTO profiles (id, email, full_name, employee_code, role, created_at, updated_at)
SELECT
  u.id,
  u.email,
  split_part(u.email, '@', 1),
  p.target_employee_code,
  'admin',
  NOW(),
  NOW()
FROM user_row u, params p
WHERE NOT EXISTS (
  SELECT 1 FROM profiles pr WHERE pr.id = u.id
);

-- 2) store_employees：把 FK0171 的 user_id 綁到該登入帳號
-- 注意：若 FK0171 在多筆歷史資料都會一起綁定（通常是預期行為）
WITH params AS (
  SELECT
    lower('taipeifukang@gmail.com')::text AS target_email,
    upper('FK0171')::text AS target_employee_code
), user_row AS (
  SELECT u.id
  FROM auth.users u
  JOIN params p ON lower(u.email) = p.target_email
  LIMIT 1
)
UPDATE store_employees se
SET user_id = u.id,
    updated_at = NOW()
FROM params p, user_row u
WHERE upper(se.employee_code) = p.target_employee_code
  AND (se.user_id IS DISTINCT FROM u.id);

-- 3) user_roles：同步 employee_code 欄位，避免 RBAC UI 顯示不一致
WITH params AS (
  SELECT
    lower('taipeifukang@gmail.com')::text AS target_email,
    upper('FK0171')::text AS target_employee_code
), user_row AS (
  SELECT u.id
  FROM auth.users u
  JOIN params p ON lower(u.email) = p.target_email
  LIMIT 1
)
UPDATE user_roles ur
SET employee_code = p.target_employee_code
FROM params p, user_row u
WHERE ur.user_id = u.id
  AND (ur.employee_code IS NULL OR upper(ur.employee_code) <> p.target_employee_code);

COMMIT;

-- 4) 驗證：三張表關聯是否一致
WITH params AS (
  SELECT
    lower('taipeifukang@gmail.com')::text AS target_email,
    upper('FK0171')::text AS target_employee_code
), user_row AS (
  SELECT u.id, u.email
  FROM auth.users u
  JOIN params p ON lower(u.email) = p.target_email
  LIMIT 1
)
SELECT 'auth.users' AS source, u.id::text AS user_id, u.email, NULL::text AS employee_code, NULL::text AS role
FROM user_row u
UNION ALL
SELECT 'profiles', pr.id::text, pr.email, pr.employee_code, pr.role
FROM profiles pr
JOIN user_row u ON u.id = pr.id
UNION ALL
SELECT 'store_employees', se.user_id::text, NULL::text, se.employee_code, NULL::text
FROM store_employees se
JOIN params p ON upper(se.employee_code) = p.target_employee_code
ORDER BY source;

-- 5) 驗證：RBAC 員編查詢是否抓得到
SELECT * FROM get_employees_by_codes(ARRAY['FK0171']);
