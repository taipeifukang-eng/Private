#!/usr/bin/env node

/**
 * Static guard for the admin user deletion server action.
 *
 * This test does not connect to Supabase and never deletes users. It verifies
 * that the UI deletion path removes Supabase Auth users through the server-only
 * Admin API and uses RBAC permission checks instead of profiles.role.
 */

const fs = require('fs');
const path = require('path');

const actionPath = path.join(process.cwd(), 'app', 'auth', 'actions.ts');
const source = fs.readFileSync(actionPath, 'utf8');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function extractFunction(name) {
  const startPattern = new RegExp(`export\\s+async\\s+function\\s+${name}\\s*\\(`);
  const match = startPattern.exec(source);
  assert(match, `${name} function not found`);

  const bodyStart = source.indexOf('{', match.index);
  assert(bodyStart !== -1, `${name} body not found`);

  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) return source.slice(match.index, index + 1);
  }

  throw new Error(`${name} body is not balanced`);
}

const deleteUserSource = extractFunction('deleteUser');

assert(
  /hasPermission\s*\(\s*currentUserId\s*,\s*['"]user\.user\.delete['"]\s*\)/.test(deleteUserSource),
  'deleteUser must require the user.user.delete RBAC permission'
);

assert(
  !/profile\??\.role\s*[!=]=/.test(deleteUserSource),
  'deleteUser must not authorize deletion through profiles.role'
);

assert(
  /currentUserId\s*===\s*userId/.test(deleteUserSource),
  'deleteUser must block deleting the currently signed-in user'
);

assert(
  /auth\.admin\.getUserById\s*\(\s*userId\s*\)/.test(deleteUserSource),
  'deleteUser must check whether the Supabase Auth user exists'
);

assert(
  /auth\.admin\.deleteUser\s*\(\s*userId\s*\)/.test(deleteUserSource),
  'deleteUser must delete the Supabase Auth user through the Admin API'
);

assert(
  /isProfileHistoryReferenceError/.test(deleteUserSource) &&
    /violates foreign key constraint/.test(deleteUserSource),
  'deleteUser must detect profile foreign-key history references'
);

assert(
  /isAuthUserDatabaseDeleteError/.test(deleteUserSource) &&
    /Database error deleting user/.test(deleteUserSource),
  'deleteUser must treat Supabase Auth database deletion errors as keep-history disable fallback'
);

assert(
  /auth\.admin\.updateUserById\s*\(\s*userId\s*,[\s\S]*ban_duration:\s*['"]876000h['"]/.test(deleteUserSource),
  'deleteUser must disable login when profile deletion is blocked by history references'
);

assert(
  /已保留基本資料並停用登入、撤除角色與管理範圍/.test(deleteUserSource),
  'deleteUser must return a clear disabled-and-kept-history message'
);

assert(
  /name:\s*['"]user_roles['"][\s\S]*required:\s*true/.test(deleteUserSource),
  'deleteUser must include user_roles in the relation cleanup list'
);

assert(
  /name:\s*['"]store_managers['"][\s\S]*required:\s*true/.test(deleteUserSource),
  'deleteUser must include store_managers in the relation cleanup list'
);

assert(
  /name:\s*['"]store_employees['"][\s\S]*required:\s*false/.test(deleteUserSource),
  'deleteUser must treat legacy store_employees cleanup as optional'
);

assert(
  /name:\s*['"]collaborators['"][\s\S]*required:\s*false/.test(deleteUserSource),
  'deleteUser must treat legacy collaborators cleanup as optional'
);

assert(
  /PGRST205/.test(deleteUserSource) && /schema cache/.test(deleteUserSource),
  'deleteUser must ignore missing optional cleanup tables returned by PostgREST schema cache'
);

assert(
  /revalidatePath\(['"]\/admin\/users['"]\)/.test(deleteUserSource),
  'deleteUser must revalidate the user management page'
);

console.log('PASS admin user delete action static checks');
