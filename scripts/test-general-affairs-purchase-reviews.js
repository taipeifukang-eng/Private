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

const migrationPath = 'supabase/migrations/20260908093000_general_affairs_purchase_reviews.sql';
const rollbackPath = 'supabase/rollback_general_affairs_purchase_reviews.sql';
const accessPath = 'lib/general-affairs/purchase-reviews/access.ts';
const validationPath = 'lib/general-affairs/purchase-reviews/validation.ts';
const apiPath = 'app/api/general-affairs/requests/[id]/purchase-review/route.ts';
const receiptApiPath = 'app/api/general-affairs/requests/[id]/purchase-receipt/route.ts';
const costSummaryApiPath = 'app/api/general-affairs/purchase-reviews/cost-summary/route.ts';
const intakeClientPath = 'components/general-affairs/requests/ServiceRequestIntakeClient.tsx';
const specPath = 'docs/GENERAL-AFFAIRS-SERVICE-CENTER-SPEC.md';

[
  migrationPath,
  rollbackPath,
  accessPath,
  validationPath,
  apiPath,
  receiptApiPath,
  costSummaryApiPath,
  intakeClientPath,
  specPath,
].forEach((relativePath) => {
  assert(fs.existsSync(path.join(root, relativePath)), `missing file: ${relativePath}`);
});

const migration = read(migrationPath);
const rollback = read(rollbackPath);
const access = read(accessPath);
const validation = read(validationPath);
const api = read(apiPath);
const receiptApi = read(receiptApiPath);
const costSummaryApi = read(costSummaryApiPath);
const intakeClient = read(intakeClientPath);
const spec = read(specPath);

assertIncludes(spec, '### 4.3.2 添購 / 採購評估流程', 'spec documents purchase review flow');
assertIncludes(spec, '駁回。', 'spec includes reject decision');
assertIncludes(spec, '改由庫存出庫。', 'spec includes stock issue decision');
assertIncludes(spec, '改由調撥。', 'spec includes transfer decision');
assertIncludes(spec, '進入採購。', 'spec includes purchase decision');
assertIncludes(spec, '改用替代品。', 'spec includes substitute decision');

assertIncludes(migration, 'CREATE TABLE IF NOT EXISTS public.ga_purchase_reviews', 'migration creates purchase reviews table');
assertIncludes(migration, 'CREATE TABLE IF NOT EXISTS public.ga_purchase_review_quotes', 'migration creates purchase quote table');
assertIncludes(migration, "'general_affairs.purchase_review.view'", 'migration creates purchase review view permission');
assertIncludes(migration, "'general_affairs.purchase_review.manage'", 'migration creates purchase review manage permission');
assertIncludes(migration, "decision IN ('REJECT', 'STOCK_ISSUE', 'TRANSFER', 'PURCHASE', 'SUBSTITUTE')", 'migration constrains decisions');
assertIncludes(migration, 'vendor_id uuid REFERENCES public.ga_vendors(id)', 'migration links selected vendor');
assertIncludes(migration, 'receiving_location_id uuid REFERENCES public.ga_inventory_locations(id)', 'migration links planned receiving location');
assertIncludes(migration, 'uq_ga_purchase_reviews_request_active', 'migration enforces one active review per request');
assertIncludes(migration, 'ALTER TABLE public.ga_purchase_reviews ENABLE ROW LEVEL SECURITY', 'migration enables RLS');
assertIncludes(migration, "NOTIFY pgrst, 'reload schema'", 'migration reloads PostgREST schema');
assertIncludes(rollback, 'DROP TABLE IF EXISTS public.ga_purchase_review_quotes', 'rollback drops quote table');
assertIncludes(rollback, 'DROP TABLE IF EXISTS public.ga_purchase_reviews', 'rollback drops review table');

assertIncludes(access, 'canReadPurchaseReviews', 'access exposes read helper');
assertIncludes(access, 'canManagePurchaseReviews', 'access exposes manage helper');
assertIncludes(access, 'canManageServiceRequests', 'access falls back to existing request manage helper');

assertIncludes(validation, "PURCHASE_REVIEW_DECISIONS", 'validation centralizes decision list');
assertIncludes(validation, '進入採購時請填寫核准數量', 'validation requires approved quantity for purchase');
assertIncludes(validation, '改用替代品時請填寫替代品說明', 'validation requires substitute description');
assertIncludes(validation, '駁回時請填寫門市可見說明', 'validation requires public rejection note');

assertIncludes(api, "current.intake_route !== 'PURCHASE_REVIEW'", 'API requires purchase review route');
assertIncludes(api, 'PURCHASE_REVIEW_ALLOWED_STATUSES', 'API gates active request statuses');
assertIncludes(api, "decision: payload.decision", 'API persists decision');
assertIncludes(api, "from('ga_purchase_reviews')", 'API writes purchase review table');
assertIncludes(api, "from('ga_purchase_review_quotes')", 'API writes purchase quote table');
assertIncludes(api, "intake_route: 'STOCK_ISSUE'", 'API can redirect purchase review to stock issue');
assertIncludes(api, "intake_route: 'TRANSFER'", 'API can redirect purchase review to transfer');
assertIncludes(api, "event_type: 'PURCHASE_REVIEW_DECIDED'", 'API records service request event');
assertIncludes(api, "from('ga_vendors')", 'API loads vendor options');
assertIncludes(api, "from('ga_inventory_locations')", 'API loads planned receiving locations');

