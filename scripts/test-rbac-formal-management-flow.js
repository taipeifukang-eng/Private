#!/usr/bin/env node

/**
 * Static guard for the production-compatible RBAC management flow:
 *
 * 1. Users register first.
 * 2. System admins edit profile basics on public.profiles.
 * 3. Role management creates/edits roles and permission codes.
 * 4. Role assignment uses employee_code, with profiles.employee_code as the
 *    required source and store_employees as an optional legacy/formal fallback.
 *
 * This test does not connect to Supabase and does not mutate data.
 */

const fs = require('fs');
const path = require('path');

const authActionsPath = path.join(process.cwd(), 'app', 'auth', 'actions.ts');
const roleUsersPath = path.join(process.cwd(), 'app', 'api', 'roles', '[id]', 'users', 'route.ts');
const usersSearchPath = path.join(process.cwd(), 'app', 'api', 'users', 'search', 'route.ts');
const rolesPagePath = path.join(process.cwd(), 'app', 'admin', 'roles', 'page.tsx');
const roleEditPagePath = path.join(process.cwd(), 'app', 'admin', 'roles', '[id]', 'page.tsx');
const roleListClientPath = path.join(process.cwd(), 'app', 'admin', 'roles', 'RoleListClient.tsx');
const roleEditClientPath = path.join(process.cwd(), 'app', 'admin', 'roles', '[id]', 'RoleEditClient.tsx');
const userManagementTablePath = path.join(process.cwd(), 'components', 'admin', 'UserManagementTable.tsx');
const navbarPermissionsPath = path.join(process.cwd(), 'hooks', 'useNavbarPermissions.ts');
const permissionCheckPath = path.join(process.cwd(), 'lib', 'permissions', 'check.ts');
const userSearchDevTestPath = path.join(process.cwd(), 'scripts', 'test-rbac-user-search-dev.js');
const userPermissionsViewDevTestPath = path.join(process.cwd(), 'scripts', 'test-rbac-user-permissions-view-dev.js');
const userManagementDevTestPath = path.join(process.cwd(), 'scripts', 'test-rbac-user-management-dev.js');
const navbarPermissionsDevTestPath = path.join(process.cwd(), 'scripts', 'test-rbac-navbar-permissions-dev.js');
const safePreflightPath = path.join(process.cwd(), 'scripts', 'test-rbac-safe-preflight.js');
const packageJsonPath = path.join(process.cwd(), 'package.json');
const rbacManagementVerifyDocPath = path.join(process.cwd(), 'docs', 'RBAC-MANAGEMENT-VERIFY.md');

