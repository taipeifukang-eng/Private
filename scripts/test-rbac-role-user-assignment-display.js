const fs = require('fs');
const path = require('path');

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function assertIncludes(content, expected, label) {
  if (!content.includes(expected)) {
    throw new Error(`${label}: missing ${expected}`);
  }
}

function run() {
  const api = read('app/api/roles/[id]/users/route.ts');
  const client = read('app/admin/roles/[id]/RoleEditClient.tsx');

  assertIncludes(
    api,
    "select('id, email, full_name, employee_code, department, job_title, role')",
    'role user API must load profile fields managed by user management'
  );
  assertIncludes(api, 'department: profile?.department', 'role user API must return department');
  assertIncludes(api, 'job_title: profile?.job_title', 'role user API must return job_title');
  assertIncludes(api, 'profile_role: profile?.role', 'role user API must return legacy profile role label source');
  assertIncludes(
    api,
    'name: profile?.full_name || employee?.employee_name ||',
    'role user API must display profiles.full_name before store_employees.employee_name'
  );
  assertIncludes(
    api,
    'employee_name: row.full_name || existing?.employee_name || row.email || normalizedCode',
    'role assignment API duplicate/skip messages must prefer profiles.full_name'
  );

  assertIncludes(client, 'department: string;', 'role user UI type must include department');
  assertIncludes(client, 'job_title: string;', 'role user UI type must include job_title');
  assertIncludes(client, 'profile_role:', 'role user UI type must include account identity');
  assertIncludes(client, '帳號身分', 'role user table must show account identity');
  assertIncludes(client, '角色狀態', 'role user table must distinguish assignment status');
  assertIncludes(client, 'getProfileRoleLabel', 'role user table must label admin/manager/member');

  console.log('PASS role user assignment API includes user management fields');
  console.log('PASS role user assignment API prefers profiles.full_name for displayed name');
  console.log('PASS role user assignment table shows department and job title');
  console.log('PASS role user assignment table separates account identity from assignment status');
}

run();
