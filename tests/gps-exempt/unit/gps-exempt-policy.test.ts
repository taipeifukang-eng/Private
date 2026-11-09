import { describe, expect, it } from 'vitest';
import {
  GPS_EXEMPT_LABEL,
  GPS_EXEMPT_PERMISSION_CODE,
  GPS_FAR_ACCURACY_M,
  classifyGpsDbError,
  getGpsFailureMessage,
  getGpsFailureNote,
  isGpsAccuracyFar,
  isGpsDbError,
  toExemptGpsFix,
  validateGpsFix,
} from '@/lib/inspection/gps-policy';

const NOW = Date.parse('2026-11-09T04:00:00.000Z');
const fix = (over: Record<string, unknown> = {}) => ({ latitude: 25.033, longitude: 121.5654, accuracy: 25000, capturedAt: new Date(NOW).toISOString(), ...over });

describe('定位例外：常數與名稱', () => {
  it('權限代碼與顯示名稱', () => {
    expect(GPS_EXEMPT_PERMISSION_CODE).toBe('inspection.gps_exempt');
    expect(GPS_EXEMPT_LABEL).toBe('巡店定位例外');
    expect(GPS_FAR_ACCURACY_M).toBe(5000);
  });
});

describe('isGpsAccuracyFar：誤差 >= 5000 公尺', () => {
  it.each([
    [4999, false],
    [4999.9, false],
    [5000, true],
    [25000, true],
    [0, false],
    [-1, false],
    [Number.NaN, false],
    [Number.POSITIVE_INFINITY, false],
    [null, false],
    [undefined, false],
  ])('%s -> %s', (value, expected) => {
    expect(isGpsAccuracyFar(value as number | null | undefined)).toBe(expected);
  });
});

describe('getGpsFailureNote：誤差分級的教學提示', () => {
  it('誤差 >= 5000：改提示電腦可能沒有 WiFi、改用手機或定位例外', () => {
    const note = getGpsFailureNote('accuracy_too_large', false, 25000);
    expect(note).toContain('誤差達數公里');
    expect(note).toContain('這台電腦可能沒有 WiFi');
    expect(note).toContain('只接網路線無法精準定位');
    expect(note).toContain('請改用手機');
    expect(note).toContain('「巡店定位例外」權限的主管使用定位例外');
  });
  it('剛好 5000 也套用；手機裝置同樣套用（誤差數公里不會是手機正常情況）', () => {
    expect(getGpsFailureNote('accuracy_too_large', true, 5000)).toContain('誤差達數公里');
  });
  it('誤差 1000~4999：維持原本提示，不含數公里字樣', () => {
    expect(getGpsFailureNote('accuracy_too_large', false, 4999)).toBe('這次失敗的原因是「定位誤差過大」：建議改用手機，並開啟「精確位置」。');
    expect(getGpsFailureNote('accuracy_too_large', true, 1500)).toContain('開啟「精確位置」，移到窗邊或戶外');
  });
  it('沒有帶誤差（舊呼叫方式）：行為與先前完全相同', () => {
    expect(getGpsFailureNote('accuracy_too_large', false)).toBe('這次失敗的原因是「定位誤差過大」：建議改用手機，並開啟「精確位置」。');
    expect(getGpsFailureNote('permission_denied')).toContain('權限被拒絕');
    expect(getGpsFailureNote('timeout')).toContain('無法取得位置或逾時');
    expect(getGpsFailureNote(null)).toBe('');
  });
  it('誤差很大但失敗原因不是誤差（例如權限被拒）：不套用數公里提示', () => {
    expect(getGpsFailureNote('permission_denied', false, 25000)).not.toContain('誤差達數公里');
  });
  it('沒有定位例外權限的提示', () => {
    expect(getGpsFailureNote('exempt_forbidden')).toContain('沒有「巡店定位例外」權限');
  });
});

