const fs = require('fs');
const path = require('path');

const sourcePath = path.join(process.cwd(), 'app', 'admin', 'roles', '[id]', 'RoleEditClient.tsx');
const source = fs.readFileSync(sourcePath, 'utf8');
const roleUsersRoutePath = path.join(process.cwd(), 'app', 'api', 'roles', '[id]', 'users', 'route.ts');
const roleUsersRouteSource = fs.readFileSync(roleUsersRoutePath, 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function count(text) {
  return source.split(text).length - 1;
}

assert(
  source.includes("const BROAD_SCOPE_PERMISSION_ACTIONS = new Set(['view_all'])"),
  'view_all must remain a broad-scope sensitive permission'
);
assert(
  source.includes("const VIEW_SCOPE_CODE_ACTIONS = new Set([")
    && source.includes("return permission.code.split('.').at(-1) || ''")
    && source.includes('VIEW_SCOPE_CODE_ACTIONS.has(getPermissionCodeAction(permission))'),
  'view scopes must be identified from the permission code instead of a reused action label'
);
assert(
  source.includes('conflictingViewScopes') && source.includes('發現重複的資料查看範圍'),
  'legacy roles with multiple view scopes must be surfaced instead of silently summarized'
);
assert(
  source.includes('focusConflictingViewScope')
    && source.includes('conflict.scopes.map(getPermissionActionLabel)')
    && source.includes('scrollIntoView'),
  'view-scope conflicts must identify each feature and provide direct navigation to its controls'
);
assert(
  source.includes('isExclusiveViewScope(target) && target.granted')
    && source.includes('grantPermissionWithFeatureAccess(current, target)'),
  'reselecting a granted view scope must clear conflicting sibling scopes'
);
assert(
  source.includes("scope: '資料查看範圍（擇一）'"),
  'exclusive view scopes must be presented as a single-choice group'
);
assert(
  source.includes("type={isExclusiveViewScope(perm) ? 'radio' : 'checkbox'}"),
  'non-scope view capabilities such as view_performance must remain checkboxes'
);
assert(
  source.includes("permission.code === 'monthly.status.view_own'")
    && source.includes("return '查看管理門市'"),
  'monthly status own scope must describe managed stores instead of the ambiguous self label'
);
assert(
  source.includes('使用者同時擁有的其他角色仍會疊加'),
  'role editor must explain additive permissions to prevent false restrictive assumptions'
);
assert(
  source.includes("if (permission.action === 'access') return 'entry'"),
  'access permission must not be mixed into the exclusive view scope group'
);
assert(
  source.includes("if (permission.action === 'view_inactive') return 'additional'"),
  'optional view capabilities must not be mixed into the exclusive view scope group'
);
assert(
  source.includes('grantPermissionWithFeatureAccess'),
  'granting a feature capability must also preserve feature access'
);
assert(
  source.includes("permission.action === 'access')"),
  'feature access must be automatically enabled with dependent permissions'
);
assert(
  source.includes('其他權限使用中，需保留進入功能'),
  'feature access must explain why it cannot be disabled while dependent permissions are active'
);
assert(
  source.includes('/users?summary=1'),
  'the permission review must use a lightweight role impact summary'
);
assert(
  source.includes('將影響 {activeRoleUserCount} 位目前使用此角色的人員'),
  'unsaved permission changes must disclose the affected active user count'
);
assert(
  roleUsersRouteSource.includes("request.nextUrl.searchParams.get('summary') === '1'")
    && roleUsersRouteSource.includes(".eq('is_active', true)")
    && roleUsersRouteSource.includes('expires_at.gt.'),
  'role impact summary must exclude inactive and expired assignments'
);
assert(
  source.includes("const canUseFeaturePresets = permissionView === 'all' && !normalizedPermissionSearch"),
  'feature presets must only be available in the unfiltered all-permissions view'
);
assert(
  source.includes('確認擴大查看範圍'),
  'broad-scope grants must show an explicit confirmation'
);
assert(
  source.includes('permission.granted === savedPermissionIdSet.has(permission.id)'),
  'the changed-permissions filter must compare current and saved state'
);
assert(
  source.includes('目前無法取得權限清單'),
  'permission load failures must not render as an empty permission list'
);
assert(
  count("'儲存權限'") === 1,
  'the permission surface must have one primary save action'
);
assert(
  !source.includes("alert('權限已儲存')"),
  'permission save success must use non-blocking in-page feedback'
);
assert(
  !source.includes('alert(data.details || data.message)')
    && !source.includes('confirm(`確定要移除使用者'),
  'role assignment and removal must use contextual in-page feedback and confirmation'
);
assert(
  source.includes('角色使用者載入失敗') && source.includes('setUserListError'),
  'role user load failures must not appear as an empty user list'
);
assert(
  source.includes("getRoleAssignmentStatus(user)") && source.includes("'已過期'"),
  'expired role assignments must not be shown as active'
);
assert(
  source.includes('搜尋姓名、員編、部門或職稱') && source.includes('停用或過期'),
  'role user lists must support task-oriented search and status filtering'
);

console.log('RBAC permission UI safety checks passed.');
