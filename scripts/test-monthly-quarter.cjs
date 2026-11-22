const fs=require('fs'),ts=require('typescript'),assert=require('assert');
require.extensions['.ts']=(m,file)=>m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,file);
const {monthlyQuarterSummary}=require('../lib/workspace/monthly-quarter.ts');
const rows=[7,8,9].map(month=>({month,business_days:30,monthly_gross_profit_target:300000,monthly_gross_profit_actual:330000,monthly_revenue_target:1000000,monthly_revenue_actual:1100000,monthly_customer_count_target:100,monthly_customer_count_actual:110,last_month_rx_target:100,last_month_rx_actual:110}));
const a=monthlyQuarterSummary('2026-08',rows),b=monthlyQuarterSummary('2026-09',rows);
assert.deepStrictEqual(a.months,[7,8,9]);assert.strictEqual(a.quarterlyResult.quarterlyGpTarget,900000);assert.strictEqual(a.quarterlyResult.quarterlyGpActual,660000);assert.strictEqual(a.monthlyBonuses[2],null);assert.strictEqual(b.quarterlyResult.quarterlyGpActual,990000);
assert.strictEqual(monthlyQuarterSummary('2026-01',[]).quarterNumber,1);assert.strictEqual(monthlyQuarterSummary('2026-12',[]).quarterNumber,4);assert.strictEqual(monthlyQuarterSummary('2026-12',[]).quarterlyResult,null);
const defaults=require('../lib/performance/bonus-calc.ts');const custom=defaults.QUARTERLY_THRESHOLDS.map(t=>({...t,baseAmount:7777}));assert.strictEqual(monthlyQuarterSummary('2026-09',rows,undefined,custom).quarterlyResult.thresholdBaseAmount,7777);
console.log('Quarter boundaries, full targets, actual cutoff, empty state, custom thresholds PASS');