const authActions = fs.readFileSync(authActionsPath, 'utf8');
const roleUsersRoute = fs.readFileSync(roleUsersPath, 'utf8');
const usersSearchRoute = fs.readFileSync(usersSearchPath, 'utf8');
const rolesPage = fs.readFileSync(rolesPagePath, 'utf8');
const roleEditPage = fs.readFileSync(roleEditPagePath, 'utf8');
const roleListClient = fs.readFileSync(roleListClientPath, 'utf8');
const roleEditClient = fs.readFileSync(roleEditClientPath, 'utf8');
const userManagementTable = fs.readFileSync(userManagementTablePath, 'utf8');
const navbarPermissions = fs.readFileSync(navbarPermissionsPath, 'utf8');
const permissionCheck = fs.readFileSync(permissionCheckPath, 'utf8');
const userSearchDevTest = fs.readFileSync(userSearchDevTestPath, 'utf8');
const userPermissionsViewDevTest = fs.readFileSync(userPermissionsViewDevTestPath, 'utf8');
const userManagementDevTest = fs.readFileSync(userManagementDevTestPath, 'utf8');
const navbarPermissionsDevTest = fs.readFileSync(navbarPermissionsDevTestPath, 'utf8');
const safePreflight = fs.readFileSync(safePreflightPath, 'utf8');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const rbacManagementVerifyDoc = fs.readFileSync(rbacManagementVerifyDocPath, 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(/export\s+async\s+function\s+updateUserProfile\s*\(/.test(authActions), 'updateUserProfile function not found');

assert(
  /hasPermission\s*\(\s*currentUserId\s*,\s*['"]user\.user\.edit['"]\s*\)/.test(authActions),
  'updateUserProfile must require user.user.edit for profile basic fields'
);

assert(
  /hasPermission\s*\(\s*currentUserId\s*,\s*['"]user\.user\.change_role['"]\s*\)/.test(authActions),
  'updateUserProfile must require user.user.change_role for legacy role updates'
);

assert(
  !/updateUserProfile[\s\S]*profile\??\.role\s*[!=]=[\s\S]*export\s+async\s+function\s+deleteUser/.test(authActions),
  'updateUserProfile must not authorize through profiles.role'
);

assert(
  /employee_code:\s*updates\.employee_code\?\.trim\(\)\.toUpperCase\(\)/.test(authActions),
  'updateUserProfile must normalize employee_code to uppercase'
);

assert(
  /員工編號已被其他使用者使用/.test(authActions),
  'updateUserProfile must guard duplicate employee_code before saving'
);

assert(
  /不能修改目前登入使用者的相容角色/.test(authActions),
  'updateUserProfile must block changing the current user legacy role'
);

assert(
  /from\(['"]profiles['"]\)[\s\S]*\.select\(['"]id,\s*employee_code,\s*full_name,\s*email['"]\)/.test(roleUsersRoute),
  'role user assignment must query profiles by employee_code'
);

assert(
  /from\(['"]store_employees['"]\)/.test(roleUsersRoute),
  'role user assignment may query legacy store_employees as compatibility fallback'
);

assert(
  /isMissingOptionalTable/.test(roleUsersRoute) && /PGRST205/.test(roleUsersRoute) && /schema cache/.test(roleUsersRoute),
  'role user assignment must tolerate missing optional store_employees in DEV'
);

assert(
  /body:\s*JSON\.stringify\(\{\s*employee_codes:\s*codes\s*\}\)/.test(
    roleEditClient
  ),
  'role edit UI must assign users by employee_codes'
);

assert(
  /hasAnyPermission\s*\(\s*user\.id\s*,\s*\[/.test(usersSearchRoute),
  '/api/users/search must have an API-level permission guard'
);

assert(
  /createAdminClient/.test(usersSearchRoute) &&
    /profileNameById/.test(usersSearchRoute) &&
    /name:\s*profileNameById\.get\(emp\.user_id\)\s*\|\|\s*emp\.employee_name/.test(usersSearchRoute),
  '/api/users/search must display profiles.full_name from user management before legacy employee_name'
);

assert(
  /name:\s*profile\?\.full_name\s*\|\|\s*employee\?\.employee_name/.test(roleUsersRoute),
  'role user list must display profiles.full_name before legacy store_employees.employee_name'
);

assert(
  /USER_MANAGEMENT_NAV_PERMISSION_CODES/.test(usersSearchRoute) &&
    /ROLE_LIST_PAGE_PERMISSION_CODES/.test(usersSearchRoute),
  '/api/users/search must use formal RBAC user/role management permission sets'
);

assert(
  /status:\s*403/.test(usersSearchRoute) && /沒有搜尋使用者的權限/.test(usersSearchRoute),
  '/api/users/search must return 403 for users without search permission'
);

assert(
  /fetch\(['"]\/api\/permissions\/user['"][\s\S]*permissionsJson\.permissions/.test(navbarPermissions) &&
    /permissionSet\.add\(code\.trim\(\)\)/.test(navbarPermissions),
  'Navbar permissions must merge server-side effective permissions from /api/permissions/user'
);

assert(
  /createAdminClient/.test(permissionCheck) &&
    /from\(['"]user_roles['"]\)[\s\S]*role_permissions!inner[\s\S]*permission:permissions!inner/.test(permissionCheck),
  'getUserPermissions must fall back to server-side formal RBAC joins when legacy RPC is empty'
);

assert(
  /monthly\.status\.view_own/.test(navbarPermissions) &&
    /monthly\.status\.view_all/.test(navbarPermissions) &&
    /canViewMonthlyStatus:\s*hasAnyPermissionCode/.test(navbarPermissions),
  'Navbar monthly status entry must be driven by monthly.status.view_own/view_all effective permissions'
);

assert(
  /const\s+canEdit\s*=\s*await\s+hasPermission\s*\(\s*user\.id\s*,\s*['"]role\.role\.edit['"]\s*\)/.test(rolesPage) &&
    /const\s+canDelete\s*=\s*await\s+hasPermission\s*\(\s*user\.id\s*,\s*['"]role\.role\.delete['"]\s*\)/.test(rolesPage),
  'roles page must pass edit/delete capabilities to the role list UI'
);

assert(
  /<RoleListClient[\s\S]*canCreate=\{canCreate\}[\s\S]*canEdit=\{canEdit\}[\s\S]*canDelete=\{canDelete\}/.test(rolesPage),
  'roles page must pass canCreate/canEdit/canDelete to RoleListClient'
);

assert(
  /canEdit\s*\?\s*['"]編輯['"]\s*:\s*['"]查看['"]/.test(roleListClient),
  'role list edit link must show 查看 when the user lacks role.role.edit'
);

assert(
  /canEdit\s*&&[\s\S]*handleToggleActive/.test(roleListClient) &&
    /canDelete\s*&&[\s\S]*handleDelete/.test(roleListClient),
  'role list must gate active toggle by role.role.edit and delete by role.role.delete'
);

assert(
  /canViewPermissions=\{canViewPermissions\}/.test(roleEditPage) &&
    /canViewUsers=\{canViewUsers\}/.test(roleEditPage) &&
    /canAssignUsers=\{canAssignUsers\}/.test(roleEditPage) &&
    /canRevokeUsers=\{canRevokeUsers\}/.test(roleEditPage),
  'role edit page must pass granular permission/user management capabilities'
);

assert(
  /缺少[\s\S]*role\.permission\.view/.test(roleEditClient) &&
    /缺少[\s\S]*role\.user_role\.view/.test(roleEditClient),
  'role edit UI must show explicit missing permission messages for permission and user tabs'
);

assert(
  /canAssignUsers\s*&&[\s\S]*\+\s*新增使用者/.test(roleEditClient) &&
    /canRevokeUsers\s*\?[\s\S]*移除/.test(roleEditClient),
  'role edit user tab must gate assign/revoke actions by role.user_role permissions'
);

assert(
  /RBAC角色/.test(userManagementTable) &&
    /有效權限/.test(userManagementTable) &&
    /門市範圍/.test(userManagementTable),
  'user management table must show RBAC roles, effective permission count, and store scope count columns'
);

assert(
  /openRbacDetail\s*\(\s*user\s*\)/.test(userManagementTable) &&
    /\/api\/admin\/users\/\$\{user\.id\}\/rbac/.test(userManagementTable) &&
    /title=["']查看角色與權限["']/.test(userManagementTable),
  'user management table must provide a read-only role and permission detail action'
);

assert(
  /角色與有效權限/.test(userManagementTable) &&
    /已指派角色/.test(userManagementTable) &&
    /有效權限代碼/.test(userManagementTable) &&
    /來源：/.test(userManagementTable) &&
    /store_scopes/.test(userManagementTable),
  'user RBAC detail modal must display assigned roles, effective permission codes, source roles, and store scopes'
);

assert(
  /舊 profiles\.role/.test(userManagementTable) &&
    /Admin compatibility/.test(userManagementTable) &&
    /由目前有效 RBAC 角色計算/.test(userManagementTable),
  'user RBAC detail modal must label legacy compatibility separately from formal RBAC effective permissions'
);

assert(
  /const\s+hasPermissionCode\s*=\s*\(code:\s*string\)\s*=>\s*isAdminLike\s*\|\|\s*permissionSet\.has\(code\)/.test(navbarPermissions) &&
    /const\s+hasAnyPermissionCode\s*=\s*\(codes:\s*string\[\]\)\s*=>\s*[\s\S]*isAdminLike\s*\|\|\s*codes\.some\(\(code\)\s*=>\s*permissionSet\.has\(code\)\)/.test(navbarPermissions),
  'navbar permission hook must apply admin compatibility to every permission-gated menu item'
);

[
  'canManageStores',
  'canViewMonthlyStatus',
  'canViewInspections',
  'canAccessCrossDeptMerchandise',
  'canAccessMaintenance',
  'canManageInventory',
].forEach((key) => {
  const assignment = new RegExp(`${key}:\\s*has(?:Any)?PermissionCode\\(`);
  assert(
    assignment.test(navbarPermissions),
    `${key} must use admin-compatible navbar permission helper`
  );
});

assert(
  !/SUPABASE_SERVICE_ROLE_KEY|service_role|createAdminClient/.test(userPermissionsViewDevTest),
  'RBAC user permissions dynamic test must not use service role or admin client'
);

assert(
  /\/api\/users\/search\?q=/.test(userPermissionsViewDevTest) &&
    /\/api\/admin\/users\/\$\{profile\.id\}\/rbac/.test(userPermissionsViewDevTest),
  'RBAC user permissions dynamic test must discover users through formal search API before reading RBAC detail API'
);

assert(
  packageJson.scripts?.['test:rbac-safe-preflight'] === 'node scripts/test-rbac-safe-preflight.js',
  'package.json must expose test:rbac-safe-preflight'
);

assert(
  packageJson.scripts?.['test:rbac-local-ready'] === 'npm run test:rbac-user-management-cases && npm run test:rbac-safe-preflight',
  'package.json must expose test:rbac-local-ready'
);

assert(
  packageJson.scripts?.['test:rbac-user-management-dev'] === 'node scripts/test-rbac-user-management-dev.js',
  'package.json must expose test:rbac-user-management-dev'
);

assert(
  packageJson.scripts?.['test:rbac-user-management-cases'] === 'node scripts/test-rbac-user-management-dev.js --list-cases',
  'package.json must expose test:rbac-user-management-cases'
);

assert(
  !/SUPABASE_SERVICE_ROLE_KEY|service_role|createAdminClient|auth\.admin/.test(userManagementDevTest),
  'Combined RBAC user management dynamic test must not use service role or admin APIs'
);

[
  ['user search dynamic test', userSearchDevTest],
  ['user permissions view dynamic test', userPermissionsViewDevTest],
  ['combined user management dynamic test', userManagementDevTest],
  ['navbar permissions dynamic test', navbarPermissionsDevTest],
].forEach(([label, source]) => {
  assert(
    /base64-\$\{Buffer\.from\(JSON\.stringify\(session\),\s*['"]utf8['"]\)\.toString\(['"]base64url['"]\)\}/.test(source),
    `${label} must serialize Supabase SSR cookies with base64url session format`
  );

  assert(
    !/JSON\.stringify\(\s*\[\s*session\.access_token/.test(source),
    `${label} must not use the legacy JSON array auth cookie format`
  );
});

assert(
  /--help/.test(userManagementDevTest) &&
    /--list-cases/.test(userManagementDevTest) &&
    /handleInfoOnlyArgs/.test(userManagementDevTest) &&
    /if \(handleInfoOnlyArgs\(\)\) return;/.test(userManagementDevTest),
  'Combined RBAC user management dynamic test must provide help/list-cases mode before guard, login, or API tests'
);

assert(
  /runGuard\(['"]scripts\/verify-dev-supabase-environment\.js['"]\)/.test(userManagementDevTest) &&
    /runGuard\(['"]scripts\/verify-dev-supabase-cli-environment\.js['"]\)/.test(userManagementDevTest),
  'Combined RBAC user management dynamic test must run both DEV guards'
);

assert(
  /dev-ga-access@example\.test/.test(userManagementDevTest) &&
    /dev-ga-manage@example\.test/.test(userManagementDevTest) &&
    /dev-ga-view@example\.test/.test(userManagementDevTest) &&
    /dev-no-ga@example\.test/.test(userManagementDevTest),
  'Combined RBAC user management dynamic test must cover the four manual DEV verification accounts'
);

assert(
  /\/api\/users\/search\?q=/.test(userManagementDevTest) &&
    /\/api\/admin\/users\/\$\{profile\.id\}\/rbac/.test(userManagementDevTest) &&
    /no_access cannot query another user RBAC details/.test(userManagementDevTest),
  'Combined RBAC user management dynamic test must cover search, RBAC detail, and no_access denial'
);

assert(
  /assertNoSensitiveOutput/.test(userManagementDevTest) &&
    /access_token/.test(userManagementDevTest) &&
    /refresh_token/.test(userManagementDevTest) &&
    /cookie/.test(userManagementDevTest),
  'Combined RBAC user management dynamic test must keep sensitive output redaction checks'
);

assert(
  /printableRbacSummary/.test(userManagementDevTest) &&
    /RBAC user management verification summary/.test(userManagementDevTest) &&
    /effective_permission_codes/.test(userManagementDevTest) &&
    /store_scopes/.test(userManagementDevTest),
  'Combined RBAC user management dynamic test must print non-sensitive roles, permission codes, and store scopes summary'
);

assert(
  /assertDevServerReady/.test(safePreflight) &&
    /Start it with: npm run dev -- -p 3002/.test(safePreflight),
  'RBAC safe preflight must check dev server readiness before route smoke tests'
);

assert(
  /scripts\/test-rbac-user-management-dev\.js/.test(safePreflight) &&
    /label:\s*['"]syntax: combined user management dynamic script['"][\s\S]*args:\s*\[\s*['"]--check['"],\s*['"]scripts\/test-rbac-user-management-dev\.js['"]\s*\]/.test(safePreflight),
  'RBAC safe preflight must syntax-check the combined dynamic script without running it'
);

assert(
  /FORBIDDEN_ARGS[\s\S]*scripts\/test-rbac-navbar-permissions-dev\.js/.test(safePreflight) &&
    /FORBIDDEN_ARGS[\s\S]*scripts\/test-rbac-user-search-dev\.js/.test(safePreflight) &&
    /FORBIDDEN_ARGS[\s\S]*scripts\/test-rbac-user-permissions-view-dev\.js/.test(safePreflight) &&
    /FORBIDDEN_ARGS[\s\S]*scripts\/test-rbac-user-management-dev\.js/.test(safePreflight) &&
    /FORBIDDEN_ARGS[\s\S]*supabase/.test(safePreflight),
  'RBAC safe preflight must forbid write-heavy, password-based, or Supabase commands except syntax checks'
);

assert(
  /npm run test:rbac-safe-preflight/.test(rbacManagementVerifyDoc) &&
    /npm run test:rbac-user-management-dev/.test(rbacManagementVerifyDoc),
  'RBAC management verification doc must include safe preflight and combined dynamic test commands'
);

assert(
  /dev-ga-access@example\.test/.test(rbacManagementVerifyDoc) &&
    /dev-ga-manage@example\.test/.test(rbacManagementVerifyDoc) &&
    /dev-ga-view@example\.test/.test(rbacManagementVerifyDoc) &&
    /dev-no-ga@example\.test/.test(rbacManagementVerifyDoc),
  'RBAC management verification doc must list the four manual DEV verification accounts'
);

assert(
  /使用者管理/.test(rbacManagementVerifyDoc) &&
    /角色權限管理/.test(rbacManagementVerifyDoc) &&
    /no_access/.test(rbacManagementVerifyDoc),
  'RBAC management verification doc must cover user management, role management, and no_access manual checks'
);

assert(
  /不執行 `scripts\/test-rbac-navbar-permissions-dev\.js`/.test(rbacManagementVerifyDoc) &&
    /service-role 重型寫入驗收/.test(rbacManagementVerifyDoc) &&
    /不執行 DB migration、push、repair、reset 或 rollback/.test(rbacManagementVerifyDoc),
  'RBAC management verification doc must forbid write-heavy navbar script and DB operations'
);

console.log('PASS RBAC formal management flow static checks');
