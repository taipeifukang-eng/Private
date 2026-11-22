import type { APIRequestContext } from '@playwright/test';
import { gsheetBuffer, type FixtureStore } from './rx-fixtures';

/**
 * 處方箋 Google Sheet 匯入（W03 追加）的整合、e2e 共用工具。
 * 資料：保留年份 2038（月報由 sweeper 的保留年份機制清除）、只用 VW/ZT 測試門市；
 * 簡稱對照表（prescription_store_aliases）由 sweeper 的測試門市專屬設定表機制清除，測試內也會自己刪除自己建的簡稱。
 * 測試門市名稱：VW001「Vue 測試一店」、ZT01～ZT05「ZT 測試門市 01～05」。
 */
export const RX_TOOLS = '/api/workspace/performance-tools';
export const RX_XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
/** 測試用簡稱：測試一 → VW001（自動）、測試門市01 → ZT01（自動）、測試 → 多個候選、義一 → 找不到。 */
export const RX_ALIASES = ['測試一', '測試門市01', '測試', '義一', '測試二', '測試原子'];

type Pair = [string | number, string | number];
const m = (r: Pair, c: Pair, t: Pair) => ({ regular: r, chronic: c, total: t });

export const RX_SHEET: FixtureStore[] = [
  { alias: '測試一', months: { 十月: m(['1,200', '2,600,000'], ['550', '1,250,000'], ['1,750', '3,850,000']) } },
  { alias: '測試門市01', months: { 十月: m([100, '300.5'], [50, '100.25'], [151, '400.75']) } }, // 加總不符（張數）
  { alias: '測試', months: { 十月: m([10, 100], [5, 50], [15, 150]) } }, // 多個候選
  { alias: '義一', months: { 十月: m([20, 200], [6, 60], [26, 260]) } }, // 對不上
];

/** 含「九月」與 label（預設「十月」，也可用「12月」這類寫法）兩組欄位的 Google Sheet xlsx；兩組內容相同。 */
export function rxSheetBuffer(label = '十月', stores: FixtureStore[] = RX_SHEET): Buffer {
  return gsheetBuffer({
    monthLabels: ['九月', label],
    stores: stores.map((s) => ({ ...s, months: { 九月: s.months['十月'], [label]: s.months['十月'] } })),
  });
}

export const rxFile = (buffer: Buffer, name = 'rx-gsheet.xlsx') => ({ name, mimeType: RX_XLSX_MIME, buffer });

export async function rxPost(api: APIRequestContext, buffer: Buffer, yearMonth: string, mode: 'preview' | 'commit', selections: Record<string, string> = {}) {
  const res = await api.post(`${RX_TOOLS}/prescription-import`, {
    multipart: { file: rxFile(buffer), year_month: yearMonth, mode, selections: JSON.stringify(selections) },
  });
  return { status: res.status(), json: await res.json().catch(() => ({})) };
}

/** 刪除本測試用到的簡稱（只刪名稱在 RX_ALIASES 且指向測試門市的；其他人的簡稱不動）。 */
export async function rxClearAliases(admin: APIRequestContext): Promise<void> {
  const list = await (await admin.get(`${RX_TOOLS}/prescription-aliases`)).json();
  for (const a of (list.aliases || []) as { id: string; alias: string; store_code: string }[]) {
    if (RX_ALIASES.includes(a.alias) && /^(ZT|VW)/.test(a.store_code)) {
      await admin.delete(`${RX_TOOLS}/prescription-aliases/${a.id}`);
    }
  }
}
