import { describe, expect, it } from 'vitest';
import {
  addDays,
  bonusScore,
  daysBetween,
  daysRemaining,
  displayStatus,
  improvementDeadline,
  isUrgent,
  legacyReportBonus,
  pickRule,
  remainingLabel,
  reportBonus,
  taipeiDate,
  tierLabels,
  type BonusRule,
} from '../../../lib/workspace/improvement-rules';

// W17 單元層：改善回補（獎金）的新舊同輸入同輸出、台灣日期邊界（Q17）、逾期回補 0（Q19）、急迫標示。
// 預設規則與舊版／正式區相同：0–3 天 20%、4–5 天 10%、6–7 天 5%。
const RULES: BonusRule[] = [
  { day_from: 0, day_to: 3, bonus_score: 20, sort_order: 1, is_active: true },
  { day_from: 4, day_to: 5, bonus_score: 10, sort_order: 2, is_active: true },
  { day_from: 6, day_to: 7, bonus_score: 5, sort_order: 3, is_active: true },
];
const INSPECTED = '2099-03-10';
const taipeiHour = (at: string) =>
  Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Taipei', hour: '2-digit', hourCycle: 'h23' }).format(new Date(at)));

describe('台灣日期（Q17）', () => {
  it('UTC 16:00 以後就是台灣隔天（凌晨 0 到 8 點屬於台灣當天）', () => {
    expect(taipeiDate('2099-03-12T15:59:59Z')).toBe('2099-03-12');
    expect(taipeiDate('2099-03-12T16:00:00Z')).toBe('2099-03-13');
    expect(taipeiDate('2099-03-12T23:59:59Z')).toBe('2099-03-13');
    expect(taipeiDate('2099-03-12T00:00:00Z')).toBe('2099-03-12');
  });
  it('日期運算不受時區影響', () => {
    expect(daysBetween('2099-03-10', '2099-03-17')).toBe(7);
    expect(addDays('2099-03-30', 3)).toBe('2099-04-02');
    expect(daysBetween('2099-12-31', '2100-01-01')).toBe(1);
  });
});

describe('回補金額：扣分乘回補比例，四捨五入到小數一位', () => {
  it.each([
    [10, 20, 2],
    [10, 10, 1],
    [10, 5, 0.5],
    [3, 5, 0.2],
    [1.5, 10, 0.2],
    [2.5, 5, 0.1],
    [0, 20, 0],
    [7.5, 0, 0],
  ])('扣 %s 分、%s%% → %s 分', (deduction, percent, expected) => {
    expect(bonusScore(deduction, percent)).toBe(expected);
  });
});

describe('規則挑選與期限', () => {
  it('只看啟用中的規則，依 sort_order 取第一條符合者（重疊時排序在前的生效）', () => {
    const rules: BonusRule[] = [
      { day_from: 0, day_to: 5, bonus_score: 20, sort_order: 2, is_active: true },
      { day_from: 3, day_to: 7, bonus_score: 10, sort_order: 1, is_active: true },
      { day_from: 0, day_to: 9, bonus_score: 99, sort_order: 0, is_active: false },
    ];
    expect(pickRule(rules, 4)?.bonus_score).toBe(10);
    expect(pickRule(rules, 1)?.bonus_score).toBe(20);
    expect(pickRule(rules, 8)).toBeNull();
  });
  it('改善期限＝巡店日加最大天數（沒有規則時 7 天）；停用最長的規則會讓新期限變短', () => {
    expect(improvementDeadline(INSPECTED, RULES)).toBe('2099-03-17');
    expect(improvementDeadline(INSPECTED, [])).toBe('2099-03-17');
    expect(improvementDeadline(INSPECTED, RULES.map((r, i) => (i === 2 ? { ...r, is_active: false } : r)))).toBe('2099-03-15');
  });
  it('回補級距說明', () => {
    expect(tierLabels(RULES)).toEqual(['3 天內回補 20%', '4–5 天回補 10%', '6–7 天回補 5%']);
  });
});

