import type { APIRequestContext } from '@playwright/test';
import { clinicFixture, TINY_PNG } from './clinic-selfpay-fixtures';
import { adminDb } from './m6-fixtures';

/** 診所自費藥毛利 API 測試共用：組表單、呼叫新舊 API、讀資料表。表單用標準 FormData（Playwright multipart 可直接接）。 */
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const NEW = '/api/workspace/clinic-selfpay';
export const OLD = '/api/clinic-selfpay';

export type Shot = { name: string; type: string; buffer: Buffer };
/** 每張截圖內容不同（尾端附加序號），避免被誤認為同一檔。 */
export const shot = (n = 1, type = 'image/png'): Shot => ({ name: `shot-${n}.${type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : type === 'image/jpeg' ? 'jpg' : 'gif'}`, type, buffer: Buffer.concat([TINY_PNG, Buffer.from(`-${n}`)]) });
export const shots = (n: number) => Array.from({ length: n }, (_, i) => shot(i + 1));

export function claimForm(o: { store: string; month: string; fixture: string; fileName: string; shots?: Shot[]; flags?: Record<string, string>; legacyField?: boolean }): FormData {
  const fd = new FormData();
  fd.append('store_id', o.store);
  fd.append('year_month', o.month);
  fd.append('file', new Blob([new Uint8Array(clinicFixture(o.fixture))], { type: XLSX_MIME }), o.fileName);
  for (const s of o.shots ?? [shot(1)]) fd.append(o.legacyField ? 'screenshots' : 'screenshots', new Blob([new Uint8Array(s.buffer)], { type: s.type }), s.name);
  for (const [k, v] of Object.entries(o.flags || {})) fd.append(k, v);
  return fd;
}
export function priceForm(o: { store: string; month: string; fixture: string; fileName: string }): FormData {
  const fd = new FormData();
  fd.append('store_id', o.store);
  fd.append('year_month', o.month);
  fd.append('file', new Blob([new Uint8Array(clinicFixture(o.fixture))], { type: XLSX_MIME }), o.fileName);
  return fd;
}
export type Res = { status: number; body: any };
export async function send(api: APIRequestContext, method: 'get' | 'post' | 'delete', url: string, opt?: { multipart?: FormData; data?: unknown; params?: Record<string, string> }): Promise<Res> {
  const res = await api[method](url, opt as any);
  return { status: res.status(), body: await res.json().catch(() => ({})) };
}

export const db = () => adminDb();
export const batchesOf = async (storeId: string, fileLike = 'm6w30-%') => ((await db().from('clinic_selfpay_claim_batches').select('*').eq('store_id', storeId).like('source_file_name', fileLike).order('imported_at')).data || []) as any[];
export const itemsOf = async (batchId: string) => ((await db().from('clinic_selfpay_claim_items').select('*').eq('batch_id', batchId).order('line_no')).data || []) as any[];
export const pricesOf = async (storeId: string, month: string) => ((await db().from('clinic_selfpay_price_entries').select('*').eq('store_id', storeId).eq('year_month', month).order('health_insurance_code')).data || []) as any[];
export const screenshotPaths = (raw: unknown): string[] => {
  const v = String(raw || '').trim();
  if (!v) return [];
  try {
    const a = JSON.parse(v);
    if (Array.isArray(a)) return a.map(String);
  } catch { /* 單張 */ }
  return [v];
};
export async function objectExists(path: string): Promise<boolean> {
  const dir = path.split('/').slice(0, -1).join('/');
  const name = path.split('/').pop()!;
  const l = await db().storage.from('clinic-selfpay-screenshots').list(dir, { limit: 1000 });
  return (l.data || []).some((o: any) => o.name === name);
}
export async function countObjects(storeId: string, month: string): Promise<number> {
  return ((await db().storage.from('clinic-selfpay-screenshots').list(`${storeId}/${month}`, { limit: 1000 })).data || []).length;
}
