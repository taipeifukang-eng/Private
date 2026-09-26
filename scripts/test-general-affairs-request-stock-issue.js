const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function assertIncludes(content, expected, label) {
  assert(content.includes(expected), `${label}: expected to include ${expected}`);
}

const apiPath = 'app/api/general-affairs/requests/[id]/stock-issue/route.ts';
const intakeClientPath = 'components/general-affairs/requests/ServiceRequestIntakeClient.tsx';
const requestActionApiPath = 'app/api/general-affairs/requests/[id]/route.ts';
const executionPanelPath = 'components/general-affairs/parts/PartFulfillmentExecutionPanel.tsx';

[apiPath, intakeClientPath, requestActionApiPath].forEach((relativePath) => {
  assert(fs.existsSync(path.join(root, relativePath)), `missing file: ${relativePath}`);
});

const api = read(apiPath);
const intakeClient = read(intakeClientPath);
const requestActionApi = read(requestActionApiPath);
const executionPanel = read(executionPanelPath);

assertIncludes(requestActionApi, "STOCK_ISSUE: '庫存出庫'", 'request action route keeps stock issue intake route label');
assertIncludes(requestActionApi, "if (route === 'STOCK_ISSUE') return '需求已受理，目前由總務評估庫存出庫處理中。'", 'request progress mentions stock issue processing');

assertIncludes(api, 'canManagePartFulfillments', 'stock issue API checks part fulfillment manage permission');
assertIncludes(api, 'canPostInventoryTransactions', 'stock issue API checks inventory transaction permission');
assertIncludes(api, '出庫數量不可超過剩餘需求量', 'stock issue API prevents over-fulfillment');
assertIncludes(api, "current.intake_route !== 'STOCK_ISSUE'", 'stock issue API requires stock issue intake route');
assertIncludes(api, "STOCK_ISSUE_ALLOWED_STATUSES", 'stock issue API limits actionable request statuses');
assertIncludes(api, "transactionType: 'ISSUE'", 'stock issue API forces issue transaction type');
assertIncludes(api, "referenceType: 'GA_SERVICE_REQUEST'", 'stock issue API links transaction back to service request');
assertIncludes(api, "p_transaction_type: 'ISSUE'", 'stock issue API calls inventory posting RPC as issue');
assertIncludes(api, "p_reference_type: 'GA_SERVICE_REQUEST'", 'stock issue API passes service request reference type to RPC');
assertIncludes(api, "event_type: 'STOCK_ISSUED'", 'stock issue API records service request event');
assertIncludes(api, "title: '需求單庫存出庫'", 'stock issue API records event title');
assertIncludes(api, "main_status: 'IN_PROGRESS'", 'stock issue API keeps request in processing after issue');

assertIncludes(intakeClient, "type StockIssueForm", 'intake client defines stock issue form');
assertIncludes(intakeClient, "fetch('/api/general-affairs/inventory/options')", 'intake client loads inventory options');
assertIncludes(intakeClient, "`/api/general-affairs/requests/${selectedRequest.id}/stock-issue`", 'intake client posts service request stock issue');
assertIncludes(intakeClient, 'showStockIssuePanel', 'intake client gates stock issue panel');
assertIncludes(intakeClient, "selectedRequest.intake_route === 'STOCK_ISSUE'", 'intake client only shows stock issue panel for stock issue route');
assertIncludes(intakeClient, "['ACCEPTED', 'IN_PROGRESS'].includes(selectedRequest.main_status)", 'intake client only shows stock issue panel for active requests');
assertIncludes(intakeClient, '需求單庫存出庫', 'intake client renders stock issue panel title');
assertIncludes(intakeClient, '目前庫存量', 'intake client shows current balance before issuing');
assertIncludes(executionPanel, '確認出庫', 'part fulfillment center renders stock issue submit button');
assertIncludes(intakeClient, 'idempotencyKey: newIdempotencyKey()', 'intake client generates idempotency key');

console.log('General affairs request stock issue wiring checks passed.');
