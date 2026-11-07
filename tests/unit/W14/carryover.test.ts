import { describe, expect, it } from 'vitest';
import { carryOverScores, type CarryScore, type CarryTemplate } from '../../../lib/workspace/inspection-carryover';

// M4 Q9：範本變更後保留還對得上的勾選、數量、備註、照片；對不上的列出。
const t = (id: string, items: { label: string; deduction: number; requires_quantity?: boolean }[], over: Partial<CarryTemplate> = {}): CarryTemplate => ({
  id,
  item_name: '項目' + id,
  max_score: 20,
  is_active: true,
  checklist_items: items,
  ...over,
});
const sc = (id: string, over: Partial<CarryScore> = {}): CarryScore => ({ template_id: id, checked_items: [], quantities: {}, notes: '', photos: [], ...over });

describe('carryOverScores', () => {
  const old = [t('a', [{ label: '地板髒', deduction: 2 }, { label: '缺貨', deduction: 1, requires_quantity: true }]), t('b', [{ label: '燈壞', deduction: 3 }])];
  const oldScores = [sc('a', { checked_items: ['地板髒', '缺貨'], quantities: { 缺貨: 4 }, notes: '備註A', photos: ['p1', 'p2'] }), sc('b', { checked_items: ['燈壞'], notes: '備註B' })];

  it('範本沒變：全部原樣保留，沒有任何提示', () => {
    const r = carryOverScores(old, oldScores, old);
    expect(r.notices).toEqual([]);
    expect(r.scores).toEqual(oldScores);
  });
  it('項目文字改名或移除：對不上的列出，其餘保留', () => {
    const next = [t('a', [{ label: '缺貨', deduction: 1, requires_quantity: true }]), old[1]];
    const r = carryOverScores(old, oldScores, next);
    expect(r.scores[0]).toMatchObject({ checked_items: ['缺貨'], quantities: { 缺貨: 4 }, notes: '備註A', photos: ['p1', 'p2'] });
    expect(r.notices).toHaveLength(1);
    expect(r.notices[0]).toMatchObject({ template_id: 'a', kind: 'removed', label: '地板髒' });
  });
  it('扣分值改變：保留勾選但列出需確認（分數不悄悄改）', () => {
    const next = [t('a', [{ label: '地板髒', deduction: 5 }, old[0].checklist_items![1]]), old[1]];
    const r = carryOverScores(old, oldScores, next);
    expect(r.scores[0].checked_items).toEqual(['地板髒', '缺貨']);
    expect(r.notices.map((n) => n.kind)).toEqual(['changed']);
    expect(r.notices[0].message).toContain('2 改為 5');
  });
  it('整個項目被停用移除：有內容才列出，備註照片未帶入', () => {
    const r = carryOverScores(old, oldScores, [old[0]]);
    expect(r.scores).toHaveLength(1);
    expect(r.notices).toHaveLength(1);
    expect(r.notices[0]).toMatchObject({ template_id: 'b', kind: 'removed' });
    const empty = carryOverScores(old, [oldScores[0], sc('b')], [old[0]]);
    expect(empty.notices).toEqual([]);
  });
  it('範本新增項目：空白加入並列出', () => {
    const r = carryOverScores(old, oldScores, [...old, t('c', [{ label: '新項', deduction: 1 }])]);
    expect(r.scores[2]).toEqual(sc('c'));
    expect(r.notices).toEqual([expect.objectContaining({ template_id: 'c', kind: 'added' })]);
  });
  it('項目被停用但保留顯示（編輯舊單）：保留內容並標示', () => {
    const next = [t('a', old[0].checklist_items!, { is_active: false }), old[1]];
    const r = carryOverScores(old, oldScores, next);
    expect(r.scores[0]).toEqual(oldScores[0]);
    expect(r.notices.map((n) => n.kind)).toEqual(['disabled']);
  });
  it('數量缺失或不合法時補 1，不回傳 0 或小數', () => {
    const bad = [sc('a', { checked_items: ['缺貨'], quantities: { 缺貨: 0 } }), sc('b')];
    expect(carryOverScores(old, bad, old).scores[0].quantities).toEqual({ 缺貨: 1 });
    const frac = [sc('a', { checked_items: ['缺貨'], quantities: { 缺貨: 2.5 } }), sc('b')];
    expect(carryOverScores(old, frac, old).scores[0].quantities).toEqual({ 缺貨: 1 });
  });
  it('不改動輸入（照片陣列是複本）', () => {
    const r = carryOverScores(old, oldScores, old);
    r.scores[0].photos.push('x');
    expect(oldScores[0].photos).toEqual(['p1', 'p2']);
  });
});
