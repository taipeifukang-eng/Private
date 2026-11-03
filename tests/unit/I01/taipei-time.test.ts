import { describe, expect, it } from 'vitest';
import { formatTaipeiDate, formatTaipeiDateTime, formatTaipeiTime } from '../../../vue-workspace/src/taipei-time';

// 巡店明細時間顯示：與舊版 app/inspection/[id]/page.tsx 相同，以 zh-TW / Asia/Taipei 格式化。
// ICU 可能在上午/下午前後使用不同空白字元，比對前先正規化
const n = (s: string) => s.replace(/\s/g, ' ');
describe('taipei-time', () => {
  it('formats a normal UTC timestamp (04:30 UTC = 12:30 Taipei)', () => {
    const v = '2026-09-25T04:30:06.843+00:00';
    expect(formatTaipeiDateTime(v)).toBe(new Date(v).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }));
    expect(n(formatTaipeiDateTime(v))).toBe('2026/9/25 下午12:30:06');
    expect(formatTaipeiDate(v)).toBe('2026/9/25');
    expect(n(formatTaipeiTime(v))).toBe('下午12:30:06');
  });
  it('rolls over to the next Taipei day when UTC is 16:30', () => {
    const v = '2026-09-24T16:30:00+00:00';
    expect(formatTaipeiDate(v)).toBe('2026/9/25');
    expect(n(formatTaipeiTime(v))).toBe('上午12:30:00');
    expect(n(formatTaipeiDateTime(v))).toBe('2026/9/25 上午12:30:00');
  });
  it('returns empty string for empty or invalid input', () => {
    expect(formatTaipeiDateTime(null)).toBe('');
    expect(formatTaipeiDate(undefined)).toBe('');
    expect(formatTaipeiTime('not-a-date')).toBe('');
  });
});