describe('新舊同輸入同輸出（改善回補）', () => {
  const deadline = '2099-03-17';
  // 回報時間：巡店日 00:00 台灣時間起，每 30 分鐘一個點，涵蓋 9 天（含每天台灣凌晨 0–8 點整段）。
  const base = Date.parse('2099-03-09T16:00:00Z'); // 2099-03-10 00:00 台灣時間
  const points: string[] = [];
  for (let i = 0; i < 9 * 48; i += 1) points.push(new Date(base + i * 30 * 60_000).toISOString());

  it('台灣時間 8 點以後回報（UTC 與台灣同一天）：新舊天數與回補完全相同', () => {
    let compared = 0;
    for (const at of points) {
      if (taipeiHour(at) < 8) continue;
      const n = reportBonus({ inspectionDate: INSPECTED, deadline, improvedAt: at, deduction: 10, rules: RULES });
      const o = legacyReportBonus({ inspectionDate: INSPECTED, improvedAt: at, deduction: 10, rules: RULES });
      if (!n.overdue) {
        expect(n.days_taken, at).toBe(o.days_taken);
        expect(n.bonus_score, at).toBe(o.bonus_score);
        compared += 1;
      }
    }
    expect(compared).toBeGreaterThan(100);
  });

  it('台灣凌晨 0–8 點回報：舊版少算一天（Q17 已核可差異），新版按台灣日期', () => {
    // 巡店日 3/10；台灣 3/14 03:00 回報（UTC 3/13 19:00）：台灣第 4 天 → 10%；舊版 UTC 算第 3 天 → 20%（多回補）。
    const at = '2099-03-13T19:00:00Z';
    const n = reportBonus({ inspectionDate: INSPECTED, deadline, improvedAt: at, deduction: 10, rules: RULES });
    const o = legacyReportBonus({ inspectionDate: INSPECTED, improvedAt: at, deduction: 10, rules: RULES });
    expect(n.days_taken).toBe(4);
    expect(n.bonus_score).toBe(1);
    expect(o.days_taken).toBe(3);
    expect(o.bonus_score).toBe(2);
  });

  it('逐點掃描：新舊不同的點全部落在台灣 0–8 點', () => {
    const diffs: string[] = [];
    for (const at of points) {
      const n = reportBonus({ inspectionDate: INSPECTED, deadline: '2100-01-01', improvedAt: at, deduction: 10, rules: RULES });
      const o = legacyReportBonus({ inspectionDate: INSPECTED, improvedAt: at, deduction: 10, rules: RULES });
      if (n.days_taken !== o.days_taken || n.bonus_score !== o.bonus_score) {
        expect(taipeiHour(at), at).toBeLessThan(8);
        diffs.push(at);
      }
    }
    expect(diffs.length).toBeGreaterThan(0);
  });
});

describe('逾期回補 0（Q19）', () => {
  it('回報日（台灣日期）超過期限：回補 0；期限當天仍可算級距', () => {
    const onDeadline = reportBonus({ inspectionDate: INSPECTED, deadline: '2099-03-17', improvedAt: '2099-03-17T03:00:00Z', deduction: 10, rules: RULES });
    expect(onDeadline.overdue).toBe(false);
    expect(onDeadline.bonus_score).toBe(0.5);
    const late = reportBonus({ inspectionDate: INSPECTED, deadline: '2099-03-17', improvedAt: '2099-03-18T03:00:00Z', deduction: 10, rules: RULES });
    expect(late.overdue).toBe(true);
    expect(late.bonus_score).toBe(0);
    expect(late.days_taken).toBe(8);
  });
  it('即使規則後來被延長、讓逾期天數剛好落在級距內，仍回補 0', () => {
    const extended: BonusRule[] = [...RULES, { day_from: 8, day_to: 14, bonus_score: 3, sort_order: 4, is_active: true }];
    const r = reportBonus({ inspectionDate: INSPECTED, deadline: '2099-03-17', improvedAt: '2099-03-20T03:00:00Z', deduction: 10, rules: extended });
    expect(r.overdue).toBe(true);
    expect(r.bonus_score).toBe(0);
  });
});

describe('逾期顯示與急迫標示（舊版：待改善且剩 2 天內）', () => {
  const today = '2099-03-15';
  it('逾期按台灣日期，只在顯示時計算', () => {
    expect(displayStatus('pending', '2099-03-14', today)).toBe('overdue');
    expect(displayStatus('pending', '2099-03-15', today)).toBe('pending');
    expect(displayStatus('improved', '2099-03-01', today)).toBe('improved');
    expect(displayStatus('overdue', '2099-03-01', today)).toBe('overdue');
  });
  it('剩幾天與標籤', () => {
    expect(daysRemaining('2099-03-17', today)).toBe(2);
    expect(remainingLabel('2099-03-17', today)).toBe('剩 2 天');
    expect(remainingLabel('2099-03-15', today)).toBe('今天到期');
    expect(remainingLabel('2099-03-13', today)).toBe('逾期 2 天');
  });
  it('剩 2 天內（含今天到期）標急迫；剩 3 天不急迫；已改善不急迫', () => {
    expect(isUrgent('pending', '2099-03-17', today)).toBe(true);
    expect(isUrgent('pending', '2099-03-15', today)).toBe(true);
    expect(isUrgent('pending', '2099-03-18', today)).toBe(false);
    expect(isUrgent('improved', '2099-03-15', today)).toBe(false);
    expect(isUrgent('pending', '2099-03-14', today), '已過期限顯示為已逾期，不再算急迫').toBe(false);
  });
});
