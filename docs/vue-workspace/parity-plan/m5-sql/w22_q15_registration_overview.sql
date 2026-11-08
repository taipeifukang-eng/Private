-- M5 W22 Q15：只讀。公開註冊保留後，上線前先看現在正式區有多少「自己註冊」的空帳號，以及外部信箱網域分佈。
-- 不改任何資料；請在正式區 SQL editor 由使用者自行執行，三段各自貼上。

-- 1) 帳號狀態總覽：已驗證信箱／未驗證、有沒有登入過、有沒有任何生效角色
SELECT (au.email_confirmed_at IS NOT NULL)                                  AS email_confirmed,
       (au.last_sign_in_at IS NOT NULL)                                      AS ever_signed_in,
       EXISTS (SELECT 1 FROM user_roles ur
               WHERE ur.user_id = au.id AND ur.is_active
                 AND (ur.expires_at IS NULL OR ur.expires_at > now()))       AS has_active_role,
       count(*)                                                              AS accounts
FROM auth.users au
GROUP BY 1, 2, 3
ORDER BY 1, 2, 3;

-- 2) 沒有任何生效角色的帳號，依信箱網域統計（公司網域以外的會排在前面值得留意）
SELECT split_part(lower(au.email), '@', 2) AS email_domain, count(*) AS accounts,
       min(au.created_at) AS first_registered, max(au.created_at) AS last_registered
FROM auth.users au
WHERE NOT EXISTS (SELECT 1 FROM user_roles ur
                  WHERE ur.user_id = au.id AND ur.is_active
                    AND (ur.expires_at IS NULL OR ur.expires_at > now()))
GROUP BY 1
ORDER BY accounts DESC, 1;

-- 3) 註冊後超過 7 天仍未驗證信箱、也沒登入過的帳號（可考慮清理，但請由你決定；此檔不刪任何資料）
SELECT au.email, au.created_at AS registered_at, pr.full_name
FROM auth.users au
LEFT JOIN profiles pr ON pr.id = au.id
WHERE au.email_confirmed_at IS NULL AND au.last_sign_in_at IS NULL AND au.created_at < now() - interval '7 days'
ORDER BY au.created_at;
