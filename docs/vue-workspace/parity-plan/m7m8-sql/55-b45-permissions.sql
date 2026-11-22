-- 55-b45-permissions.sql
-- 正式區草稿（尚未執行，僅供使用者審閱）。內容與 DEV 已測過的 supabase/workspace-dev/20261119140000_m7m8_b45_permissions.sql 相同。
-- 第 4.5 批 E（請款權限碼 purchase_payment.view、purchase_payment.manage；P4）（2026-11-19 第 4.5 批問卷 P1 至 P10）。
-- 性質：會寫入，只新增 2 個權限碼（general_affairs.purchase_payment.view、general_affairs.purchase_payment.manage），**不自動授權給任何角色**（角色授權由你決定，見 README 第 4.5 批建議授權對象）。
-- 不新增 approve、pay 權限碼（P3 請款不核准；P4 manage 一把抓，制衡靠不可改刪的操作紀錄）。權限語意以正式區 has_permission 為準：不檢查 roles.is_active 的部分、資料庫沒有管理員後備（profiles.role = admin 看不到請款入口也寫不了）。
-- 先決條件：permissions 表存在（50 第 5 區看撞名）。
-- 檔案自己 BEGIN ... COMMIT，一次 Run 即可，任何一句出錯整份不生效。撤回：55-b45-permissions-rollback.sql。套用前先跑 50-b45-preview-before-apply.sql，備份後經使用者核可才執行。
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.permissions') IS NULL THEN RAISE EXCEPTION 'Missing prerequisite table: permissions'; END IF;
END $$;

INSERT INTO public.permissions (module, feature, code, action, description, is_active)
VALUES ('general_affairs', 'purchase_payment', 'general_affairs.purchase_payment.view', 'view',
        '請款查看：查看進貨發票、請款單、請款設定與對帳匯出，以及採購單的「發票與請款」分頁（金額、統編與銀行資訊另需廠商查看權限）', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.permissions (module, feature, code, action, description, is_active)
VALUES ('general_affairs', 'purchase_payment', 'general_affairs.purchase_payment.manage', 'manage',
        '請款管理：登錄進貨憑證與發票、建立與送出請款單、退回、標已付款、作廢、調整尾差與買受人設定（申請人可自己標已付款；所有動作留不可修改的操作紀錄）', true)
ON CONFLICT (code) DO NOTHING;

COMMIT;

-- 核對
SELECT code, action, is_active FROM public.permissions WHERE code LIKE 'general_affairs.purchase_payment.%' ORDER BY 1;
-- 核對：應列出 2 個權限碼
SELECT count(*) AS granted_roles FROM public.role_permissions rp JOIN public.permissions p ON p.id = rp.permission_id WHERE p.code LIKE 'general_affairs.purchase_payment.%';
-- 核對：套用當下是 0（尚未授權任何角色）
