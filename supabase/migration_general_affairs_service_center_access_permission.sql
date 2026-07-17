-- ============================================================
-- 總務服務中心 - 獨立入口權限
-- 說明：
--   新版總務服務中心開發完成前先以獨立權限控管入口。
--   此 migration 只建立權限碼，不自動授權給任何角色。
--   開放時請在角色權限管理中指派此權限。
-- ============================================================

INSERT INTO permissions (module, feature, code, action, description)
VALUES (
  'general_affairs',
  'service_center',
  'general_affairs.service_center.access',
  'access',
  '可進入新版總務服務中心'
)
ON CONFLICT (code) DO UPDATE SET
  module = EXCLUDED.module,
  feature = EXCLUDED.feature,
  action = EXCLUDED.action,
  description = EXCLUDED.description;
