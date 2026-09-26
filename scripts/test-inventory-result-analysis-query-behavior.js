const fs = require('fs');
const path = require('path');
const assert = require('assert');

const pagePath = path.join(process.cwd(), 'app/inventory/page.tsx');
const routePath = path.join(process.cwd(), 'app/api/inventory/result-analysis/route.ts');
const page = fs.readFileSync(pagePath, 'utf8');
const route = fs.readFileSync(routePath, 'utf8');

assert(page.includes('const [analysisHasLoaded, setAnalysisHasLoaded] = useState(false);'), 'page should track whether analysis has been manually loaded');
assert(page.includes('進入報表時不會自動載入資料，可先切換月份再查詢。'), 'page should explain manual query behavior');
assert(!/useEffect\(\(\) => \{\s*if \(activeSection === 'analysis'\) \{\s*loadInventoryResultAnalysis\(''\);/s.test(page), 'page must not auto-load current month when opening analysis tab');
assert(page.includes('setAnalysisHasLoaded(true);'), 'manual load should mark analysis as loaded');
assert(page.includes('setAnalysisHasLoaded(false);'), 'clear action should return to initial query state');

assert(route.includes('const batchSummaries = shouldLoadBatchDetails'), 'API should only load batch summaries when details are requested');
assert(route.includes(': new Map<string, ReturnType<typeof getNonExcludedDiffSummary>>();'), 'API list mode should skip item summary scans');
assert(!/const batchSummaries = await fetchNonExcludedDiffSummariesForBatches\(/.test(route), 'API must not always scan item summaries for batch list');

console.log('Inventory result analysis query behavior static tests passed');
