import { describe, expect, it } from 'vitest';
import { POSITION_OPTIONS } from '../../../types/workflow';
import { ADMIN_RANK_ORDER, STORE_RANK_ORDER, compareRank, normalizeStage, pickEffectivePosition, positionRank } from '../../../lib/workspace/position-rank';

// W05 單元層：職等表（M2 規格 B.2），並對照系統實際的職位與階段值。

describe('職等表順序（B.2）', () => {
  it('門市職等由低到高', () => {
    const order = [
      ['新人', '未過階新人'], ['新人', '一階新人'], ['新人', '二階新人'], ['專員', null], ['組長', null],
      ['主任', null], ['副店長', null], ['店長', null], ['督導', null], ['經理', null],
    ] as const;
    const ranks = order.map(([p, l]) => positionRank(p, l)!.rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(new Set(ranks).size).toBe(order.length);
    expect(order.map(([p, l]) => positionRank(p, l)!.label)).toEqual([...STORE_RANK_ORDER]);
  });
  it('門市行政職等：未過階 < 過階', () => {
    const low = positionRank('行政', '未過階行政')!, high = positionRank('行政', '過階行政')!;
    expect(compareRank(high, low)).toBeGreaterThan(0);
    expect([low.label, high.label]).toEqual([...ADMIN_RANK_ORDER]);
  });
  it('階段接受系統實際值與簡寫', () => {
    expect(normalizeStage('二階新人', '新人')).toBe('二階');
    expect(normalizeStage('二階', '新人')).toBe('二階');
    expect(normalizeStage('新人（一階）', '新人')).toBe('一階');
    expect(normalizeStage('過階行政', '行政')).toBe('過階');
    expect(normalizeStage('未過階行政', '行政')).toBe('未過階');
    expect(normalizeStage('三階新人', '新人')).toBeNull();
    expect(normalizeStage(undefined, '行政')).toBeNull();
  });
  it('新人未記錄階段時保守視為最低並標示 stageKnown=false', () => {
    const r = positionRank('新人', null)!;
    expect(r.rank).toBe(0);
    expect(r.stageKnown).toBe(false);
  });
  it('不同軌道無法比較（門市 vs 行政）', () => {
    expect(compareRank(positionRank('專員'), positionRank('行政', '過階行政'))).toBeNull();
  });
});

describe('與系統實際職位值對照', () => {
  it('DEV 盤點到的職位都能判斷（或明確標示無職等）', () => {
    // DEV monthly_staff_status.position：專員、主任、行政、組長、店長、兼職助理、副店長、新人；store_employees 另有「代理店長」。
    for (const p of ['專員', '主任', '組長', '店長', '副店長', '新人', '行政']) expect(positionRank(p, p === '行政' ? '過階行政' : null), p).not.toBeNull();
    expect(positionRank('兼職助理')).toBeNull();
    expect(positionRank('代理店長')).toBeNull();
  });
  it('POSITION_OPTIONS 中不在規格職等表內的職位一律無職等（回報使用者，不自行猜測）', () => {
    const unranked = POSITION_OPTIONS.filter((p) => positionRank(p) === null);
    expect(unranked).toEqual(['總經理', '副總經理', '資深經理', '資深副理', '副理', '資深專員', '高級專員', '出納專員', '助理', '兼職專員', '兼職藥師', '兼職藥師專員', '兼職助理']);
  });
  it('規格職等表的每個職位名稱都在 POSITION_OPTIONS（新人、行政以職位＋階段表示）', () => {
    for (const label of STORE_RANK_ORDER) {
      const name = label.startsWith('新人') ? '新人' : label;
      expect(POSITION_OPTIONS, label).toContain(name);
    }
    expect(POSITION_OPTIONS).toContain('行政');
  });
});

describe('同時登記多階升職取相對最高職等（B.2）', () => {
  const e = (position: string, level: string | null, effective_date: string) => ({ position, level, effective_date });
  it('同一天新人一階與新人二階 -> 新人二階', () => {
    expect(pickEffectivePosition([e('新人', '一階新人', '2026-10-01'), e('新人', '二階新人', '2026-10-01')])?.level).toBe('二階新人');
    expect(pickEffectivePosition([e('新人', '二階新人', '2026-10-01'), e('新人', '一階新人', '2026-10-01')])?.level).toBe('二階新人');
  });
  it('同一天新人二階與專員 -> 專員', () => {
    expect(pickEffectivePosition([e('專員', null, '2026-10-01'), e('新人', '二階新人', '2026-10-01')])?.position).toBe('專員');
  });
  it('生效日較晚者優先，即使職等較低', () => {
    expect(pickEffectivePosition([e('組長', null, '2026-09-01'), e('專員', null, '2026-10-01')])?.position).toBe('專員');
  });
  it('代理店長只是註記，不改正式職位', () => {
    expect(pickEffectivePosition([e('組長', null, '2026-09-01'), e('代理店長', null, '2026-10-01')])?.position).toBe('組長');
    expect(pickEffectivePosition([e('代理店長', null, '2026-10-01')])).toBeNull();
  });
  it('同日職等無法比較時保留先出現者；空清單回傳 null', () => {
    expect(pickEffectivePosition([e('專員', null, '2026-10-01'), e('行政', '過階行政', '2026-10-01')])?.position).toBe('專員');
    expect(pickEffectivePosition([])).toBeNull();
  });
});
