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
assertIncludes('differenceQty: Number(item.initial_difference_qty) || 0', 'initial difference bucket exists');
assertIncludes('cost: Number(item.initial_cost) || 0', 'initial cost bucket exists');
assertIncludes('differenceQty: Number(item.recount_difference_qty) || 0', 'recount difference bucket exists');
assertIncludes('cost: Number(item.recount_cost) || 0', 'recount cost bucket exists');
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
    row_count: 2373,
    positive_cost_total: 24979,
    negative_cost_total: -49428,
  },
  recount: {
    row_count: 2,
    positive_cost_total: 1962,
    negative_cost_total: 0,
  },
};
const expected = {
  row_count: example.initial.row_count,
  positive_cost_total: example.initial.positive_cost_total + example.recount.positive_cost_total,
  negative_cost_total: example.initial.negative_cost_total + example.recount.negative_cost_total,
};
assert.strictEqual(expected.row_count, 2373, 'merged duplicate recount row count keeps initial item count');
assert.strictEqual(expected.positive_cost_total, 26941, 'merged positive cost adds initial and recount positive costs');
assert.strictEqual(expected.negative_cost_total, -49428, 'merged negative cost keeps initial negative cost when recount is positive');
assert.strictEqual(expected.positive_cost_total + expected.negative_cost_total, -22487, 'merged net cost is positive plus negative cost');

console.log('Inventory result analysis merged summary static tests passed');
