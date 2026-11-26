import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';

/**
 * 診所自費藥毛利：把「舊版」route / _lib 的原始碼原樣讀進來（不修改舊檔），取出裡面沒有 export 的私有函式，用來和新的共用純函式逐筆比對。
 * 做法：讀檔 -> 在檔尾附加 `module.exports.__t = {...}` -> TypeScript 轉成 CommonJS -> 以假的 next/server、supabase、權限模組執行。
 * 舊檔一行不改，所以「舊版行為不變」自動成立；新舊是否一致由呼叫端的比對決定。
 */
const ROOT = path.resolve(__dirname, '..', '..');
const realRequire = createRequire(path.join(ROOT, 'package.json'));

export type Stubs = Record<string, unknown>;

export function loadLegacyModule<T = any>(relPath: string, privateNames: string[], stubs: Stubs = {}): T {
  const file = path.join(ROOT, relPath);
  const source = fs.readFileSync(file, 'utf8') + `\n;module.exports.__t = { ${privateNames.join(', ')} };\n`;
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: false } }).outputText;
  const mod: { exports: any } = { exports: {} };
  const req = (id: string) => {
    for (const key of Object.keys(stubs)) if (id === key || id.endsWith(key)) return stubs[key];
    if (id === 'xlsx') return realRequire('xlsx');
    if (id === 'next/server') return { NextResponse: { json: () => ({}) }, NextRequest: class {} };
    if (id === '@/lib/supabase/server') return { createAdminClient: () => ({}), createClient: async () => ({}) };
    if (id === '@/lib/permissions/check') return { hasAnyPermission: async () => false };
    throw new Error(`舊版模組載入：未提供 ${id} 的替身（${relPath}）`);
  };
  new Function('module', 'exports', 'require', js)(mod, mod.exports, req);
  return mod.exports.__t as T;
}

export function legacyClaimParser() {
  return loadLegacyModule('app/api/clinic-selfpay/batches/import/route.ts', [
    'extractItems', 'buildRowDebugSample', 'parseClaimQty', 'parseCodeAndNameFromColA', 'parseClaimDrugName', 'parseClinicInfo', 'parsePeriod', 'parseClinicCodeFromRange', 'roundTo1', 'EXCLUDED_HEALTH_INSURANCE_CODES',
  ], { '../../_lib': loadLegacyModule('app/api/clinic-selfpay/_lib.ts', ['parseNumber', 'parseRocDateToIso', 'toYearMonth']) });
}

export function legacyLib() {
  return loadLegacyModule('app/api/clinic-selfpay/_lib.ts', ['parseNumber', 'parseRocDateToIso', 'toYearMonth', 'isStoreScopedJobTitle', 'isManagerJobTitle']);
}

export function legacyPriceParser() {
  return loadLegacyModule('app/api/clinic-selfpay/prices/import/route.ts', ['buildRecords', 'deduplicatePriceRecords', 'getCell', 'parseYearMonthSheetName'], {
    '../../_lib': loadLegacyModule('app/api/clinic-selfpay/_lib.ts', ['parseNumber']),
  });
}

export function legacyBatchDetail() {
  return loadLegacyModule('app/api/clinic-selfpay/batches/[id]/route.ts', ['roundTo1', 'parseScreenshotPaths'], { '../../_lib': {} });
}

/** 舊版 getClinicSelfpayAccess：以假資料庫與假權限驗證（permissions 是使用者擁有的權限碼，jobTitle 是 profiles.job_title）。 */
export async function legacyAccess(permissions: string[], jobTitle: string | null) {
  const set = new Set(permissions);
  const mod = loadLegacyModule<{ getClinicSelfpayAccess: (id: string) => Promise<any> }>('app/api/clinic-selfpay/_lib.ts', ['getClinicSelfpayAccess'], {
    '@/lib/supabase/server': {
      createAdminClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: 'member', job_title: jobTitle } }) }) }) }) }),
      createClient: async () => ({}),
    },
    '@/lib/permissions/check': { hasAnyPermission: async (_id: string, codes: string[]) => codes.some((c) => set.has(c)) },
  });
  return mod.getClinicSelfpayAccess('u');
}
