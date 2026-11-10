import type { APIRequestContext } from '@playwright/test';
import * as XLSX from 'xlsx';
import { IMPORT_COLUMNS } from '../../lib/workspace/general-affairs/import-columns';
import { m7Code, m7Name } from './m7m8-fixtures';
import { makePng } from './png';

// M7/M8 第 2 批 Q29 測試共用：用程式組出匯入用的 Excel、以 API 推動貼標流程到指定階段（只用於準備進度頁的資料）。
export type ImportLine = Record<string, string | number>;
export const IMPORT_HEADERS = IMPORT_COLUMNS.map((c) => c.header);

/** 匯入用 xlsx（第一個工作表「匯入資料」，第一列是中文表頭）。 */
export function buildImportXlsx(lines: ImportLine[], head: string[] = IMPORT_HEADERS): Buffer {
  const aoa = [head, ...lines.map((l) => head.map((h) => (h in l ? l[h] : '')))];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), '匯入資料');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
/** 檔名帶測試標記，匯入批次才會被清理程式找到。 */
export const importFileName = (tag: string) => `${m7Name(tag)}.xlsx`;
export const importEquipmentLine = (tag: string, store: string, categoryCode: string, over: ImportLine = {}): ImportLine => ({
  類型: '設備', 門市代碼: store, 分類代碼: categoryCode, 名稱: m7Name(tag), 品牌: 'IB', 型號: 'IM', 資產編號: m7Code(tag), ...over,
});
export const importFacilityLine = (tag: string, store: string, categoryCode: string, over: ImportLine = {}): ImportLine => ({
  類型: '設施', 門市代碼: store, 分類代碼: categoryCode, 名稱: m7Name(tag), ...over,
});

const png = () => makePng({ width: 120, height: 80, inkPixels: 20 });
const BASE = '/api/workspace/general-affairs';
export type AssetType = 'EQUIPMENT' | 'FACILITY';
export async function uploadStep(api: APIRequestContext, type: AssetType, id: string, purpose: 'PRIMARY_IMAGE' | 'LABEL_POSITION_IMAGE') {
  const r = await api.post(`${BASE}/onboarding/photo`, { multipart: { assetType: type, assetId: id, purpose, file: { name: 'm7m8t-step.png', mimeType: 'image/png', buffer: png() } } });
  if (r.status() !== 201) throw new Error(`上傳 ${purpose} 失敗：${r.status()} ${await r.text()}`);
}
/** 用 API 把一筆資產推到指定的貼標階段（店長帳號上傳、總務帳號複核）。 */
export async function driveTo(type: AssetType, id: string, to: 'NEEDS_LABEL_PHOTO' | 'PENDING_GA_REVIEW' | 'COMPLETED', manager: APIRequestContext, ga: APIRequestContext) {
  await uploadStep(manager, type, id, 'PRIMARY_IMAGE');
  if (to === 'NEEDS_LABEL_PHOTO') return;
  await uploadStep(manager, type, id, 'LABEL_POSITION_IMAGE');
  if (to === 'PENDING_GA_REVIEW') return;
  const r = await ga.post(`${BASE}/onboarding/review`, { data: { assetType: type, assetId: id, action: 'approve' } });
  if (r.status() !== 200) throw new Error(`複核通過失敗：${r.status()} ${await r.text()}`);
}
