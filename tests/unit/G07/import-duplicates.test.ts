import { describe, expect, it } from 'vitest';
import { findPossibleDuplicates, normalizeAssetName, taipeiDate, type DupInputRow, type ExistingAsset } from '@/lib/workspace/general-affairs/import-duplicates';
import { OPEN_TRANSFER_BLOCKED_STATUS, openTransferBlockMessage } from '@/lib/workspace/general-affairs/asset-fields';

// B10 Excel 匯入「可能重複」提醒的比對規則（純函式），以及 B9 轉移中不可報廢的狀態表與訊息。
const row = (n: number, name: string, over: Partial<DupInputRow> = {}): DupInputRow => ({ row_no: n, kind: 'EQUIPMENT', store_code: 'ZT01', name, hasCode: false, ...over });
const ex = (name: string, over: Partial<ExistingAsset> = {}): ExistingAsset => ({ kind: 'EQUIPMENT', store_code: 'ZT01', name, code: 'IC01-2026-0001', created_at: '2026-10-01T16:30:00Z', ...over });

describe('B10 名稱正規化', () => {
  it('trim、大小寫、全半形空白、全形英數、連續空白', () => {
    expect(normalizeAssetName('  Air  Con ')).toBe('air con');
    expect(normalizeAssetName('AIR　CON')).toBe('air con');
    expect(normalizeAssetName('ＡＩＲ　ＣＯＮ')).toBe('air con');
    expect(normalizeAssetName('冷氣機\t一號')).toBe('冷氣機 一號');
    expect(normalizeAssetName(null)).toBe('');
  });
  it('台北日期（UTC 16:30 已是隔天）', () => {
    expect(taipeiDate('2026-10-01T16:30:00Z')).toBe('2026-10-02');
    expect(taipeiDate(null)).toBeNull();
    expect(taipeiDate('壞掉')).toBeNull();
  });
});

describe('B10 可能重複', () => {
  it('與既有同類型同門市同名（正規化後）標記，訊息含名稱、編號與建立日', () => {
    const r = findPossibleDuplicates([row(2, ' ＡＩＲ　con ')], [ex('Air Con')]);
    expect(r.get(2)).toMatchObject({ type: 'existing', count: 1 });
    expect(r.get(2)!.message).toBe('可能重複：與既有「Air Con」（編號 IC01-2026-0001，建立 2026-10-02）同名');
  });
  it('既有沒編號顯示尚無編號；多筆顯示共幾筆', () => {
    const r = findPossibleDuplicates([row(2, 'A')], [ex('A', { code: null }), ex('a')]);
    expect(r.get(2)!.message).toContain('共 2 筆');
    const one = findPossibleDuplicates([row(2, 'A')], [ex('A', { code: null })]);
    expect(one.get(2)!.message).toContain('尚無編號');
  });
  it('不同門市、不同類型、已有編號的列都不標記', () => {
    expect(findPossibleDuplicates([row(2, 'A', { store_code: 'ZT02' })], [ex('A')]).size).toBe(0);
    expect(findPossibleDuplicates([row(2, 'A', { kind: 'FACILITY' })], [ex('A')]).size).toBe(0);
    expect(findPossibleDuplicates([row(2, 'A', { hasCode: true })], [ex('A')]).size).toBe(0);
  });
  it('門市代碼大小寫不敏感', () => {
    expect(findPossibleDuplicates([row(2, 'A', { store_code: 'zt01' })], [ex('A')]).size).toBe(1);
  });
  it('同檔其他列同名：兩列都標記並指向對方；有填編號的那列自己不標記，但會讓沒填編號的列被標記', () => {
    const r = findPossibleDuplicates([row(2, 'B'), row(3, 'b'), row(4, 'C'), row(5, 'c', { hasCode: true })], []);
    expect(r.get(2)!.message).toBe('可能重複：與第 3 列同名');
    expect(r.get(3)!.message).toBe('可能重複：與第 2 列同名');
    expect(r.get(4)!.message).toBe('可能重複：與第 5 列同名');
    expect(r.has(5)).toBe(false);
  });
  it('既有與同檔都符合時以既有為主；空名稱不比對', () => {
    const r = findPossibleDuplicates([row(2, 'D'), row(3, 'D')], [ex('D')]);
    expect(r.get(2)!.type).toBe('existing');
    expect(findPossibleDuplicates([row(2, '  '), row(3, '')], [ex('')]).size).toBe(0);
  });
});

describe('B9 轉移中不可報廢／退役', () => {
  it('設備擋退役與報廢，設施擋退役', () => {
    expect(OPEN_TRANSFER_BLOCKED_STATUS.equipment.sort()).toEqual(['RETIRED', 'SCRAPPED']);
    expect(OPEN_TRANSFER_BLOCKED_STATUS.facilities).toEqual(['RETIRED']);
  });
  it('訊息白話並帶轉移單號', () => {
    expect(openTransferBlockMessage('equipment', 'SCRAPPED', 'AT20261110-001')).toBe('這台設備有進行中的轉移單 AT20261110-001，請先取消轉移單再報廢');
    expect(openTransferBlockMessage('equipment', 'RETIRED', 'AT1')).toBe('這台設備有進行中的轉移單 AT1，請先取消轉移單再退役');
    expect(openTransferBlockMessage('facilities', 'RETIRED', 'AT2')).toBe('這台設施有進行中的轉移單 AT2，請先取消轉移單再退役');
  });
});
