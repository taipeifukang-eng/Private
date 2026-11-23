import type { APIRequestContext } from '@playwright/test';
import { clinicFixture, TINY_PNG } from './clinic-selfpay-fixtures';
import { adminDb } from './m6-fixtures';

/** 診所自費藥毛利 API 測試共用：組表單、呼叫新舊 API、讀資料表。表單用標準 FormData（Playwright multipart 可直接接）。 */
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const NEW = '/api/workspace/clinic-selfpay';
export const OLD = '/api/clinic-selfpay';

export type Shot = { name: string; type: string; buffer: Buffer };
/** 每張截圖內容不同（尾端附加序號），避免被誤認為同一檔。 */
/** 依類型給真實檔頭（伺服端會讀 magic bytes）；gif 等不支援的類型維持 GIF 檔頭，用來驗證被拒絕。 */
const shotHead = (type: string): Buffer =>
  type === 'image/png' ? Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  : type === 'image/jpeg' ? Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10])
  : type === 'image/webp' ? Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')])
  : Buffer.from('GIF89a', 'latin1');
export const shot = (n = 1, type = 'image/png'): Shot => ({ name: `shot-${n}.${type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : type === 'image/jpeg' ? 'jpg' : 'gif'}`, type, buffer: Buffer.concat([shotHead(type), type === 'image/png' ? TINY_PNG.subarray(8) : Buffer.alloc(0), Buffer.from(`-${n}`)]) });
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
