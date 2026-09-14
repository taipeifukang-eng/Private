const fs = require('fs');
const path = require('path');

const root = process.cwd();
const files = {
  page: 'app/admin/employee-purchases/page.tsx',
  api: 'app/api/employee-purchases/route.ts',
  detailApi: 'app/api/employee-purchases/employee-details/route.ts',
  importApi: 'app/api/employee-purchases/import/route.ts',
  navbar: 'components/Navbar.tsx',
  permissions: 'hooks/useNavbarPermissions.ts',
  migration: 'supabase/migrations/20260914093000_employee_purchase_management.sql',
  summaryMigration: 'supabase/migrations/20260914094000_employee_purchase_summary_functions.sql',
  employeeSummaryRepairMigration: 'supabase/migrations/20260914095000_employee_purchase_employee_summary_rpc.sql',
  positionFilterOptimizationMigration: 'supabase/migrations/20260914103000_optimize_employee_purchase_position_filter.sql',
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
const detailApi = read(files.detailApi);
const importApi = read(files.importApi);
const navbar = read(files.navbar);
const permissions = read(files.permissions);
const migration = read(files.migration);
const summaryMigration = read(files.summaryMigration);
const employeeSummaryRepairMigration = read(files.employeeSummaryRepairMigration);
const positionFilterOptimizationMigration = read(files.positionFilterOptimizationMigration);

assertIncludes(page, '員工購物管理', 'page should render employee purchase management title');
assertIncludes(page, 'type="month"', 'page should provide month selector');
assertIncludes(page, '/api/employee-purchases/import', 'page should call import API');
assertIncludes(page, '職稱金額彙總', 'page should show position summary');
assertIncludes(page, 'employee_position', 'page should display employee position');
assertIncludes(page, '員工消費彙總', 'page should show employee-level purchase summary');
assertIncludes(page, 'recognized_store_code', 'page should display recognized employee store');
assertIncludes(page, 'purchase_count', 'page should display purchase count per employee');
assertIncludes(page, 'loadEmployeeDetails(row)', 'page should load details when clicking employee row');
assertIncludes(page, '/api/employee-purchases/employee-details', 'page should call employee detail API');
assertIncludes(page, "credentials: 'include'", 'page fetches should explicitly include auth cookies');
assertIncludes(page, '購買商品明細', 'page should render employee purchase detail panel');
assertIncludes(page, 'setIsEmployeeSummaryCollapsed(true)', 'page should collapse employee summary after selecting an employee');
assertIncludes(page, '展開彙總', 'page should allow expanding collapsed employee summary');
assertIncludes(page, 'toggleEmployeeSummarySort', 'page should support sortable employee summary columns');
assertIncludes(page, "direction: 'desc'", 'employee summary sorting should start with descending order');
assertIncludes(page, "direction: 'asc'", 'employee summary sorting should toggle to ascending order');
assertIncludes(page, 'renderSortHeader', 'page should render clickable employee summary sort headers');
assertIncludes(page, 'purchase_store_code', 'page should display purchase store in details');
assertIncludes(page, 'product_name', 'page should display purchased product name in details');
assertIncludes(page, '毛利加總', 'page should show gross profit total for employee detail rows');
assertIncludes(page, 'detail.gross_profit', 'page should display gross profit for each purchased product detail');

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
if (page.includes('setRows([]);') && page.includes("setMessage({ type: 'error', text });")) {
  throw new Error('page should not clear existing purchase rows when a filtered refresh fails');
}

assertIncludes(detailApi, ".from('employee_purchase_sales')", 'detail API should read purchase sales rows');
assertIncludes(detailApi, 'product_name', 'detail API should return product names');
assertIncludes(detailApi, 'purchase_store_code', 'detail API should aggregate by purchase store');
assertIncludes(detailApi, 'quantity', 'detail API should return purchased quantity');
assertIncludes(detailApi, 'gross_profit', 'detail API should return purchased gross profit');
assertIncludes(detailApi, 'total_amount', 'detail API should return purchased amount');
assertIncludes(detailApi, 'employee_purchase.view', 'detail API should require employee purchase permission');

assertIncludes(importApi, 'GridBand1', 'import API should document first invalid GridBand row behavior');
assertIncludes(importApi, 'rawRows[1]', 'import API should use second row as headers');
assertIncludes(importApi, 'monthly_staff_status', 'import API should match monthly staff status');
assertIncludes(importApi, 'employee_purchase.import', 'import API should require import permission');
assertIncludes(importApi, ".delete()", 'import API should replace same-month detail rows');
assertIncludes(importApi, 'isTotalRow', 'import API should exclude POS total rows');
assertIncludes(importApi, '合計', 'import API should recognize POS total row labels');
assertIncludes(importApi, '!isTotalRow(row)', 'import API should filter total rows before importing');

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
assertIncludes(positionFilterOptimizationMigration, 'idx_employee_purchase_sales_month_position_staff', 'position filter optimization should add month/position index');
assertIncludes(positionFilterOptimizationMigration, 'v_allowed boolean', 'position filter optimization should check permissions once per RPC call');
assertIncludes(positionFilterOptimizationMigration, 'LANGUAGE plpgsql', 'position filter optimization should use plpgsql branch queries');
assertIncludes(positionFilterOptimizationMigration, "sales.employee_position = v_position", 'position filter optimization should use direct position predicate');
assertIncludes(positionFilterOptimizationMigration, "NOTIFY pgrst, 'reload schema'", 'position filter optimization should reload PostgREST schema cache');

console.log('employee purchase management checks passed');
