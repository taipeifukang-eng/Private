import { describe, expect, it } from 'vitest';
import {
  isNewbieCandidate,
  monthIndex,
  monthsSinceHire,
  newbiePromotionPrompt,
  PROMOTION_BY_MOVEMENT_NOTICE,
  suggestedNewbieAction,
  usesNewbieLevel,
} from '../../../lib/monthly-staff/newbie';
import { newbiesNeedCheck } from '../../../lib/workspace/monthly-status-rules';

// W01b-q2：新人升階判斷（共用模組）。舊版來源：app/monthly-status/edit/[id]/page.tsx 252–294 行（編輯頁，剛好第 N 個月）
// 與 app/store/actions.ts checkNewbieStatus（送審前檢查，滿 N 個月以上）。

describe('行政 + new_hire 與舊版一致仍套用新人階段規則', () => {
  it('行政 + new_hire + 第 1、2 個月 仍提示；usesNewbieLevel 為 true；行政 + full_month 不適用', () => {
    expect(newbiePromotionPrompt('2026-09-01', '2026-10', '行政', 'new_hire', '')?.suggestedLevel).toBe('一階新人');
    expect(newbiePromotionPrompt('2026-08-01', '2026-10', '行政', 'new_hire', '')?.suggestedLevel).toBe('二階新人');
    expect(usesNewbieLevel('行政', 'new_hire')).toBe(true);
    expect(usesNewbieLevel('行政', 'full_month')).toBe(false);
    expect(usesNewbieLevel('行政', 'new_hire')).toBe(isNewbieCandidate('行政', 'new_hire'));
    expect(usesNewbieLevel('新人', 'full_month')).toBe(true);
    expect(usesNewbieLevel('專員', 'new_hire')).toBe(true);
  });
});

describe('monthIndex / monthsSinceHire', () => {
  it('不經過 Date，不受時區影響；跨年正確', () => {
    expect(monthIndex('2026-01-31')).toBe(2026 * 12);
    expect(monthsSinceHire('2025-12-01', '2026-01')).toBe(1);
    expect(monthsSinceHire('2026-10-01', '2026-10')).toBe(0);
    expect(monthsSinceHire('2026-04-30', '2026-10')).toBe(6);
  });
  it('格式不合或月份超出範圍回 null', () => {
    expect(monthIndex('')).toBeNull();
    expect(monthIndex(null)).toBeNull();
    expect(monthIndex('2026-13-01')).toBeNull();
    expect(monthIndex('abc')).toBeNull();
    expect(monthsSinceHire('2026-02-30x', 'bad')).toBeNull();
  });
});

describe('isNewbieCandidate', () => {
  it('職位為新人或本月狀態為本月新進', () => {
    expect(isNewbieCandidate('新人', 'full_month')).toBe(true);
    expect(isNewbieCandidate('專員', 'new_hire')).toBe(true);
    expect(isNewbieCandidate('專員', 'full_month')).toBe(false);
  });
});