assertIncludes(receiptApi, 'canManagePurchaseReviews', 'receipt API checks purchase review manage permission');
assertIncludes(receiptApi, 'canPostInventoryTransactions', 'receipt API checks inventory transaction permission');
assertIncludes(receiptApi, "current.intake_route !== 'PURCHASE_REVIEW'", 'receipt API requires purchase review route');
assertIncludes(receiptApi, "review.decision !== 'PURCHASE'", 'receipt API requires purchase decision');
assertIncludes(receiptApi, "transactionType: 'RECEIPT'", 'receipt API forces receipt transaction type');
assertIncludes(receiptApi, "referenceType: 'GA_PURCHASE_REVIEW'", 'receipt API links transaction back to purchase review');
assertIncludes(receiptApi, "p_transaction_type: 'RECEIPT'", 'receipt API calls inventory posting RPC as receipt');
assertIncludes(receiptApi, "p_reference_type: 'GA_PURCHASE_REVIEW'", 'receipt API passes purchase review reference type to RPC');
assertIncludes(receiptApi, "event_type: 'PURCHASE_RECEIVED'", 'receipt API records service request event');
assertIncludes(api, '採購數量不可超過剩餘需求量', 'purchase API prevents quantities above the remaining fulfillment demand');
assertIncludes(receiptApi, '到貨數量不可超過剩餘需求量', 'receipt API prevents quantities above the remaining fulfillment demand');
assertIncludes(receiptApi, 'requestStoreConfirmation', 'receipt API can move request to store confirmation');

assertIncludes(costSummaryApi, 'canReadPurchaseReviews', 'cost summary API checks purchase review read permission');
assertIncludes(costSummaryApi, "from('ga_purchase_reviews')", 'cost summary API reads purchase reviews');
assertIncludes(costSummaryApi, "eq('decision', 'PURCHASE')", 'cost summary API only summarizes purchase decisions');
assertIncludes(costSummaryApi, 'topStores', 'cost summary API returns store ranking');
assertIncludes(costSummaryApi, 'topVendors', 'cost summary API returns vendor ranking');
assertIncludes(costSummaryApi, 'missingAmountCount', 'cost summary API reports missing purchase amounts');

assertIncludes(intakeClient, "type PurchaseReviewForm", 'intake client defines purchase review form');
assertIncludes(intakeClient, "type PurchaseReceiptForm", 'intake client defines purchase receipt form');
assertIncludes(intakeClient, "PURCHASE_REVIEW_DECISIONS", 'intake client renders decision controls');
assertIncludes(intakeClient, '採購資料', 'legacy purchase form remains available for migration compatibility');
assertIncludes(intakeClient, "`/api/general-affairs/requests/${selectedRequest.id}/purchase-review`", 'intake client calls purchase review API');
assertIncludes(intakeClient, "`/api/general-affairs/requests/${selectedRequest.id}/purchase-receipt`", 'intake client calls purchase receipt API');
assertIncludes(intakeClient, "selectedRequest.intake_route === 'PURCHASE_REVIEW'", 'intake client gates purchase review panel by route');
assertIncludes(intakeClient, "['ACCEPTED', 'IN_PROGRESS'].includes(selectedRequest.main_status)", 'intake client gates purchase review panel by status');
assertIncludes(intakeClient, '詢價 / 比價 / 議價備註', 'intake client supports quote notes');
assertIncludes(intakeClient, '供應商 / 廠商', 'intake client supports vendor selection');
assertIncludes(intakeClient, '預計入庫位置', 'intake client supports planned receiving location');
assertIncludes(intakeClient, 'purchaseCostSummary', 'intake client calculates purchase cost summary');
assertIncludes(intakeClient, '採購成本追蹤', 'intake client renders purchase cost tracking summary');
assertIncludes(intakeClient, '本月採購成本', 'intake client explains future monthly purchase cost tracking');
assertIncludes(intakeClient, '目前認列金額會依序採用實際採購、議價後、報價、預估金額', 'intake client explains cost recognition priority');
assertIncludes(intakeClient, '確認進入採購', 'intake client renders the plain-language purchase action');
assertIncludes(intakeClient, '採購到貨入庫', 'intake client renders purchase receipt panel');
assertIncludes(intakeClient, '確認入庫', 'intake client renders the plain-language receipt action');
assertIncludes(intakeClient, '入庫後送門市確認收貨或使用結果', 'intake client supports store confirmation after receipt');

console.log('General affairs purchase review static tests passed.');