describe('資料庫權限錯誤訊息分類', () => {
  const msg = '【巡店定位】你沒有「巡店定位例外」權限';
  it('辨識為定位錯誤並分類為 exempt_forbidden', () => {
    expect(isGpsDbError({ message: msg })).toBe(true);
    expect(classifyGpsDbError(msg)).toBe('exempt_forbidden');
    expect(getGpsFailureMessage('exempt_forbidden')).toBe('你沒有「巡店定位例外」權限');
  });
  it('既有訊息分類不變', () => {
    expect(classifyGpsDbError('【巡店定位】定位誤差過大（±1500 公尺），上限為 1000 公尺，請重新定位後再送出')).toBe('accuracy_too_large');
    expect(classifyGpsDbError('【巡店定位】新增巡店必須先完成定位（缺少定位座標、誤差或時間），請重新定位後再送出')).toBe('invalid_fix');
    expect(classifyGpsDbError('【巡店定位】定位時間距現在超過 2 小時，請重新定位後再送出')).toBe('time_invalid');
    expect(classifyGpsDbError('【巡店定位】定位座標超出範圍，請重新定位後再送出')).toBe('invalid_fix');
  });
});

describe('toExemptGpsFix：定到什麼存什麼', () => {
  it('誤差 25000 的定位原樣保留（時間轉 ISO）', () => {
    expect(toExemptGpsFix(fix())).toEqual({ latitude: 25.033, longitude: 121.5654, accuracy: 25000, capturedAt: '2026-11-09T04:00:00.000Z' });
  });
  it('沒有定位（拒絕、逾時、不支援）：null，gps 欄位留空', () => {
    expect(toExemptGpsFix(null)).toBeNull();
    expect(toExemptGpsFix(undefined)).toBeNull();
  });
  it.each([
    ['緯度 91', { latitude: 91 }],
    ['緯度 -91', { latitude: -91 }],
    ['經度 181', { longitude: 181 }],
    ['經度 NaN', { longitude: Number.NaN }],
  ])('座標不合理（%s）：視同沒有定位', (_name, over) => {
    expect(toExemptGpsFix(fix(over))).toBeNull();
  });
  it('邊界座標仍可保留', () => {
    expect(toExemptGpsFix(fix({ latitude: 90, longitude: -180 }))).toMatchObject({ latitude: 90, longitude: -180 });
  });
  it.each([
    ['缺誤差', { accuracy: undefined }],
    ['誤差為 null', { accuracy: null }],
    ['誤差 NaN', { accuracy: Number.NaN }],
    ['誤差為負數', { accuracy: -5 }],
  ])('誤差無效（%s）：accuracy 存 null，座標保留', (_name, over) => {
    const r = toExemptGpsFix(fix(over));
    expect(r).not.toBeNull();
    expect(r!.accuracy).toBeNull();
    expect(r!.latitude).toBe(25.033);
  });
  it('誤差 0 是有效值', () => {
    expect(toExemptGpsFix(fix({ accuracy: 0 }))!.accuracy).toBe(0);
  });
  it('時間無效或缺值：capturedAt 存 null，其餘保留', () => {
    expect(toExemptGpsFix(fix({ capturedAt: 'not-a-date' }))!.capturedAt).toBeNull();
    expect(toExemptGpsFix(fix({ capturedAt: null }))!.capturedAt).toBeNull();
    expect(toExemptGpsFix(fix({ capturedAt: undefined }))!.capturedAt).toBeNull();
  });
});

describe('一般（非例外）驗證規則不受影響', () => {
  it('誤差 25000 仍判定失敗（accuracy_too_large），誤差 1000 仍通過', () => {
    expect(validateGpsFix(fix(), NOW)).toMatchObject({ ok: false, kind: 'accuracy_too_large' });
    expect(validateGpsFix(fix({ accuracy: 1000 }), NOW)).toMatchObject({ ok: true });
    expect(validateGpsFix(fix({ accuracy: 1001 }), NOW)).toMatchObject({ ok: false, kind: 'accuracy_too_large' });
  });
  it('失敗訊息含誤差公尺數', () => {
    const r = validateGpsFix(fix(), NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toBe('定位誤差過大（±25000 公尺）');
  });
});
