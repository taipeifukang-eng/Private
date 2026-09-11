const fs = require('fs');
const path = require('path');
const assert = require('assert');

const routePath = path.join(process.cwd(), 'app/api/inventory/result-analysis/route.ts');
const route = fs.readFileSync(routePath, 'utf8');

function assertIncludes(expected, label) {
  assert(route.includes(expected), `${label}: expected to include ${expected}`);
}

assertIncludes('function getInventoryResultCostBuckets(item: any)', 'merged cost bucket helper exists');
assertIncludes("if (item?.report_kind === 'MERGED')", 'cost bucket helper is scoped to merged view');
assertIncludes('differenceQty: Number(item?.difference_qty) || 0', 'merged summary uses final net difference');
assertIncludes('cost: Number(item?.cost) || 0', 'merged summary uses final net cost');
assertIncludes('initial_difference_qty: Number(item.difference_qty) || 0', 'initial merged rows preserve initial difference');
assertIncludes('initial_cost: Number(item.cost) || 0', 'initial merged rows preserve initial cost');
assertIncludes('recount_difference_qty: (Number(existing?.recount_difference_qty) || 0) + recountDifferenceQty', 'merged rows accumulate recount difference');
assertIncludes('recount_cost: (Number(existing?.recount_cost) || 0) + recountCost', 'merged rows accumulate recount cost');
assertIncludes('const costBuckets = getInventoryResultCostBuckets(item);', 'summary uses cost buckets');
assertIncludes('if (bucket.differenceQty > 0) current.positive_cost_total += bucket.cost;', 'category summary adds positive bucket costs separately');
assertIncludes('if (bucket.differenceQty < 0) current.negative_cost_total += bucket.cost;', 'category summary adds negative bucket costs separately');
assertIncludes('if (bucket.differenceQty > 0) nonExcludedSummary.positive_cost_total += bucket.cost;', 'dashboard summary adds positive bucket costs separately');
assertIncludes('if (bucket.differenceQty < 0) nonExcludedSummary.negative_cost_total += bucket.cost;', 'dashboard summary adds negative bucket costs separately');

const forbiddenMergedSummaryPatterns = [
  'differenceQty: Number(item.initial_difference_qty) || 0',
  'cost: Number(item.initial_cost) || 0',
  'differenceQty: Number(item.recount_difference_qty) || 0',
  'cost: Number(item.recount_cost) || 0',
  'if (differenceQty > 0) current.positive_cost_total += cost;',
  'if (differenceQty < 0) current.negative_cost_total += cost;',
  'if (differenceQty > 0) nonExcludedSummary.positive_cost_total += cost;',
  'if (differenceQty < 0) nonExcludedSummary.negative_cost_total += cost;',
];

for (const pattern of forbiddenMergedSummaryPatterns) {
  assert(!route.includes(pattern), `merged summary should not bucket net item cost directly: ${pattern}`);
}

const example = {
  initial: {
    product_code: '02000001',
    difference_qty: 1,
    cost: 600000,
  },
  recount: {
    product_code: '02000001',
    difference_qty: -1,
    cost: -600000,
  },
};
const expected = {
  row_count: 1,
  difference_qty: example.initial.difference_qty + example.recount.difference_qty,
  cost: example.initial.cost + example.recount.cost,
  positive_cost_total: 0,
  negative_cost_total: 0,
};
assert.strictEqual(expected.row_count, 1, 'merged duplicate recount row keeps one final item');
assert.strictEqual(expected.difference_qty, 0, 'merged recount can offset the initial difference');
assert.strictEqual(expected.cost, 0, 'merged recount can offset the initial cost');
assert.strictEqual(expected.positive_cost_total, 0, 'offset merged item should not remain in positive cost');
assert.strictEqual(expected.negative_cost_total, 0, 'offset merged item should not be counted as new negative cost');

console.log('Inventory result analysis merged summary static tests passed');
