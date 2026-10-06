const fs = require('fs');
const path = require('path');
const assert = require('assert');

const read = (relativePath) => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

const performancePage = read('app/admin/performance/page.tsx');
const importRoute = read('app/api/performance-bonus/import/route.ts');
const monthlyDetailsRoute = read('app/api/monthly-status/bonus-details/route.ts');
const quarterlySummaryRoute = read('app/api/monthly-status/bonus-quarter-summary/route.ts');
const averagesRoute = read('app/api/performance-bonus/averages/route.ts');
const monthlyStatusPage = read('app/monthly-status/page.tsx');
const migration = read('supabase/migrations/20261006100000_add_brand_bonus_to_monthly_bonus_records.sql');

const pageBonusColumns = performancePage.slice(
  performancePage.indexOf('const BONUS_COLS'),
  performancePage.indexOf('function getStoreInfo')
);
assert(
  pageBonusColumns.indexOf("key: 'single_item_bonus'") < pageBonusColumns.indexOf("key: 'brand_bonus'") &&
    pageBonusColumns.indexOf("key: 'brand_bonus'") < pageBonusColumns.indexOf("key: 'inventory_diff_penalty'"),
  'brand bonus must appear after single-item bonus and before inventory discrepancy'
);

assert(importRoute.includes("brand_bonus:            ['品牌獎金', 'brand_bonus']"), 'import route must accept the brand bonus column');
assert(importRoute.includes('brand_bonus:            getNumOptional(row, COL.brand_bonus)'), 'import route must parse brand bonus values');
assert(importRoute.includes("  'brand_bonus',"), 'import merge must preserve existing brand bonus when the column is absent');
assert(importRoute.includes('        brand_bonus,'), 'existing-row lookup must select brand bonus for merge updates');
assert(monthlyDetailsRoute.includes('brand_bonus: Number(row.brand_bonus) || 0'), 'monthly bonus detail must return brand bonus');
assert(quarterlySummaryRoute.includes("  'brand_bonus',"), 'quarter summary must total brand bonus');
assert(averagesRoute.includes("  'brand_bonus',"), 'brand bonus must count as a non-zero bonus record');
assert(averagesRoute.includes('function getSingleItemBonusTotal'), 'single-item report must have a combined bonus calculation');
assert((averagesRoute.match(/singleItemTotal \+= getSingleItemBonusTotal\(row\)/g) || []).length === 2, 'both average modes must include brand bonus in single-item totals');
assert(averagesRoute.includes("single_item: 'single_item_bonus + brand_bonus'"), 'API formula must document brand bonus inclusion');
assert(performancePage.includes('平均每人單品獎金（含品牌）/ 月'), 'average report label must clarify brand bonus inclusion');
assert(monthlyStatusPage.includes("{ key: 'brand_bonus', label: '品牌獎金' }"), 'monthly status detail must label brand bonus');
assert(migration.includes('ADD COLUMN IF NOT EXISTS brand_bonus numeric(12,2) DEFAULT 0'), 'migration must add brand bonus storage');

console.log('performance brand bonus import checks passed');