describe('newbiePromotionPrompt（編輯頁，月份 2026-10）', () => {
  const ym = '2026-10';
  it('到職 2026-09-15、不是一階 → 提示改一階新人（可套用）', () => {
    const p = newbiePromotionPrompt('2026-09-15', ym, '新人', 'full_month', '未過階新人');
    expect(p).toMatchObject({ kind: 'level', monthsDiff: 1, suggestedLevel: '一階新人', message: '此新人應該過一階段，是否要改成一階新人？' });
  });
  it('到職 2026-09-15、已是一階 → 不提示', () => {
    expect(newbiePromotionPrompt('2026-09-15', ym, '新人', 'full_month', '一階新人')).toBeNull();
  });
  it('到職 2026-08-01、不是二階 → 提示改二階新人', () => {
    const p = newbiePromotionPrompt('2026-08-01', ym, '新人', 'full_month', '一階新人');
    expect(p).toMatchObject({ kind: 'level', monthsDiff: 2, suggestedLevel: '二階新人', message: '此新人應該過二階段，是否要改成二階新人？' });
  });
  it('到職 2026-08-01、已是二階 → 不提示', () => {
    expect(newbiePromotionPrompt('2026-08-01', ym, '新人', 'full_month', '二階新人')).toBeNull();
  });
  it('到職 2026-04-01、職位新人 → 滿 6 個月：只提示以人員異動紀錄處理，不提供改職位', () => {
    const p = newbiePromotionPrompt('2026-04-01', ym, '新人', 'full_month', '二階新人');
    expect(p?.kind).toBe('promote');
    expect(p?.monthsDiff).toBe(6);
    expect(p?.message).toContain(PROMOTION_BY_MOVEMENT_NOTICE);
    expect(p?.suggestedLevel).toBeUndefined();
  });
  it('到職 2026-04-01 但職位已是專員（本月狀態不是新進）→ 不提示', () => {
    expect(newbiePromotionPrompt('2026-04-01', ym, '專員', 'full_month', '')).toBeNull();
  });
  it('到職當月（monthsDiff 0）→ 不提示', () => {
    expect(newbiePromotionPrompt('2026-10-01', ym, '新人', 'new_hire', '')).toBeNull();
  });
  it('職位為專員 → 不提示（即使到職滿 1 個月）', () => {
    expect(newbiePromotionPrompt('2026-09-15', ym, '專員', 'full_month', '')).toBeNull();
  });
  it('本月狀態為本月新進也適用（職位非新人）', () => {
    expect(newbiePromotionPrompt('2026-09-15', ym, '專員', 'new_hire', '')?.kind).toBe('level');
  });
  it('沒有到職日 → 不提示', () => {
    expect(newbiePromotionPrompt('', ym, '新人', 'new_hire', '')).toBeNull();
    expect(newbiePromotionPrompt(null, ym, '新人', 'new_hire', '')).toBeNull();
  });
  it('跨年：到職 2025-12-01、月份 2026-01 → monthsDiff 1', () => {
    expect(newbiePromotionPrompt('2025-12-01', '2026-01', '新人', 'full_month', '')?.monthsDiff).toBe(1);
  });
  it('只在「剛好」第 1、2、6 個月提示：第 3、4、5、7 個月不提示（舊版編輯頁行為）', () => {
    for (const start of ['2026-07-01', '2026-06-01', '2026-05-01', '2026-03-01'])
      expect(newbiePromotionPrompt(start, ym, '新人', 'full_month', '未過階新人'), start).toBeNull();
  });
});

describe('suggestedNewbieAction（送審前檢查，累積判斷）與規則表一致', () => {
  it('順序與舊版 checkNewbieStatus 相同', () => {
    expect(suggestedNewbieAction(0, '新人', '')).toBe('');
    expect(suggestedNewbieAction(1, '新人', '')).toBe('應該過一階段');
    expect(suggestedNewbieAction(1, '新人', '一階新人')).toBe('');
    expect(suggestedNewbieAction(2, '新人', '一階新人')).toBe('應該過二階段');
    expect(suggestedNewbieAction(2, '新人', '二階新人')).toBe('');
    expect(suggestedNewbieAction(3, '新人', '二階新人')).toBe('');
    expect(suggestedNewbieAction(6, '新人', '二階新人')).toBe('應該要過專員考試');
    expect(suggestedNewbieAction(6, '專員', '二階新人')).toBe('');
  });
  it('newbiesNeedCheck 引用同一份判斷（月份 2026-10）', () => {
    const rows = [
      { id: 'a', employee_code: 'A', status: 'draft', start_date: '2026-09-15', position: '新人', monthly_status: 'full_month', newbie_level: '' },
      { id: 'b', employee_code: 'B', status: 'draft', start_date: '2026-08-01', position: '新人', monthly_status: 'full_month', newbie_level: '一階新人' },
      { id: 'c', employee_code: 'C', status: 'draft', start_date: '2026-04-01', position: '新人', monthly_status: 'full_month', newbie_level: '二階新人' },
      { id: 'd', employee_code: 'D', status: 'submitted', start_date: '2026-04-01', position: '新人', monthly_status: 'full_month', newbie_level: '' },
    ];
    expect(newbiesNeedCheck(rows, '2026-10').map((r) => [r.id, r.suggested_action])).toEqual([
      ['a', '應該過一階段'],
      ['b', '應該過二階段'],
      ['c', '應該要過專員考試'],
    ]);
  });
});
