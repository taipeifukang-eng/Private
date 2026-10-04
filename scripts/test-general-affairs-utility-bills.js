#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const migration = read('supabase/migrations/20260925103000_general_affairs_utility_bills.sql');
const route = read('app/api/general-affairs/utility-bills/route.ts');
const itemRoute = read('app/api/general-affairs/utility-bills/[id]/route.ts');
const client = read('components/general-affairs/expenses/UtilityBillsClient.tsx');
const reportClient = read('components/general-affairs/expenses/UtilityBillsReportClient.tsx');
const reportRoute = read('app/api/general-affairs/utility-bills/report/route.ts');
const navigation = read('components/general-affairs/navigation.tsx');
const permissions = read('hooks/useNavbarPermissions.ts');
const electricityMigration = read('supabase/migrations/20260925110000_general_affairs_utility_bill_electricity_usage.sql');
const identifierMigration = read('supabase/migrations/20260926090000_general_affairs_utility_bill_identifiers.sql');
const multipleLinesMigration = read('supabase/migrations/20260926093000_general_affairs_internet_multiple_lines.sql');
const attachmentMigration = read('supabase/migrations/20260926100000_general_affairs_utility_bill_attachments.sql');
const attachmentRoute = read('app/api/general-affairs/attachments/route.ts');
const attachmentItemRoute = read('app/api/general-affairs/attachments/[id]/route.ts');
const attachmentPanel = read('components/general-affairs/attachments/ResourceAttachmentPanel.tsx');

[
  'general_affairs.utility_bill.view',
  'general_affairs.utility_bill.manage',
  'ga_utility_bills',
  "'WATER', 'ELECTRICITY', 'PHONE', 'INTERNET'",
  'billing_month', 'amount NUMERIC(12,2)', 'due_date', 'paid_at',
  'uq_ga_utility_bills_identity', 'ENABLE ROW LEVEL SECURITY',
  'DROP POLICY IF EXISTS ga_utility_bills_read',
  'DROP POLICY IF EXISTS ga_utility_bills_insert',
  'DROP POLICY IF EXISTS ga_utility_bills_update',
  'current_user_manages_store', "NOTIFY pgrst, 'reload schema'",
].forEach((needle) => assert(migration.includes(needle), `utility migration missing ${needle}`));

assert(route.includes('canViewUtilityBills()') && route.includes('canManageUtilityBills()'), 'utility collection API must enforce view/manage permissions');
assert(itemRoute.includes('canManageUtilityBills()'), 'utility item API must enforce manage permission');
assert(itemRoute.includes('deleted_at') && !itemRoute.includes('.delete()'), 'utility delete must be soft delete');
['本月費用', '待繳費', '已逾期', '水費', '電費', '電話費', '網路費', '標記已繳'].forEach((needle) => assert(client.includes(needle), `utility UI missing ${needle}`));
assert(navigation.includes("href: '/general-affairs/utility-bills'"), 'utility navigation entry missing');
assert(permissions.includes('canAccessGeneralAffairsUtilities'), 'utility navbar permission flag missing');
assert(electricityMigration.includes('ADD COLUMN IF NOT EXISTS electricity_kwh NUMERIC(12,2)'), 'electricity usage forward migration missing');
assert(electricityMigration.includes("expense_type = 'ELECTRICITY'"), 'electricity usage must only apply to electricity bills');
assert(route.includes('electricity_kwh: expenseType === \'ELECTRICITY\''), 'utility API must discard electricity usage for other bill types');
assert(client.includes('用電度數（kWh）') && client.includes("row.amount / Number(row.electricity_kwh)"), 'utility UI must capture usage and show average cost per kWh');
assert(identifierMigration.includes('ADD COLUMN IF NOT EXISTS service_identifier TEXT'), 'service identifier forward migration missing');
assert(identifierMigration.includes('ADD COLUMN IF NOT EXISTS equipment_serial TEXT'), 'network equipment serial forward migration missing');
assert(identifierMigration.includes('COALESCE(service_identifier, equipment_serial, account_number'), 'bill identity must prefer circuit, then equipment, then account identifiers');
assert(route.includes('service_identifier: serviceIdentifier') && route.includes('equipment_serial: equipmentSerial'), 'utility API must persist identifiers safely');
['電號', '水號', '電話號碼／用戶號碼', '電路編號／用戶號碼', '網路設備序號', '本期帳單／銷帳編號'].forEach((needle) => assert(client.includes(needle), `utility identifier UI missing ${needle}`));
assert(multipleLinesMigration.includes('ADD COLUMN IF NOT EXISTS service_label TEXT'), 'internet line label forward migration missing');
assert(multipleLinesMigration.includes('COALESCE(service_identifier, equipment_serial, account_number'), 'internet bill identity must support multiple modems');
assert(route.includes('網路費請至少填寫電路編號或設備序號'), 'internet bill API must require a circuit or modem identifier');
assert(client.includes('線路／數據機名稱') && client.includes('電路編號與設備序號至少填一項'), 'internet form must clearly support multiple modem lines');
assert(attachmentMigration.includes("'UTILITY_BILL'"), 'attachment resource constraint must allow utility bills');
assert(attachmentPanel.includes("| 'UTILITY_BILL'"), 'shared attachment panel must accept utility bills');
assert(attachmentRoute.includes("resourceType === 'UTILITY_BILL'") && attachmentRoute.includes('canViewUtilityBills()') && attachmentRoute.includes('canManageUtilityBills()'), 'utility attachments must enforce utility permissions');
assert(attachmentItemRoute.includes("attachment?.resource_type === 'UTILITY_BILL'") && attachmentItemRoute.includes('canManageUtilityBills()'), 'utility attachment deletion must enforce utility manage permission');
assert(client.includes('resourceType="UTILITY_BILL"') && client.includes('uploadButtonLabel="上傳掃描檔／照片"'), 'utility UI must expose bill scans and photos');
assert(client.includes('capture="environment"') && client.includes('直接拍照'), 'utility create form must support taking a bill photo');
assert(client.includes('pendingFiles.forEach') && client.includes("attachments.set('resource_id', result.data.id)"), 'new utility attachments must upload after the bill record exists');
assert(client.includes('附件尚未上傳') && client.includes('setAttachmentBill(result.data)'), 'failed create-time attachment upload must preserve the bill and offer retry');
assert(reportRoute.includes('canViewUtilityBills()') && reportRoute.includes(".gte('billing_month', start)") && reportRoute.includes(".lt('billing_month', end)"), 'utility report API must enforce view access and query the selected period');
assert(reportRoute.includes(".range(offset, offset + pageSize - 1)") && reportRoute.includes('totalsByLocation'), 'utility report API must aggregate all bill pages by location');
['水費', '電費', '電話費', '網路費', '各據點費用明細', "['month', '月']", "['quarter', '季']", "['year', '年']"].forEach((needle) => assert(reportClient.includes(needle), `utility report UI missing ${needle}`));
assert(navigation.includes("href: '/general-affairs/utility-bills/report'"), 'utility report navigation entry missing');

console.log('General affairs utility bill checks passed.');
