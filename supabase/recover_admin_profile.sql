-- 緊急修復：恢復 profiles 資料並指定系統管理員
-- 使用情境：啟用 RLS 後，登入帳號顯示為一般使用者或抓不到角色

BEGIN;

-- 1) 先補齊所有 auth.users 對應的 profiles（避免 profiles 為空）
INSERT INTO public.profiles (id, email, full_name, role, created_at, updated_at)
SELECT
  u.id,
  u.email,
  COALESCE(u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1)) AS full_name,
  'member'::text AS role,
  NOW(),
  NOW()
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL;

-- 2) 指定你的帳號為 admin（不存在就建立，存在就升級）
INSERT INTO public.profiles (id, email, full_name, role, created_at, updated_at)
SELECT
  u.id,
  u.email,
  COALESCE(u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1)) AS full_name,
  'admin'::text AS role,
  NOW(),
  NOW()
FROM auth.users u
WHERE lower(u.email) = lower('taipeifukang@gmail.com')
ON CONFLICT (id)
DO UPDATE SET
  email = EXCLUDED.email,
  role = 'admin',
  updated_at = NOW();

COMMIT;

-- 3) 驗證目前 admin 清單（執行後應至少看到你的帳號）
SELECT id, email, full_name, role
FROM public.profiles
WHERE role = 'admin'
ORDER BY updated_at DESC;
