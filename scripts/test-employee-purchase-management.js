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
  employeeSummaryRepairMigration: 'supabase/migrations/20260914095000_employee_purchase_employee_summary_rpc.sql',
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
const employeeSummaryRepairMigration = read(files.employeeSummaryRepairMigration);

assertIncludes(page, '員工購物管理', 'page should render employee purchase management title');
assertIncludes(page, 'type="month"', 'page should provide month selector');
assertIncludes(page, '/api/employee-purchases/import', 'page should call import API');
assertIncludes(page, '職稱金額彙總', 'page should show position summary');
assertIncludes(page, 'employee_position', 'page should display employee position');
assertIncludes(page, '員工消費彙總', 'page should show employee-level purchase summary');
assertIncludes(page, 'recognized_store_code', 'page should display recognized employee store');
assertIncludes(page, 'purchase_count', 'page should display purchase count per employee');

assertIncludes(api, 'summary_by_position', 'query API should return position summary');
assertIncludes(api, 'employee_purchase.view', 'query API should require employee purchase view/import permission');
assertIncludes(api, "rpc('employee_purchase_position_summary'", 'query API should use DB-side position summary');
assertIncludes(api, "rpc('employee_purchase_month_stats'", 'query API should use DB-side monthly stats');
assertIncludes(api, "rpc('employee_purchase_employee_summary'", 'query API should use DB-side employee summary rows');
if (api.includes('function fetchAllPurchases') || api.includes('while (true)')) {
  throw new Error('query API must not fetch all purchase rows in Node');
}
if (api.includes('product_name') || api.includes('sale_sequence')) {
  throw new Error('query API should not return product or invoice-level detail rows');
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
assertIncludes(summaryMigration, 'employee_purchase_employee_summary', 'summary migration should create employee summary RPC');
assertIncludes(summaryMigration, 'recognized_store_code', 'employee summary should include recognized employee store');
assertIncludes(summaryMigration, 'matched_staff_status_id', 'employee summary should use matched monthly staff status for recognized store');
assertIncludes(summaryMigration, "public.has_permission(auth.uid(), 'employee_purchase.view')", 'summary RPC should enforce view permission');
assertIncludes(employeeSummaryRepairMigration, 'employee_purchase_employee_summary', 'repair migration should create employee summary RPC');
assertIncludes(employeeSummaryRepairMigration, "GRANT EXECUTE ON FUNCTION public.employee_purchase_employee_summary(text, text)", 'repair migration should grant employee summary RPC');
assertIncludes(employeeSummaryRepairMigration, "NOTIFY pgrst, 'reload schema'", 'repair migration should reload PostgREST schema cache');

console.log('employee purchase management checks passed');
