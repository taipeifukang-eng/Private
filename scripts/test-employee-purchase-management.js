const fs = require('fs');
const path = require('path');

const root = process.cwd();
const files = {
  page: 'app/admin/employee-purchases/page.tsx',
  api: 'app/api/employee-purchases/route.ts',
  importApi: 'app/api/employee-purchases/import/route.ts',
  navbar: 'components/Navbar.tsx',
  permissions: 'hooks/useNavbarPermissions.ts',
  migration: 'supabase/migrations/20260914093000_employee_purchase_management.sql',
  summaryMigration: 'supabase/migrations/20260914094000_employee_purchase_summary_functions.sql',
};

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function assertIncludes(content, needle, message) {
  if (!content.includes(needle)) {
    throw new Error(message);
  }
}

const page = read(files.page);
const api = read(files.api);
const importApi = read(files.importApi);
const navbar = read(files.navbar);
const permissions = read(files.permissions);
const migration = read(files.migration);
const summaryMigration = read(files.summaryMigration);

assertIncludes(page, '員工購物管理', 'page should render employee purchase management title');
assertIncludes(page, 'type="month"', 'page should provide month selector');
assertIncludes(page, '/api/employee-purchases/import', 'page should call import API');
assertIncludes(page, '職稱金額彙總', 'page should show position summary');
assertIncludes(page, 'employee_position', 'page should display employee position');

assertIncludes(api, ".from('employee_purchase_sales')", 'query API should read employee purchase sales');
assertIncludes(api, 'summary_by_position', 'query API should return position summary');
assertIncludes(api, 'employee_purchase.view', 'query API should require employee purchase view/import permission');
assertIncludes(api, "rpc('employee_purchase_position_summary'", 'query API should use DB-side position summary');
assertIncludes(api, "rpc('employee_purchase_month_stats'", 'query API should use DB-side monthly stats');
assertIncludes(api, '.limit(500)', 'query API should limit detail rows');
if (api.includes('function fetchAllPurchases') || api.includes('while (true)')) {
  throw new Error('query API must not fetch all purchase rows in Node');
}

assertIncludes(importApi, 'GridBand1', 'import API should document first invalid GridBand row behavior');
assertIncludes(importApi, 'rawRows[1]', 'import API should use second row as headers');
assertIncludes(importApi, 'monthly_staff_status', 'import API should match monthly staff status');
assertIncludes(importApi, 'employee_purchase.import', 'import API should require import permission');
assertIncludes(importApi, ".delete()", 'import API should replace same-month detail rows');

assertIncludes(navbar, '/admin/employee-purchases', 'navbar should link employee purchase management');
assertIncludes(navbar, '員工購物管理', 'navbar should show employee purchase label');
assertIncludes(permissions, 'canManageEmployeePurchases', 'navbar permissions should include employee purchase flag');
assertIncludes(permissions, 'employee_purchase.view', 'navbar permissions should check employee purchase view');

assertIncludes(migration, 'employee_purchase_import_batches', 'migration should create import batch table');
assertIncludes(migration, 'employee_purchase_sales', 'migration should create sales detail table');
assertIncludes(migration, 'employee_purchase.view', 'migration should create view permission');
assertIncludes(migration, 'employee_purchase.import', 'migration should create import permission');
assertIncludes(summaryMigration, 'employee_purchase_position_summary', 'summary migration should create position summary RPC');
assertIncludes(summaryMigration, 'position_name text', 'summary RPC should avoid reserved output name position');
assertIncludes(summaryMigration, 'employee_purchase_month_stats', 'summary migration should create month stats RPC');
assertIncludes(summaryMigration, "public.has_permission(auth.uid(), 'employee_purchase.view')", 'summary RPC should enforce view permission');

console.log('employee purchase management checks passed');
